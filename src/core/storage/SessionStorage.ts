/**
 * SessionStorage - Handles chat session files in vault/.codian/obsidian/sessions/
 *
 * Each conversation is stored as a JSONL (JSON Lines) file.
 * First line contains metadata, subsequent lines contain messages.
 *
 * JSONL format:
 * ```
 * {"type":"meta","id":"conv-123","title":"Fix bug","createdAt":1703500000,"sessionId":"sdk-xyz"}
 * {"type":"message","id":"msg-1","role":"user","content":"...","timestamp":1703500001}
 * {"type":"message","id":"msg-2","role":"assistant","content":"...","timestamp":1703500002}
 * ```
 */

import { isSubagentToolName } from '../tools/toolNames';
import type {
  ChatMessage,
  Conversation,
  ConversationMeta,
  SessionMetadata,
  SubagentInfo,
  UsageInfo,
} from '../types';
import type { VaultFileAdapter } from './VaultFileAdapter';

/** Path to sessions folder relative to vault root. */
export const SESSIONS_PATH = '.codian/obsidian/sessions';
const DEFAULT_LEGACY_PREVIEW = 'Conversation';
const DEFAULT_NATIVE_PREVIEW = 'SDK session';

/** Metadata record stored as first line of JSONL. */
interface SessionMetaRecord {
  type: 'meta';
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  sessionId: string | null;
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
  usage?: UsageInfo;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  sdkSessionId?: string;
  previousSdkSessionIds?: string[];
  legacyCutoffAt?: number;
  subagentData?: Record<string, SubagentInfo>;
  resumeSessionAt?: string;
  forkSource?: Conversation['forkSource'];
  preview?: string;
  messageCount?: number;
}

/** Message record stored as subsequent lines. */
interface SessionMessageRecord {
  type: 'message';
  message: ChatMessage;
}

/** Union type for JSONL records. */
type SessionRecord = SessionMetaRecord | SessionMessageRecord;
type SessionMetaLike = Omit<SessionMetaRecord, 'type'> | SessionMetadata;

function buildConversationPreview(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find(msg => msg.role === 'user');
  if (!firstUserMsg) {
    return 'New conversation';
  }

  return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
}

function isValidSessionMetadata(value: unknown): value is SessionMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metadata = value as Record<string, unknown>;
  return (
    typeof metadata.id === 'string' &&
    metadata.id.length > 0 &&
    typeof metadata.title === 'string' &&
    typeof metadata.createdAt === 'number' &&
    typeof metadata.updatedAt === 'number'
  );
}

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) { }

  async loadConversation(id: string): Promise<Conversation | null> {
    const filePath = this.getFilePath(id);
    try {
      if (!(await this.adapter.exists(filePath))) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      return this.parseJSONL(content);
    } catch {
      return null;
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const filePath = this.getFilePath(conversation.id);
    const content = this.serializeToJSONL(conversation);
    await this.adapter.write(filePath, content);
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      await this.adapter.delete(this.getFilePath(id));
      await this.deleteMetadata(id);
    } catch {
      // Ignore missing files
    }
  }

  /** List all conversation metadata (without loading full messages). */
  async listConversations(): Promise<ConversationMeta[]> {
    const metas: ConversationMeta[] = [];

    for (const candidatePaths of (await this.listSessionJsonlFilesById()).values()) {
      for (const filePath of candidatePaths) {
        try {
          const meta = await this.loadMetaOnly(filePath);
          if (meta) {
            metas.push(meta);
            break;
          }
        } catch {
          // Try fallback path for the same conversation id
        }
      }
    }

    // Sort by updatedAt descending (most recent first)
    metas.sort((a, b) => b.updatedAt - a.updatedAt);

    return metas;
  }

  async loadAllConversations(): Promise<{ conversations: Conversation[]; failedCount: number }> {
    const conversations: Conversation[] = [];
    let failedCount = 0;

    for (const candidatePaths of (await this.listSessionJsonlFilesById()).values()) {
      let loaded = false;

      for (const filePath of candidatePaths) {
        try {
          const content = await this.adapter.read(filePath);
          const conversation = this.parseJSONL(content);
          if (conversation) {
            conversations.push(conversation);
            loaded = true;
            break;
          }
        } catch {
          // Try fallback path for the same conversation id
        }
      }

      if (!loaded) {
        failedCount++;
      }
    }

    conversations.sort((a, b) => b.updatedAt - a.updatedAt);

    return { conversations, failedCount };
  }

  async loadAllConversationShells(): Promise<{ conversations: Conversation[]; failedCount: number }> {
    const conversations: Conversation[] = [];
    let failedCount = 0;
    const metadataById = await this.loadAllMetadataById();
    const jsonlFilesById = await this.listSessionJsonlFilesById();

    for (const [id, candidatePaths] of jsonlFilesById.entries()) {
      const supplementalMeta = metadataById.get(id);
      if (supplementalMeta) {
        conversations.push(this.buildConversationShell(supplementalMeta, {
          isNative: false,
          messagesLoaded: false,
        }));
        metadataById.delete(id);
        continue;
      }

      let loaded = false;
      for (const filePath of candidatePaths) {
        try {
          const header = await this.loadMetaRecordFromHeader(filePath);
          if (header) {
            conversations.push(this.buildConversationShell(header, {
              isNative: false,
              messagesLoaded: false,
            }));
            loaded = true;
            break;
          }
        } catch {
          // Try fallback path for the same conversation id
        }
      }

      if (!loaded) {
        failedCount++;
      }
    }

    for (const [id, meta] of metadataById.entries()) {
      if (jsonlFilesById.has(id)) continue;
      conversations.push(this.buildConversationShell(meta, {
        isNative: true,
        messagesLoaded: true,
      }));
    }

    conversations.sort((a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt));

    return { conversations, failedCount };
  }

  async hasSessions(): Promise<boolean> {
    return (await this.listSessionJsonlFilesById()).size > 0;
  }

  getFilePath(id: string): string {
    return `${SESSIONS_PATH}/${id}.jsonl`;
  }

  private parseMetaRecord(line: string): SessionMetaRecord | null {
    try {
      const record = JSON.parse(line) as SessionRecord;
      if (record.type !== 'meta') return null;
      return record;
    } catch {
      return null;
    }
  }

  private async loadMetaRecordFromHeader(filePath: string): Promise<SessionMetaRecord | null> {
    const firstLine = await this.adapter.readFirstLine(filePath);
    if (!firstLine) return null;
    return this.parseMetaRecord(firstLine);
  }

  private buildConversationShell(
    record: SessionMetaLike,
    options: { isNative: boolean; messagesLoaded: boolean }
  ): Conversation {
    return {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastResponseAt: record.lastResponseAt,
      sessionId: record.sessionId ?? null,
      sdkSessionId: record.sdkSessionId,
      previousSdkSessionIds: record.previousSdkSessionIds,
      messages: [],
      currentNote: record.currentNote,
      externalContextPaths: record.externalContextPaths,
      enabledMcpServers: record.enabledMcpServers,
      usage: record.usage,
      titleGenerationStatus: record.titleGenerationStatus,
      isNative: options.isNative ? true : undefined,
      legacyCutoffAt: record.legacyCutoffAt,
      subagentData: record.subagentData,
      resumeSessionAt: record.resumeSessionAt,
      forkSource: record.forkSource,
      preview: record.preview ?? (options.isNative ? DEFAULT_NATIVE_PREVIEW : DEFAULT_LEGACY_PREVIEW),
      messageCount: record.messageCount ?? 0,
      messagesLoaded: options.messagesLoaded,
    };
  }

  private async loadAllMetadataById(): Promise<Map<string, SessionMetadata>> {
    const metadataById = new Map<string, SessionMetadata>();

    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      const metaFiles = files.filter(filePath => filePath.endsWith('.meta.json'));

      for (const filePath of metaFiles) {
        try {
          const content = await this.adapter.read(filePath);
          const meta = JSON.parse(content);
          if (!isValidSessionMetadata(meta)) continue;
          metadataById.set(meta.id, meta);
        } catch {
          // Skip files that fail to load
        }
      }
    } catch {
      // Ignore metadata listing failures
    }

    return metadataById;
  }

  private async loadMetaOnly(filePath: string): Promise<ConversationMeta | null> {
    const content = await this.adapter.read(filePath);
    // Handle both Unix (LF) and Windows (CRLF) line endings
    const firstLine = content.split(/\r?\n/)[0];

    if (!firstLine) return null;

    try {
      const record = this.parseMetaRecord(firstLine);
      if (!record) return null;

      // Count messages by counting remaining lines
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      const messageCount = record.messageCount ?? (lines.length - 1);

      // Get preview from first user message
      let preview = record.preview ?? 'New conversation';
      if (!record.preview) {
        for (let i = 1; i < lines.length; i++) {
          try {
            const msgRecord = JSON.parse(lines[i]) as SessionRecord;
            if (msgRecord.type === 'message' && msgRecord.message.role === 'user') {
              preview = buildConversationPreview([msgRecord.message]);
              break;
            }
          } catch {
            continue;
          }
        }
      }

      return {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastResponseAt: record.lastResponseAt,
        messageCount,
        preview,
        titleGenerationStatus: record.titleGenerationStatus,
      };
    } catch {
      return null;
    }
  }

  private parseJSONL(content: string): Conversation | null {
    // Handle both Unix (LF) and Windows (CRLF) line endings
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return null;

    let meta: SessionMetaRecord | null = null;
    const messages: ChatMessage[] = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as SessionRecord;

        if (record.type === 'meta') {
          meta = record;
        } else if (record.type === 'message') {
          messages.push(record.message);
        }
      } catch {
        // Skip invalid JSONL lines
      }
    }

    if (!meta) return null;

    const preview = meta.preview ?? buildConversationPreview(messages);
    const messageCount = meta.messageCount ?? messages.length;

    return {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      sessionId: meta.sessionId,
      sdkSessionId: meta.sdkSessionId,
      previousSdkSessionIds: meta.previousSdkSessionIds,
      messages,
      currentNote: meta.currentNote,
      externalContextPaths: meta.externalContextPaths,
      enabledMcpServers: meta.enabledMcpServers,
      usage: meta.usage,
      titleGenerationStatus: meta.titleGenerationStatus,
      legacyCutoffAt: meta.legacyCutoffAt,
      subagentData: meta.subagentData,
      resumeSessionAt: meta.resumeSessionAt,
      forkSource: meta.forkSource,
      preview,
      messageCount,
      messagesLoaded: true,
    };
  }

  private serializeToJSONL(conversation: Conversation): string {
    const lines: string[] = [];
    const preview = conversation.preview ?? buildConversationPreview(conversation.messages);
    const messageCount = conversation.messageCount ?? conversation.messages.length;

    // First line: metadata
    const meta: SessionMetaRecord = {
      type: 'meta',
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      titleGenerationStatus: conversation.titleGenerationStatus,
      sdkSessionId: conversation.sdkSessionId,
      previousSdkSessionIds: conversation.previousSdkSessionIds,
      legacyCutoffAt: conversation.legacyCutoffAt,
      subagentData: Object.keys(this.extractSubagentData(conversation.messages)).length > 0
        ? this.extractSubagentData(conversation.messages)
        : conversation.subagentData,
      resumeSessionAt: conversation.resumeSessionAt,
      forkSource: conversation.forkSource,
      preview,
      messageCount,
    };
    lines.push(JSON.stringify(meta));

    // Subsequent lines: messages
    for (const message of conversation.messages) {
      const record: SessionMessageRecord = {
        type: 'message',
        message,
      };
      lines.push(JSON.stringify(record));
    }

    return lines.join('\n');
  }

  /**
   * Detects if a session uses runtime-native storage.
   * A session is "native" if no legacy JSONL file exists.
   *
   * Legacy sessions have id.jsonl (and optionally id.meta.json).
   * Native sessions have only id.meta.json or no files yet (SDK stores messages).
   */
  async isNativeSession(id: string): Promise<boolean> {
    const exists = await this.adapter.exists(this.getFilePath(id)).catch(() => false);
    return !exists;
  }

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    const filePath = this.getMetadataPath(id);

    try {
      if (!(await this.adapter.exists(filePath))) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      return JSON.parse(content) as SessionMetadata;
    } catch {
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    const filePath = this.getMetadataPath(id);
    await this.adapter.delete(filePath);
  }

  /** List all native session metadata (.meta.json files without .jsonl counterparts). */
  async listNativeMetadata(): Promise<SessionMetadata[]> {
    const metas: SessionMetadata[] = [];

    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);

      const metaFiles = files.filter(f => f.endsWith('.meta.json'));

      for (const filePath of metaFiles) {
        // Extract ID from path: .codian/obsidian/sessions/{id}.meta.json
        const fileName = filePath.split('/').pop() || '';
        const id = fileName.replace('.meta.json', '');

        // Check if this is truly native (no legacy .jsonl exists)
        const conversationExists = await this.adapter.exists(this.getFilePath(id)).catch(() => false);

        if (conversationExists) {
          // Skip - this has legacy storage, meta.json is supplementary
          continue;
        }

        try {
          const content = await this.adapter.read(filePath);
          const meta = JSON.parse(content);
          if (isValidSessionMetadata(meta)) {
            metas.push(meta);
          }
        } catch {
          // Skip files that fail to load
        }
      }
    } catch {
      // Return empty list if directory listing fails
    }

    return metas;
  }

  /**
   * List all conversations, merging legacy JSONL and native metadata sources.
   * Legacy conversations take precedence if both exist.
   */
  async listAllConversations(): Promise<ConversationMeta[]> {
    const metas: ConversationMeta[] = [];

    // 1. Load legacy conversations (existing .jsonl files)
    const legacyMetas = await this.listConversations();
    metas.push(...legacyMetas);

    // 2. Load native metadata (.meta.json files)
    const nativeMetas = await this.listNativeMetadata();

    // 3. Merge, avoiding duplicates (legacy takes precedence)
    const legacyIds = new Set(legacyMetas.map(m => m.id));
    for (const meta of nativeMetas) {
      if (!legacyIds.has(meta.id)) {
        metas.push({
          id: meta.id,
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastResponseAt: meta.lastResponseAt,
          messageCount: meta.messageCount ?? 0,
          preview: meta.preview ?? DEFAULT_NATIVE_PREVIEW,
          titleGenerationStatus: meta.titleGenerationStatus,
          isNative: true,
        });
      }
    }

    // 4. Sort by lastResponseAt descending (fallback to createdAt)
    return metas.sort((a, b) =>
      (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt)
    );
  }

  toSessionMetadata(conversation: Conversation): SessionMetadata {
    const subagentData = this.extractSubagentData(conversation.messages);
    const preview = conversation.preview ?? buildConversationPreview(conversation.messages);
    const messageCount = conversation.messageCount ?? conversation.messages.length;

    return {
      id: conversation.id,
      title: conversation.title,
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      sdkSessionId: conversation.sdkSessionId,
      previousSdkSessionIds: conversation.previousSdkSessionIds,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      legacyCutoffAt: conversation.legacyCutoffAt,
      subagentData: Object.keys(subagentData).length > 0 ? subagentData : undefined,
      resumeSessionAt: conversation.resumeSessionAt,
      forkSource: conversation.forkSource,
      preview,
      messageCount,
    };
  }

  /**
   * Extracts subagentData from messages for persistence.
   * Collects subagent info from Agent tool calls, including legacy Task transcripts.
   */
  private extractSubagentData(messages: ChatMessage[]): Record<string, SubagentInfo> {
    const result: Record<string, SubagentInfo> = {};

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;

      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          if (!isSubagentToolName(toolCall.name) || !toolCall.subagent) continue;
          result[toolCall.subagent.id] = toolCall.subagent;
        }
      }
    }

    return result;
  }

  private getConversationIdFromFilePath(filePath: string): string {
    const fileName = filePath.split('/').pop() || '';
    return fileName.replace(/\.jsonl$/, '');
  }

  private async listSessionJsonlFilesById(): Promise<Map<string, string[]>> {
    const filesById = new Map<string, string[]>();

    let files: string[] = [];
    try {
      files = await this.adapter.listFiles(SESSIONS_PATH);
    } catch {
      return filesById;
    }

    for (const filePath of files) {
      if (!filePath.endsWith('.jsonl')) continue;
      const id = this.getConversationIdFromFilePath(filePath);
      const candidates = filesById.get(id) ?? [];
      if (!candidates.includes(filePath)) {
        candidates.push(filePath);
      }
      filesById.set(id, candidates);
    }

    return filesById;
  }

}

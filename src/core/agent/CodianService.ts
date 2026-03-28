import type * as acp from '@agentclientprotocol/sdk';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type CodianPlugin from '../../main';
import { omitUnsupportedCodexAuthEnvironmentVariables } from '../../utils/codexConfig';
import {
  cliPathRequiresNode,
  findNodeExecutable,
  getEnhancedPath,
  getWslForwardedEnvironment,
  parseEnvironmentVariables,
  resolveWindowsWslExecutable,
  withProxyAliases,
} from '../../utils/env';
import { normalizePathForFilesystem, translateWindowsPathToWsl } from '../../utils/path';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
  isSessionExpiredError,
} from '../../utils/session';
import type { McpServerManager } from '../mcp';
import { buildSystemPrompt } from '../prompts/mainAgent';
import { getPathFromToolInput } from '../tools/toolInput';
import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GREP,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_WEB_FETCH,
  TOOL_WRITE,
} from '../tools/toolNames';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  ImageAttachment,
  SlashCommand,
  StreamChunk,
} from '../types';
import { isAdaptiveThinkingModel, toCodexReasoningEffort } from '../types/models';
import { CodexAcpRuntime } from './CodexAcpRuntime';
import { SessionManager } from './SessionManager';

export interface ApprovalCallbackOptions {
  decisionReason?: string;
  blockedPath?: string;
  agentID?: string;
}

export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
  options?: ApprovalCallbackOptions,
) => Promise<ApprovalDecision>;

export type AskUserQuestionCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, string> | null>;

export interface QueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}

export interface EnsureReadyOptions {
  sessionId?: string;
  externalContextPaths?: string[];
  force?: boolean;
  preserveHandlers?: boolean;
}

export interface RewindFilesResult {
  conversationRewound: boolean;
  restoredFiles: string[];
  missingArtifacts: string[];
  unsafeTurns: string[];
  warnings: string[];
  insertions?: number;
  deletions?: number;
  error?: string;
}

interface RewindTurnSpec {
  turnId: string;
  expectsFileRestore: boolean;
}

interface TurnBackupEntry {
  originalPath: string;
  backupPath?: string;
  existedBefore: boolean;
}

interface TurnArtifact {
  turnId: string;
  sessionId: string | null;
  filesChanged: string[];
  backups: TurnBackupEntry[];
  opaqueSideEffects: boolean;
  createdAt: number;
}

interface GitRewindSnapshot {
  repoRoot: string;
  hasHead: boolean;
  dirtyPaths: Set<string>;
}

interface AcpToolUpdate {
  sessionUpdate?: 'tool_call' | 'tool_call_update';
  toolCallId: string;
  title?: string | null;
  status?: acp.ToolCallStatus | null;
  kind?: acp.ToolKind | null;
  content?: acp.ToolCallContent[] | null;
  locations?: acp.ToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

function isBareCommandName(command: string): boolean {
  return !!command &&
    !/[\\/]/.test(command) &&
    !/^[a-zA-Z]:/.test(command);
}

function getWslBootstrapScript(): string {
  return [
    'for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc"; do',
    '  [ -f "$file" ] && . "$file" >/dev/null 2>&1 || true;',
    'done;',
    'if [ -s "$HOME/.nvm/nvm.sh" ]; then',
    '  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true;',
    '  nvm use default >/dev/null 2>&1 || true;',
    'fi;',
    'exec "$@"',
  ].join(' ');
}

function formatRuntimeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('wsl.exe') && message.includes('ENOENT')) {
    return 'WSL launcher not found on the Windows host. Restart Obsidian after enabling WSL, or verify that C:\\Windows\\System32\\wsl.exe exists.';
  }
  return message;
}

function buildPermissionPreamble(mode: string): string | null {
  if (mode === 'plan') {
    return [
      'Plan mode is enabled.',
      'Do not execute file mutations or shell commands.',
      'Analyze the task, explain the plan, and wait for the user to confirm before making changes.',
    ].join(' ');
  }
  return null;
}

const CODIAN_PRIVATE_DIR = ['.codian', 'obsidian'] as const;
const LEGACY_PRIVATE_DIR = ['.codex', 'obsidian'] as const;

export class CodianService {
  private plugin: CodianPlugin;
  private mcpManager: McpServerManager;
  private sessionManager = new SessionManager();
  private currentExternalContextPaths: string[] = [];
  private readyStateListeners = new Set<(ready: boolean) => void>();
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private autoTurnCallback: ((chunks: StreamChunk[]) => void) | null = null;
  private acpRuntime: CodexAcpRuntime | null = null;
  private abortController: AbortController | null = null;
  private pendingResumeAt?: string;
  private pendingForkSession = false;
  private promptInFlight = false;
  private attachedSessionId: string | null = null;
  private supportedCommands: SlashCommand[] = [];
  private currentConfigOptions: acp.SessionConfigOption[] = [];
  private turnQueue: StreamChunk[] = [];
  private turnQueueResolver: (() => void) | null = null;
  private turnClosed = true;
  private turnError: Error | null = null;
  private activeTurnSessionId: string | null = null;
  private activeTurnArtifact: TurnArtifact | null = null;
  private activeTurnGitSnapshot: GitRewindSnapshot | null = null;
  private emittedToolResults = new Set<string>();

  constructor(plugin: CodianPlugin, mcpManager: McpServerManager) {
    this.plugin = plugin;
    this.mcpManager = mcpManager;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyStateListeners.add(listener);
    try {
      listener(this.isReady());
    } catch {
      // Ignore listener failures
    }
    return () => {
      this.readyStateListeners.delete(listener);
    };
  }

  private notifyReadyStateChange(): void {
    const ready = this.isReady();
    for (const listener of this.readyStateListeners) {
      try {
        listener(ready);
      } catch {
        // Ignore listener failures
      }
    }
  }

  async reloadMcpServers(): Promise<void> {
    await this.mcpManager.loadServers();
  }

  setPendingResumeAt(uuid: string | undefined): void {
    this.pendingResumeAt = uuid;
  }

  applyForkState(conv: Pick<Conversation, 'sessionId' | 'sdkSessionId' | 'forkSource'>): string | null {
    const isFork = !conv.sessionId && !!conv.forkSource;
    this.pendingForkSession = isFork;
    if (isFork) {
      this.sessionManager.invalidateSession();
      return null;
    }
    return conv.sessionId ?? conv.sdkSessionId ?? null;
  }

  async ensureReady(options?: EnsureReadyOptions): Promise<boolean> {
    if (options?.externalContextPaths) {
      this.currentExternalContextPaths = [...options.externalContextPaths];
    }
    if (options?.sessionId !== undefined) {
      this.sessionManager.setSessionId(options.sessionId ?? null, this.plugin.settings.model);
      if (options.sessionId !== this.attachedSessionId) {
        this.attachedSessionId = null;
      }
    }
    const acpPath = this.plugin.getResolvedCodexAcpPath();
    if (!acpPath) {
      this.notifyReadyStateChange();
      return false;
    }

    try {
      await this.ensureAcpRuntimeConnected(!!options?.force);
      this.notifyReadyStateChange();
      return true;
    } catch {
      this.notifyReadyStateChange();
      return false;
    }
  }

  private buildPrompt(prompt: string, history?: ChatMessage[], queryOptions?: QueryOptions): string {
    const systemPrompt = buildSystemPrompt({
      mediaFolder: this.plugin.settings.mediaFolder,
      customPrompt: this.plugin.settings.systemPrompt,
      allowedExportPaths: this.plugin.settings.allowedExportPaths,
      allowExternalAccess: this.plugin.settings.allowExternalAccess,
      vaultPath: this.getVaultPath() || undefined,
      userName: this.plugin.settings.userName,
    });

    const sections: string[] = [];
    sections.push(`<system_instructions>\n${systemPrompt}\n</system_instructions>`);

    const permissionPreamble = buildPermissionPreamble(this.plugin.settings.permissionMode);
    if (permissionPreamble) {
      sections.push(permissionPreamble);
    }

    if (queryOptions?.allowedTools && queryOptions.allowedTools.length > 0) {
      sections.push(`Only use these tools if you need tools: ${queryOptions.allowedTools.join(', ')}.`);
    }

    const historyNeeded = !this.sessionManager.getSessionId() ||
      !!queryOptions?.forceColdStart ||
      !!this.pendingResumeAt ||
      this.pendingForkSession;

    if (historyNeeded && history && history.length > 0) {
      const actualPrompt = prompt;
      const historyContext = buildContextFromHistory(history);
      sections.push(buildPromptWithHistoryContext(historyContext, prompt, actualPrompt, history));
    } else {
      sections.push(prompt);
    }

    return sections.join('\n\n');
  }

  private getVaultPath(): string {
    const adapter = this.plugin.app.vault.adapter as { basePath?: string };
    return adapter.basePath || '';
  }

  private getRuntimeMode(): 'native' | 'wsl' {
    if (process.platform === 'win32') {
      return 'wsl';
    }
    return this.plugin.settings.codexRuntimeMode ?? 'native';
  }

  private resolveCommand(
    cliPath: string,
    envPath: string,
    hostCwd: string,
    wslEnv: Record<string, string>
  ): { command: string; prefixArgs: string[] } {
    const runtimeMode = this.getRuntimeMode();
    const nodePath = cliPathRequiresNode(cliPath) ? findNodeExecutable(envPath) : null;

    if (runtimeMode === 'wsl') {
      const distro = this.plugin.settings.wslDistribution?.trim() || undefined;
      const command = resolveWindowsWslExecutable();
      const prefixArgs: string[] = [];
      const translatedCwd = this.mapPathForRuntime(hostCwd);
      const targetCli = cliPath || 'codex';
      if (distro) {
        prefixArgs.push('-d', distro);
      }
      if (translatedCwd && translatedCwd !== hostCwd) {
        prefixArgs.push('--cd', translatedCwd);
      }
      prefixArgs.push('--exec');
      const wslEnvArgs = Object.entries(wslEnv).map(([key, value]) => `${key}=${value}`);
      if (wslEnvArgs.length > 0) {
        prefixArgs.push('/usr/bin/env', ...wslEnvArgs);
      }
      if (isBareCommandName(targetCli)) {
        prefixArgs.push('/bin/bash', '-lc', getWslBootstrapScript(), 'bash', targetCli);
        return { command, prefixArgs };
      }
      if (nodePath) {
        prefixArgs.push(path.basename(nodePath));
      }
      prefixArgs.push(targetCli);
      return { command, prefixArgs };
    }

    if (nodePath) {
      return { command: nodePath, prefixArgs: [cliPath] };
    }

    return { command: cliPath, prefixArgs: [] };
  }

  private mapPathForRuntime(filePath: string): string {
    if (this.getRuntimeMode() !== 'wsl') {
      return filePath;
    }

    const translated = translateWindowsPathToWsl(filePath);
    if (!translated) {
      return filePath;
    }

    if (translated.includes(':')) {
      const [, wslPath] = translated.split(':', 2);
      return wslPath;
    }
    return translated;
  }

  private buildCliArgs(
    prompt: string,
    sessionId: string | null,
    imagePaths: string[],
    queryOptions?: QueryOptions,
  ): string[] {
    const args: string[] = [];
    const model = queryOptions?.model || this.plugin.settings.model;
    const sandboxMode = this.plugin.settings.permissionMode === 'plan'
      ? 'read-only'
      : 'workspace-write';

    if (sessionId) {
      args.push('exec', 'resume', sessionId);
    } else {
      args.push('exec');
    }

    args.push(
      '--json',
      '--skip-git-repo-check',
      '-c', 'approval_policy="never"',
      '-c', `sandbox_mode="${sandboxMode}"`,
    );

    if (model && isAdaptiveThinkingModel(model)) {
      args.push(
        '-c',
        `model_reasoning_effort="${toCodexReasoningEffort(this.plugin.settings.effortLevel)}"`,
      );
    }

    if (model) {
      args.push('-m', model);
    }

    for (const imagePath of imagePaths) {
      args.push('-i', this.mapPathForRuntime(imagePath));
    }

    args.push(prompt);
    return args;
  }

  private async ensureAcpRuntimeConnected(force = false): Promise<void> {
    if (force) {
      await this.disconnectAcpRuntime();
    }

    if (this.acpRuntime?.isConnected()) {
      return;
    }

    const acpPath = this.plugin.getResolvedCodexAcpPath();
    if (!acpPath) {
      throw new Error('codex-acp not found. Install codex-acp and configure its path in settings.');
    }

    const envVars = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());
    const enhancedPath = getEnhancedPath(envVars.PATH, acpPath);
    const hostCwd = this.getVaultPath();
    const runtimeEnv = omitUnsupportedCodexAuthEnvironmentVariables(withProxyAliases({
      ...process.env,
      ...envVars,
      PATH: enhancedPath,
    }));
    const { command, prefixArgs } = this.resolveCommand(
      acpPath,
      enhancedPath,
      hostCwd,
      omitUnsupportedCodexAuthEnvironmentVariables(getWslForwardedEnvironment(envVars))
    );

    const runtime = new CodexAcpRuntime({
      onExit: (error) => {
        void this.handleAcpRuntimeExit(error);
      },
      onSessionUpdate: async (params) => {
        await this.handleAcpSessionUpdate(params);
      },
      onPermissionRequest: async (params) => this.handleAcpPermissionRequest(params),
    });

    try {
      await runtime.connect({
        command,
        args: prefixArgs,
        cwd: hostCwd,
        env: runtimeEnv,
        clientName: 'codian',
        clientVersion: this.plugin.manifest.version,
      });
    } catch (error) {
      throw new Error(formatRuntimeErrorMessage(error));
    }

    this.acpRuntime = runtime;
  }

  private async disconnectAcpRuntime(): Promise<void> {
    const runtime = this.acpRuntime;
    this.acpRuntime = null;
    this.attachedSessionId = null;
    if (runtime) {
      await runtime.disconnect();
    }
  }

  private async handleAcpRuntimeExit(error?: Error): Promise<void> {
    this.acpRuntime = null;
    this.attachedSessionId = null;
    if (this.promptInFlight) {
      this.turnError = error ?? new Error('codex-acp disconnected unexpectedly');
      this.turnClosed = true;
      this.turnQueueResolver?.();
      this.turnQueueResolver = null;
    }
    this.notifyReadyStateChange();
  }

  private resetTurnState(): void {
    this.turnQueue = [];
    this.turnQueueResolver = null;
    this.turnClosed = true;
    this.turnError = null;
    this.activeTurnSessionId = null;
    this.activeTurnArtifact = null;
    this.activeTurnGitSnapshot = null;
    this.emittedToolResults.clear();
  }

  private openTurnState(sessionId: string, artifact: TurnArtifact, snapshot: GitRewindSnapshot | null): void {
    this.turnQueue = [];
    this.turnQueueResolver = null;
    this.turnClosed = false;
    this.turnError = null;
    this.activeTurnSessionId = sessionId;
    this.activeTurnArtifact = artifact;
    this.activeTurnGitSnapshot = snapshot;
    this.emittedToolResults.clear();
  }

  private pushTurnChunk(chunk: StreamChunk): void {
    this.turnQueue.push(chunk);
    this.turnQueueResolver?.();
    this.turnQueueResolver = null;
  }

  private closeTurnState(error?: Error): void {
    if (error) {
      this.turnError = error;
    }
    this.turnClosed = true;
    this.turnQueueResolver?.();
    this.turnQueueResolver = null;
  }

  private async nextTurnChunk(): Promise<StreamChunk | null> {
    while (this.turnQueue.length === 0 && !this.turnClosed && !this.turnError) {
      await new Promise<void>((resolve) => {
        this.turnQueueResolver = resolve;
      });
    }

    if (this.turnQueue.length > 0) {
      return this.turnQueue.shift() ?? null;
    }

    if (this.turnError) {
      const error = this.turnError;
      this.turnError = null;
      throw error;
    }

    return null;
  }

  private getAcpPromptBlocks(prompt: string, images?: ImageAttachment[]): acp.ContentBlock[] {
    const blocks: acp.ContentBlock[] = [{ type: 'text', text: prompt }];
    for (const image of images || []) {
      blocks.push({
        type: 'image',
        data: image.data,
        mimeType: image.mediaType,
      });
    }
    return blocks;
  }

  private async ensureAcpSession(
    desiredModel: string,
    forceNewSession: boolean,
    conversationHistory: ChatMessage[] | undefined,
    prompt: string,
    images: ImageAttachment[] | undefined,
    queryOptions: QueryOptions | undefined,
  ): Promise<{ sessionId: string; promptBlocks: acp.ContentBlock[] }> {
    await this.ensureAcpRuntimeConnected();

    const existingSessionId = this.sessionManager.getSessionId();
    const canReuseAttachedSession = !!existingSessionId && this.attachedSessionId === existingSessionId;
    const needsFreshSession = forceNewSession || !canReuseAttachedSession;
    const promptWithHistory = this.buildPrompt(prompt, conversationHistory, {
      ...queryOptions,
      forceColdStart: needsFreshSession,
    });
    const promptBlocks = this.getAcpPromptBlocks(promptWithHistory, images);

    if (!needsFreshSession && existingSessionId) {
      await this.applyAcpSessionConfiguration(existingSessionId, desiredModel, this.currentConfigOptions);
      return { sessionId: existingSessionId, promptBlocks };
    }

    const session = await this.acpRuntime!.newSession(this.mapPathForRuntime(this.getVaultPath()), []);
    this.sessionManager.captureSession(session.sessionId);
    this.sessionManager.clearHistoryRebuild();
    this.attachedSessionId = session.sessionId;
    this.currentConfigOptions = session.configOptions ?? [];
    await this.applyAcpSessionConfiguration(session.sessionId, desiredModel, session.configOptions ?? []);
    return {
      sessionId: session.sessionId,
      promptBlocks,
    };
  }

  private async applyAcpSessionConfiguration(
    sessionId: string,
    desiredModel: string,
    configOptions: acp.SessionConfigOption[],
  ): Promise<void> {
    if (!this.acpRuntime) return;

    let currentOptions = configOptions;

    const modelOption = currentOptions.find((option) =>
      option.category === 'model' || option.id === 'model'
    );
    if (modelOption && modelOption.currentValue !== desiredModel && this.configOptionHasValue(modelOption, desiredModel)) {
      currentOptions = await this.acpRuntime.setSessionConfigOption(sessionId, modelOption.id, desiredModel);
    }

    const effortOption = currentOptions.find((option) =>
      option.category === 'thought_level' || option.id === 'reasoning_effort'
    );
    const desiredEffort = this.getDesiredAcpReasoningEffort(effortOption);
    if (effortOption && desiredEffort && effortOption.currentValue !== desiredEffort && this.configOptionHasValue(effortOption, desiredEffort)) {
      currentOptions = await this.acpRuntime.setSessionConfigOption(sessionId, effortOption.id, desiredEffort);
    }

    this.currentConfigOptions = currentOptions;
  }

  private configOptionHasValue(option: acp.SessionConfigOption, desiredValue: string): boolean {
    if (option.type !== 'select') {
      return false;
    }

    for (const entry of option.options) {
      if ('group' in entry) {
        if (entry.options.some((child: acp.SessionConfigSelectOption) => child.value === desiredValue)) {
          return true;
        }
        continue;
      }
      if (entry.value === desiredValue) {
        return true;
      }
    }
    return false;
  }

  private getDesiredAcpReasoningEffort(option?: acp.SessionConfigOption): string | null {
    if (!option) return null;

    const candidates = this.plugin.settings.effortLevel === 'max'
      ? ['xhigh', 'high']
      : [toCodexReasoningEffort(this.plugin.settings.effortLevel)];

    for (const candidate of candidates) {
      if (this.configOptionHasValue(option, candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async handleAcpPermissionRequest(
    params: acp.RequestPermissionRequest
  ): Promise<acp.RequestPermissionResponse> {
    const allowKinds = new Set(['allow_once', 'allow_always']);
    const rejectKinds = new Set(['reject_once', 'reject_always']);

    const selectOption = (preferredKinds: Set<string>): acp.PermissionOption | undefined =>
      params.options.find((option) => option.kind && preferredKinds.has(option.kind))
      ?? params.options.find((option) => preferredKinds.has(option.name.toLowerCase().replace(/\s+/g, '_')));

    if (this.plugin.settings.permissionMode === 'yolo') {
      const allowOption = selectOption(allowKinds) ?? params.options[0];
      return {
        outcome: {
          outcome: 'selected',
          optionId: allowOption.optionId,
        },
      };
    }

    const toolName = params.toolCall
      ? this.getToolNameFromAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: params.toolCall.toolCallId,
        title: params.toolCall.title,
        status: params.toolCall.status,
        kind: params.toolCall.kind,
        content: params.toolCall.content,
        locations: params.toolCall.locations,
        rawInput: params.toolCall.rawInput,
      })
      : 'Tool';
    const input = params.toolCall
      ? this.getToolInputFromAcpUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: params.toolCall.toolCallId,
        title: params.toolCall.title,
        status: params.toolCall.status,
        kind: params.toolCall.kind,
        content: params.toolCall.content,
        locations: params.toolCall.locations,
        rawInput: params.toolCall.rawInput,
      })
      : {};
    const description = params.toolCall?.title || `Allow ${toolName}?`;

    const decision = this.approvalCallback
      ? await this.approvalCallback(toolName, input, description)
      : 'cancel';

    if (decision === 'cancel') {
      return { outcome: { outcome: 'cancelled' } };
    }

    const preferredKinds = decision === 'allow-always'
      ? ['allow_always', 'allow_once']
      : decision === 'allow'
        ? ['allow_once', 'allow_always']
        : ['reject_once', 'reject_always'];

    const option = preferredKinds
      .map((kind) => params.options.find((entry) => entry.kind === kind))
      .find(Boolean)
      ?? (decision === 'deny' ? selectOption(rejectKinds) : selectOption(allowKinds))
      ?? params.options[0];

    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }

  private async handleAcpSessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;

    if (update.sessionUpdate === 'available_commands_update') {
      this.supportedCommands = update.availableCommands.map((command) => ({
        id: `sdk:${command.name}`,
        name: command.name,
        description: command.description ?? undefined,
        argumentHint: command.input?.hint ?? undefined,
        content: '',
        source: 'sdk',
      }));
      return;
    }

    if (update.sessionUpdate === 'current_mode_update') {
      this.permissionModeSyncCallback?.(update.currentModeId);
      return;
    }

    if (update.sessionUpdate === 'config_option_update') {
      this.currentConfigOptions = update.configOptions;
      return;
    }

    if (!this.activeTurnSessionId || params.sessionId !== this.activeTurnSessionId) {
      return;
    }

    await this.prepareAcpUpdateForTurn(update);

    const chunks = this.mapAcpUpdateToChunks(params.sessionId, update);
    for (const chunk of chunks) {
      await this.prepareChunkForTurn(chunk);
      this.pushTurnChunk(chunk);
    }
  }

  private async prepareAcpUpdateForTurn(update: acp.SessionNotification['update']): Promise<void> {
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
      return;
    }

    const artifact = this.activeTurnArtifact;
    if (!artifact) {
      return;
    }

    const toolName = this.getToolNameFromAcpUpdate(update);
    const isMutatingTool = toolName === TOOL_WRITE
      || toolName === TOOL_EDIT
      || toolName === TOOL_NOTEBOOK_EDIT
      || toolName === TOOL_BASH;
    if (!isMutatingTool) {
      return;
    }

    const isCompleted = update.status === 'completed' || update.status === 'failed';
    if (!isCompleted) {
      return;
    }

    const input = this.getToolInputFromAcpUpdate(update);
    const hasDirectPath = !!getPathFromToolInput(toolName, input);
    const locations = Array.isArray(update.locations)
      ? Array.from(new Set(update.locations
        .map((location) => (typeof location.path === 'string' ? location.path : ''))
        .filter(Boolean)))
      : [];

    if (toolName !== TOOL_BASH && hasDirectPath) {
      return;
    }

    if (locations.length === 0) {
      if (toolName === TOOL_BASH || !hasDirectPath) {
        artifact.opaqueSideEffects = true;
      }
      return;
    }

    for (const filePath of locations) {
      await this.backfillBackupForChangedFile(artifact, this.activeTurnGitSnapshot, filePath);
    }
  }

  private mapAcpUpdateToChunks(
    sessionId: string,
    update: acp.SessionNotification['update']
  ): StreamChunk[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return update.content.type === 'text'
          ? [{ type: 'text', content: update.content.text }]
          : [];
      case 'agent_thought_chunk':
        return update.content.type === 'text'
          ? [{ type: 'thinking', content: update.content.text }]
          : [];
      case 'tool_call':
      case 'tool_call_update':
        return this.mapAcpToolUpdateToChunks(update);
      case 'usage_update':
        return [{
          type: 'usage',
          sessionId,
          usage: {
            model: this.sessionManager.getSessionId() ? this.plugin.settings.model : undefined,
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            contextWindow: update.size,
            contextTokens: update.used,
            percentage: update.size > 0 ? Math.round((update.used / update.size) * 100) : 0,
            isContextWindowAuthoritative: true,
          },
        }];
      default:
        return [];
    }
  }

  private mapAcpToolUpdateToChunks(update: AcpToolUpdate): StreamChunk[] {
    const id = update.toolCallId;
    const name = this.getToolNameFromAcpUpdate(update);
    const input = this.getToolInputFromAcpUpdate(update);
    const chunks: StreamChunk[] = [{
      type: 'tool_use',
      id,
      name,
      input,
    }];

    const isCompleted = update.status === 'completed' || update.status === 'failed';
    if (isCompleted && !this.emittedToolResults.has(id)) {
      this.emittedToolResults.add(id);
      chunks.push({
        type: 'tool_result',
        id,
        content: this.getToolResultFromAcpUpdate(update),
        isError: this.isAcpToolUpdateError(update),
      });
    }

    return chunks;
  }

  private getToolNameFromAcpUpdate(update: AcpToolUpdate): string {
    switch (update.kind) {
      case 'execute':
        return TOOL_BASH;
      case 'read':
        return TOOL_READ;
      case 'edit':
        return TOOL_EDIT;
      case 'delete':
      case 'move':
        return TOOL_WRITE;
      case 'search':
        return TOOL_GREP;
      case 'fetch':
        return TOOL_WEB_FETCH;
      default:
        return update.title || 'Tool';
    }
  }

  private getToolInputFromAcpUpdate(update: AcpToolUpdate): Record<string, unknown> {
    const rawInput = update.rawInput && typeof update.rawInput === 'object'
      ? update.rawInput as Record<string, unknown>
      : {};
    const parsedCmd = Array.isArray(rawInput.parsed_cmd) && rawInput.parsed_cmd.length > 0
      ? rawInput.parsed_cmd[0] as Record<string, unknown>
      : null;
    const command = Array.isArray(rawInput.command)
      ? rawInput.command.filter((part): part is string => typeof part === 'string').join(' ')
      : '';
    const locationPath = Array.isArray(update.locations)
      ? update.locations.find((location) => typeof location.path === 'string')?.path
      : undefined;

    switch (update.kind) {
      case 'execute':
        return { command: typeof parsedCmd?.cmd === 'string' ? parsedCmd.cmd : command };
      case 'read':
      case 'edit':
      case 'delete':
      case 'move':
        return {
          file_path: locationPath || (typeof parsedCmd?.path === 'string' ? parsedCmd.path : undefined),
        };
      case 'search':
        return {
          pattern: typeof parsedCmd?.cmd === 'string' ? parsedCmd.cmd : (update.title || ''),
          path: locationPath,
        };
      case 'fetch':
        return {
          url: typeof rawInput.url === 'string' ? rawInput.url : (update.title || ''),
        };
      default:
        return { ...rawInput };
    }
  }

  private getToolResultFromAcpUpdate(update: AcpToolUpdate): string {
    const rawOutput = update.rawOutput;
    if (rawOutput && typeof rawOutput === 'object') {
      const record = rawOutput as Record<string, unknown>;
      const formatted = typeof record.formatted_output === 'string'
        ? record.formatted_output
        : '';
      if (formatted) {
        return formatted;
      }
      const aggregated = typeof record.aggregated_output === 'string'
        ? record.aggregated_output
        : '';
      if (aggregated) {
        return aggregated;
      }
      const stdout = typeof record.stdout === 'string' ? record.stdout : '';
      const stderr = typeof record.stderr === 'string' ? record.stderr : '';
      if (stdout || stderr) {
        return `${stdout}${stderr ? (stdout ? '\n' : '') + stderr : ''}`.trim();
      }
    }

    if (Array.isArray(update.content) && update.content.length > 0) {
      return JSON.stringify(update.content, null, 2);
    }

    return update.title || '';
  }

  private isAcpToolUpdateError(update: AcpToolUpdate): boolean {
    if (update.status === 'failed') {
      return true;
    }
    const rawOutput = update.rawOutput;
    if (rawOutput && typeof rawOutput === 'object') {
      const exitCode = (rawOutput as Record<string, unknown>).exit_code;
      return typeof exitCode === 'number' && exitCode !== 0;
    }
    return false;
  }

  private async prepareChunkForTurn(chunk: StreamChunk): Promise<void> {
    const artifact = this.activeTurnArtifact;
    if (!artifact) {
      return;
    }

    if (chunk.type === 'tool_use') {
      if (chunk.name === TOOL_WRITE || chunk.name === TOOL_EDIT || chunk.name === TOOL_NOTEBOOK_EDIT) {
        await this.backupFileForTurn(artifact, chunk.name, chunk.input);
      }
    }

    if (chunk.type === 'usage' && chunk.usage.contextWindow > 0) {
      chunk.usage.percentage = Math.min(
        100,
        Math.max(0, Math.round((chunk.usage.contextTokens / chunk.usage.contextWindow) * 100)),
      );
      chunk.sessionId = this.sessionManager.getSessionId();
    }
  }

  private async writeImageAttachments(turnId: string, images: ImageAttachment[] | undefined): Promise<string[]> {
    if (!images || images.length === 0) {
      return [];
    }

    const baseDir = path.join(this.getVaultPath(), ...CODIAN_PRIVATE_DIR, 'tmp', 'images', turnId);
    await fs.promises.mkdir(baseDir, { recursive: true });

    const written: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const ext = image.mediaType.split('/')[1] || 'png';
      const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, '-') || `image-${i + 1}.${ext}`;
      const finalName = safeName.includes('.') ? safeName : `${safeName}.${ext}`;
      const fullPath = path.join(baseDir, finalName);
      await fs.promises.writeFile(fullPath, Buffer.from(image.data, 'base64'));
      written.push(fullPath);
    }

    return written;
  }

  private getTurnArtifactDir(turnId: string, legacy = false): string {
    const privateDir = legacy ? LEGACY_PRIVATE_DIR : CODIAN_PRIVATE_DIR;
    return path.join(this.getVaultPath(), ...privateDir, 'rewind', turnId);
  }

  private async backupFileForTurn(
    artifact: TurnArtifact,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const filePath = getPathFromToolInput(toolName, input);
    if (!filePath) {
      return;
    }

    const normalized = normalizePathForFilesystem(filePath);
    const absolute = path.isAbsolute(normalized)
      ? normalized
      : path.join(this.getVaultPath(), normalized);
    if (artifact.backups.some(entry => entry.originalPath === absolute)) {
      return;
    }

    await fs.promises.mkdir(this.getTurnArtifactDir(artifact.turnId), { recursive: true });
    const backupFile = path.join(this.getTurnArtifactDir(artifact.turnId), `backup-${artifact.backups.length}`);

    try {
      await fs.promises.copyFile(absolute, backupFile);
      artifact.backups.push({
        originalPath: absolute,
        backupPath: backupFile,
        existedBefore: true,
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        artifact.backups.push({
          originalPath: absolute,
          existedBefore: false,
        });
      } else {
        artifact.opaqueSideEffects = true;
      }
    }

    artifact.filesChanged.push(absolute);
  }

  private async persistTurnArtifact(artifact: TurnArtifact): Promise<void> {
    const manifestPath = path.join(this.getTurnArtifactDir(artifact.turnId), 'manifest.json');
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(manifestPath, JSON.stringify(artifact, null, 2));
  }

  private async loadTurnArtifact(turnId: string): Promise<TurnArtifact | null> {
    const manifestPaths = [
      path.join(this.getTurnArtifactDir(turnId), 'manifest.json'),
      path.join(this.getTurnArtifactDir(turnId, true), 'manifest.json'),
    ];

    for (const manifestPath of manifestPaths) {
      try {
        const raw = await fs.promises.readFile(manifestPath, 'utf8');
        return JSON.parse(raw) as TurnArtifact;
      } catch {
        // Try the next candidate path.
      }
    }

    return null;
  }

  private async restoreTurnArtifact(artifact: TurnArtifact): Promise<void> {
    for (const entry of artifact.backups) {
      if (!entry.existedBefore) {
        await fs.promises.rm(entry.originalPath, { recursive: true, force: true });
        continue;
      }

      await fs.promises.mkdir(path.dirname(entry.originalPath), { recursive: true });
      if (entry.backupPath) {
        await fs.promises.copyFile(entry.backupPath, entry.originalPath);
      }
    }
  }

  private captureGitRewindSnapshot(): GitRewindSnapshot | null {
    if (process.platform === 'win32') {
      return null;
    }

    try {
      const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: this.getVaultPath(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (!repoRoot) {
        return null;
      }

      let hasHead = true;
      try {
        execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
          cwd: repoRoot,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } catch {
        hasHead = false;
      }

      const dirtyPaths = new Set<string>();

      if (hasHead) {
        const dirtyTracked = execFileSync('git', ['diff', '--name-only', '--relative', '-z', 'HEAD', '--'], {
          cwd: repoRoot,
          encoding: 'buffer',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        dirtyTracked
          .toString('utf8')
          .split('\0')
          .map(entry => entry.trim())
          .filter(Boolean)
          .forEach(entry => dirtyPaths.add(entry.replace(/\\/g, '/')));
      }

      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
        cwd: repoRoot,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      untracked
        .toString('utf8')
        .split('\0')
        .map(entry => entry.trim())
        .filter(Boolean)
        .forEach(entry => dirtyPaths.add(entry.replace(/\\/g, '/')));

      const ignored = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], {
        cwd: repoRoot,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      ignored
        .toString('utf8')
        .split('\0')
        .map(entry => entry.trim())
        .filter(Boolean)
        .forEach(entry => dirtyPaths.add(entry.replace(/\\/g, '/')));

      return { repoRoot, hasHead, dirtyPaths };
    } catch {
      return null;
    }
  }

  private pathExistsInGitHead(repoRoot: string, relativePath: string): boolean {
    try {
      execFileSync('git', ['cat-file', '-e', `HEAD:${relativePath}`], {
        cwd: repoRoot,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }

  private async backfillBackupForChangedFile(
    artifact: TurnArtifact,
    snapshot: GitRewindSnapshot | null,
    filePath: string,
  ): Promise<void> {
    if (!filePath) {
      artifact.opaqueSideEffects = true;
      return;
    }

    const normalized = normalizePathForFilesystem(filePath);
    const absolute = path.isAbsolute(normalized)
      ? normalized
      : path.join(this.getVaultPath(), normalized);

    if (artifact.backups.some(entry => entry.originalPath === absolute)) {
      return;
    }

    artifact.filesChanged.push(absolute);
    await fs.promises.mkdir(this.getTurnArtifactDir(artifact.turnId), { recursive: true });

    if (!snapshot) {
      artifact.opaqueSideEffects = true;
      return;
    }

    const relativePath = path.relative(snapshot.repoRoot, absolute).replace(/\\/g, '/');
    const isWithinRepo = !!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    const canRestoreFromGit = isWithinRepo && snapshot.hasHead && !snapshot.dirtyPaths.has(relativePath);

    if (!canRestoreFromGit) {
      artifact.opaqueSideEffects = true;
      return;
    }

    const existedInHead = this.pathExistsInGitHead(snapshot.repoRoot, relativePath);
    if (!existedInHead) {
      artifact.backups.push({
        originalPath: absolute,
        existedBefore: false,
      });
      return;
    }

    const backupFile = path.join(this.getTurnArtifactDir(artifact.turnId), `backup-${artifact.backups.length}`);

    try {
      const previousContent = execFileSync('git', ['show', `HEAD:${relativePath}`], {
        cwd: snapshot.repoRoot,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      await fs.promises.writeFile(backupFile, previousContent);
      artifact.backups.push({
        originalPath: absolute,
        backupPath: backupFile,
        existedBefore: true,
      });
    } catch {
      artifact.opaqueSideEffects = true;
    }
  }

  async *query(
    prompt: string,
    images?: ImageAttachment[],
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const acpPath = this.plugin.getResolvedCodexAcpPath();
    if (!acpPath) {
      yield { type: 'error', content: 'codex-acp not found. Install codex-acp and configure its path in settings.' };
      return;
    }

    const turnId = randomUUID();
    const assistantId = randomUUID();
    const artifact: TurnArtifact = {
      turnId,
      sessionId: this.sessionManager.getSessionId(),
      filesChanged: [],
      backups: [],
      opaqueSideEffects: false,
      createdAt: Date.now(),
    };
    const gitRewindSnapshot = this.captureGitRewindSnapshot();
    this.abortController = new AbortController();
    this.promptInFlight = true;
    this.notifyReadyStateChange();

    yield { type: 'sdk_user_uuid', uuid: turnId };
    yield { type: 'sdk_user_sent', uuid: turnId };

    try {
      const desiredModel = queryOptions?.model || this.plugin.settings.model;
      const forceNewSession = !this.sessionManager.getSessionId()
        || !!queryOptions?.forceColdStart
        || !!this.pendingResumeAt
        || this.pendingForkSession
        || this.sessionManager.needsHistoryRebuild();

      if (forceNewSession) {
        this.sessionManager.setPendingModel(desiredModel);
      }

      const { sessionId, promptBlocks } = await this.ensureAcpSession(
        desiredModel,
        forceNewSession,
        conversationHistory,
        prompt,
        images,
        queryOptions,
      );
      this.attachedSessionId = sessionId;
      this.openTurnState(sessionId, artifact, gitRewindSnapshot);

      const promptPromise = this.acpRuntime!.prompt(sessionId, promptBlocks)
        .then(() => {
          this.closeTurnState();
        })
        .catch((error) => {
          this.closeTurnState(new Error(formatRuntimeErrorMessage(error)));
        });

      while (true) {
        const chunk = await this.nextTurnChunk();
        if (!chunk) {
          break;
        }
        yield chunk;
      }

      await promptPromise;

      if (artifact.backups.length > 0 || artifact.opaqueSideEffects) {
        artifact.sessionId = this.sessionManager.getSessionId();
        await this.persistTurnArtifact(artifact);
      }
    } catch (error) {
      const message = formatRuntimeErrorMessage(error);
      if (isSessionExpiredError(error)) {
        this.sessionManager.invalidateSession();
        this.attachedSessionId = null;
      }
      yield { type: 'error', content: message };
    } finally {
      this.sessionManager.clearPendingModel();
      this.resetTurnState();
      this.abortController = null;
      this.pendingResumeAt = undefined;
      this.pendingForkSession = false;
      this.promptInFlight = false;
      this.notifyReadyStateChange();
    }

    yield { type: 'sdk_assistant_uuid', uuid: assistantId };
    yield { type: 'done' };
  }

  cancel(): void {
    this.approvalDismisser?.();
    this.abortController?.abort();
    if (this.promptInFlight && this.activeTurnSessionId) {
      void this.acpRuntime?.cancel(this.activeTurnSessionId);
      this.sessionManager.markInterrupted();
    }
  }

  resetSession(): void {
    this.cancel();
    this.sessionManager.reset();
    this.attachedSessionId = null;
    this.pendingResumeAt = undefined;
    this.pendingForkSession = false;
    this.notifyReadyStateChange();
  }

  getSessionId(): string | null {
    return this.sessionManager.getSessionId();
  }

  consumeSessionInvalidation(): boolean {
    return this.sessionManager.consumeInvalidation();
  }

  isReady(): boolean {
    return !!this.plugin.getResolvedCodexAcpPath() && !this.promptInFlight;
  }

  isPersistentQueryActive(): boolean {
    return this.promptInFlight;
  }

  closePersistentQuery(_reason?: string, _options?: unknown): void {
    this.cancel();
    void this.disconnectAcpRuntime();
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [...this.supportedCommands];
  }

  setSessionId(id: string | null, externalContextPaths?: string[]): void {
    this.currentExternalContextPaths = externalContextPaths ? [...externalContextPaths] : [];
    this.sessionManager.setSessionId(id, this.plugin.settings.model);
    if (id !== this.attachedSessionId) {
      this.attachedSessionId = null;
    }
    this.notifyReadyStateChange();
  }

  cleanup(): void {
    this.cancel();
    this.resetSession();
    void this.disconnectAcpRuntime();
  }

  async rewindFiles(sdkUserUuid: string, _dryRun?: boolean): Promise<RewindFilesResult> {
    return this.rewind(sdkUserUuid, '', [{ turnId: sdkUserUuid, expectsFileRestore: true }]);
  }

  async rewind(
    sdkUserUuid: string,
    sdkAssistantUuid: string,
    turnSpecs?: RewindTurnSpec[],
  ): Promise<RewindFilesResult> {
    const rewindTurns = turnSpecs && turnSpecs.length > 0
      ? turnSpecs
      : [{ turnId: sdkUserUuid, expectsFileRestore: true }];
    const restoredFiles = new Set<string>();
    const missingArtifacts: string[] = [];
    const unsafeTurns: string[] = [];
    const warnings: string[] = [];

    try {
      for (const turn of [...rewindTurns].reverse()) {
        const artifact = await this.loadTurnArtifact(turn.turnId);
        if (!artifact) {
          if (turn.expectsFileRestore) {
            missingArtifacts.push(turn.turnId);
            warnings.push(`No rewind data is available for turn ${turn.turnId}.`);
          }
          continue;
        }

        if (artifact.opaqueSideEffects) {
          unsafeTurns.push(turn.turnId);
          warnings.push(`Turn ${turn.turnId} used opaque side effects and its file changes were not restored.`);
          continue;
        }

        await this.restoreTurnArtifact(artifact);
        for (const filePath of artifact.filesChanged) {
          restoredFiles.add(filePath);
        }
      }
    } catch (error) {
      return {
        conversationRewound: false,
        restoredFiles: Array.from(restoredFiles),
        missingArtifacts,
        unsafeTurns,
        warnings,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    this.sessionManager.invalidateSession();
    this.pendingResumeAt = sdkAssistantUuid || undefined;

    return {
      conversationRewound: true,
      restoredFiles: Array.from(restoredFiles),
      missingArtifacts,
      unsafeTurns,
      warnings,
      insertions: 0,
      deletions: 0,
    };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(dismisser: (() => void) | null): void {
    this.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserQuestionCallback = callback;
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setSubagentHookProvider(_getState: () => unknown): void {
    // Subagent hook integration is not implemented for the Codex CLI path yet.
  }

  setAutoTurnCallback(callback: ((chunks: StreamChunk[]) => void) | null): void {
    this.autoTurnCallback = callback;
  }
}

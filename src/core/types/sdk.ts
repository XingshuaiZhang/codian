export interface SDKTextContentBlock {
  type: 'text';
  text: string;
}

export interface SDKThinkingContentBlock {
  type: 'thinking';
  thinking: string;
}

export interface SDKToolUseContentBlock {
  type: 'tool_use';
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface SDKToolResultContentBlock {
  type: 'tool_result';
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface SDKImageContentBlock {
  type: 'image';
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type SDKContentBlock =
  | SDKTextContentBlock
  | SDKThinkingContentBlock
  | SDKToolUseContentBlock
  | SDKToolResultContentBlock
  | SDKImageContentBlock;

export interface SDKAssistantPayload {
  role?: string;
  model?: string;
  content?: string | SDKContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface SDKSystemMessage {
  type: 'system';
  subtype?: string;
  session_id?: string;
  agents?: string[];
  permissionMode?: string;
  apiKeySource?: string;
  cli_version?: string;
  cwd?: string;
  tools?: unknown[];
  mcp_servers?: unknown[];
  model?: string;
  slash_commands?: unknown[];
  output_style?: string;
  skills?: unknown[];
  plugins?: unknown[];
  uuid?: string;
}

export interface SDKStatusMessage extends SDKSystemMessage {
  subtype: 'status';
  status?: unknown;
}

export interface SDKCompactBoundaryMessage extends SDKSystemMessage {
  subtype: 'compact_boundary';
  compact_metadata?: {
    trigger?: string;
    pre_tokens?: number;
  };
}

export interface SDKAssistantMessage {
  type: 'assistant';
  parent_tool_use_id?: string | null;
  error?: string;
  uuid?: string;
  session_id?: string;
  message?: SDKAssistantPayload;
}

export interface SDKUserMessage {
  type: 'user';
  parent_tool_use_id?: string | null;
  session_id?: string;
  tool_use_result?: unknown;
  message: {
    role?: string;
    content?: string | SDKContentBlock[];
  };
}

export interface SDKStreamEventMessage {
  type: 'stream_event';
  parent_tool_use_id?: string | null;
  session_id?: string;
  uuid?: string;
  event?: {
    type?: string;
    content_block?: Partial<SDKContentBlock>;
    delta?: {
      type?: string;
      text?: string;
      thinking?: string;
    };
  };
}

export interface SDKPartialAssistantMessage extends SDKStreamEventMessage {
  type: 'stream_event';
}

export interface SDKResultMessage {
  type: 'result';
  subtype: string;
  errors?: string[];
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    webSearchRequests?: number;
    costUSD?: number;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  stop_reason?: string | null;
  total_cost_usd?: number;
  permission_denials?: unknown[];
  session_id?: string;
  uuid?: string;
}

export interface SDKResultError extends SDKResultMessage {
  subtype: Exclude<string, 'success'>;
  errors: string[];
}

export interface SDKResultSuccess extends SDKResultMessage {
  subtype: 'success';
}

export interface SDKToolProgressMessage {
  type: 'tool_progress';
  tool_use_id?: string;
  tool_name?: string;
  parent_tool_use_id?: string | null;
  elapsed_time_seconds?: number;
  uuid?: string;
  session_id?: string;
}

export interface SDKAuthStatusMessage {
  type: 'auth_status';
  isAuthenticating?: boolean;
  output?: unknown[];
  uuid?: string;
  session_id?: string;
}

export type SDKMessage =
  | SDKSystemMessage
  | SDKStatusMessage
  | SDKCompactBoundaryMessage
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKStreamEventMessage
  | SDKPartialAssistantMessage
  | SDKResultMessage
  | SDKResultSuccess
  | SDKToolProgressMessage
  | SDKAuthStatusMessage;

export interface HookCallbackMatcher {
  matcher?: string;
  hooks: Array<
    (
      hookInput: unknown,
      toolUseId?: string,
      options?: unknown
    ) => Promise<Record<string, unknown>>
  >;
}

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

export interface SpawnedProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream | null;
  killed: boolean;
  exitCode: number | null;
  kill: (signal?: NodeJS.Signals) => void;
  on: (event: 'exit' | 'error', listener: (...args: any[]) => void) => void;
  once: (event: 'exit' | 'error', listener: (...args: any[]) => void) => void;
  off: (event: 'exit' | 'error', listener: (...args: any[]) => void) => void;
}

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg';

export type PermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'delegate'
  | 'dontAsk'
  | 'plan';

export interface PermissionUpdate {
  type: 'addRules' | 'replaceRules' | 'removeRules' | 'setMode' | 'addDirectories' | 'removeDirectories';
  rules?: PermissionRuleValue[];
  behavior?: PermissionBehavior;
  destination: PermissionUpdateDestination;
  mode?: PermissionMode;
  directories?: string[];
}

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;

export interface RuntimeOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  model?: string;
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  abortController?: AbortController;
  pathToCliExecutable?: string;
  resume?: string;
  resumeSessionAt?: string;
  resumeMessageId?: string;
  forkSession?: boolean;
  maxThinkingTokens?: number;
  thinking?: { type: string; budgetTokens?: number };
  effort?: 'low' | 'medium' | 'high' | 'max';
  canUseTool?: CanUseTool;
  systemPrompt?: string | { content: string; cacheControl?: { type: string } };
  mcpServers?: Record<string, unknown>;
  plugins?: string[];
  agents?: Record<string, unknown>;
  settingSources?: ('user' | 'project' | 'local')[];
  spawnCliProcess?: (options: SpawnOptions) => SpawnedProcess;
  hooks?: {
    PreToolUse?: HookCallbackMatcher[];
    PostToolUse?: HookCallbackMatcher[];
    Stop?: HookCallbackMatcher[];
  };
  extraArgs?: Record<string, null>;
  includePartialMessages?: boolean;
  enableFileCheckpointing?: boolean;
  additionalDirectories?: string[];
}

/** Runtime-only extension for blocked user messages (hook denials). */
export type BlockedUserMessage = SDKUserMessage & {
  _blocked: true;
  _blockReason: string;
};

export function isBlockedMessage(message: { type: string }): message is BlockedUserMessage {
  return (
    message.type === 'user' &&
    '_blocked' in message &&
    (message as Record<string, unknown>)._blocked === true &&
    '_blockReason' in message
  );
}

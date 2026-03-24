import type * as acp from '@agentclientprotocol/sdk';

type PromptImpl = (sessionId: string, prompt: acp.ContentBlock[]) => Promise<unknown>;

export class MockCodexAcpRuntime {
  private handlers: {
    onExit?: (error?: Error) => void;
    onSessionUpdate: (params: acp.SessionNotification) => Promise<void>;
    onPermissionRequest: (params: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;
  };

  connected = false;
  sessionId = 'session-1';
  connectOptions: Record<string, unknown> | null = null;
  configOptions: acp.SessionConfigOption[] = createDefaultConfigOptions();
  promptImpl: PromptImpl = async () => ({ stopReason: 'end_turn' });

  constructor(handlers: MockCodexAcpRuntime['handlers']) {
    this.handlers = handlers;
  }

  isConnected = jest.fn(() => this.connected);

  connect = jest.fn(async (options: Record<string, unknown>) => {
    this.connected = true;
    this.connectOptions = options;
  });

  disconnect = jest.fn(async () => {
    this.connected = false;
  });

  getCapabilities = jest.fn(() => null);

  newSession = jest.fn(async () => ({
    sessionId: this.sessionId,
    configOptions: this.configOptions,
    models: null,
    modes: null,
  }));

  loadSession = jest.fn(async (sessionId: string) => ({
    sessionId,
    configOptions: this.configOptions,
    models: null,
    modes: null,
  }));

  setSessionConfigOption = jest.fn(async (_sessionId: string, configId: string, value: string) => {
    this.configOptions = updateConfigOptions(this.configOptions, configId, value);
    return this.configOptions;
  });

  prompt = jest.fn(async (sessionId: string, prompt: acp.ContentBlock[]) => {
    return this.promptImpl(sessionId, prompt);
  });

  cancel = jest.fn(async () => undefined);

  __setPromptImpl(fn: PromptImpl): void {
    this.promptImpl = fn;
  }

  async __emit(update: acp.SessionNotification['update'], sessionId = this.sessionId): Promise<void> {
    await this.handlers.onSessionUpdate({ sessionId, update } as acp.SessionNotification);
  }

  async __requestPermission(
    params: Partial<acp.RequestPermissionRequest> = {}
  ): Promise<acp.RequestPermissionResponse> {
    return this.handlers.onPermissionRequest({
      sessionId: this.sessionId,
      options: [],
      toolCall: null,
      ...params,
    } as acp.RequestPermissionRequest);
  }

  async __exit(error?: Error): Promise<void> {
    this.connected = false;
    this.handlers.onExit?.(error);
  }
}

const runtimeInstances: MockCodexAcpRuntime[] = [];

export const CodexAcpRuntime = jest.fn().mockImplementation((handlers) => {
  const runtime = new MockCodexAcpRuntime(handlers);
  runtimeInstances.push(runtime);
  return runtime;
});

export function resetMockCodexAcpRuntime(): void {
  runtimeInstances.length = 0;
  CodexAcpRuntime.mockClear();
}

export function getLastMockCodexAcpRuntime(): MockCodexAcpRuntime {
  const runtime = runtimeInstances.at(-1);
  if (!runtime) {
    throw new Error('MockCodexAcpRuntime was not instantiated');
  }
  return runtime;
}

function createDefaultConfigOptions(): acp.SessionConfigOption[] {
  return [
    {
      id: 'model',
      category: 'model',
      type: 'select',
      name: 'Model',
      currentValue: 'gpt-5-codex',
      options: [
        { name: 'GPT-5 Codex', value: 'gpt-5-codex' },
        { name: 'GPT-5', value: 'gpt-5' },
        { name: 'GPT-5.4', value: 'gpt-5.4' },
        { name: 'GPT-5.3 Codex', value: 'gpt-5.3-codex' },
        { name: 'GPT-5.2', value: 'gpt-5.2' },
        { name: 'GPT-5.2 Codex', value: 'gpt-5.2-codex' },
      ],
    },
    {
      id: 'reasoning_effort',
      category: 'thought_level',
      type: 'select',
      name: 'Reasoning Effort',
      currentValue: 'high',
      options: [
        { name: 'High', value: 'high' },
        { name: 'XHigh', value: 'xhigh' },
      ],
    },
  ];
}

function updateConfigOptions(
  options: acp.SessionConfigOption[],
  configId: string,
  value: string,
): acp.SessionConfigOption[] {
  return options.map((option) =>
    option.type === 'select' && option.id === configId
      ? {
        ...option,
        currentValue: value,
      }
      : option
  );
}

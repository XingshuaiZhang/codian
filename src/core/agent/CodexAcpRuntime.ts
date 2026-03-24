import type * as acp from '@agentclientprotocol/sdk';
import { type ChildProcessWithoutNullStreams,spawn } from 'child_process';

import { type AcpSdk,loadAcpSdk } from './acpSdk';

export interface CodexAcpConnectOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientName: string;
  clientVersion: string;
}

export interface CodexAcpHandlers {
  onExit?: (error?: Error) => void;
  onSessionUpdate: (params: acp.SessionNotification) => Promise<void>;
  onPermissionRequest: (params: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;
  onExtensionNotification?: (method: string, params: Record<string, unknown>) => Promise<void>;
}

export interface CodexAcpSessionState {
  sessionId: string;
  configOptions?: acp.SessionConfigOption[] | null;
  models?: acp.NewSessionResponse['models'] | null;
  modes?: acp.NewSessionResponse['modes'] | null;
}

export class CodexAcpRuntime implements acp.Client {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private handlers: CodexAcpHandlers;
  private capabilities: acp.AgentCapabilities | null = null;
  private hasClosed = false;
  private sdk: AcpSdk | null = null;

  constructor(handlers: CodexAcpHandlers) {
    this.handlers = handlers;
  }

  async connect(options: CodexAcpConnectOptions): Promise<void> {
    await this.disconnect();
    const acpSdk = await loadAcpSdk();
    this.sdk = acpSdk;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    this.hasClosed = false;

    const input = new WritableStream<Uint8Array>({
      write(chunk: Uint8Array) {
        child.stdin.write(chunk);
      },
      close() {
        child.stdin.end();
      },
    });
    const output = new ReadableStream<Uint8Array>({
      start(controller) {
        child.stdout.on('data', (chunk: Uint8Array) => controller.enqueue(chunk));
        child.stdout.on('end', () => controller.close());
      },
    });

    const stream = acpSdk.ndJsonStream(input, output);
    const connection = new acpSdk.ClientSideConnection(() => this, stream);
    this.connection = connection;

    const closeWithError = (error?: Error): void => {
      if (this.hasClosed) return;
      this.hasClosed = true;
      this.connection = null;
      this.child = null;
      this.capabilities = null;
      this.handlers.onExit?.(error);
    };

    child.once('error', (error) => {
      closeWithError(error);
    });
    child.once('close', (code, signal) => {
      const detail = signal
        ? `codex-acp exited via signal ${signal}`
        : `codex-acp exited with code ${code ?? 0}`;
      closeWithError(new Error(detail));
    });

    try {
      const init = await connection.initialize({
        protocolVersion: acpSdk.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
          terminal: false,
        },
        clientInfo: {
          name: options.clientName,
          version: options.clientVersion,
        },
      });
      this.capabilities = init.agentCapabilities ?? null;
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connection !== null && this.child !== null;
  }

  getCapabilities(): acp.AgentCapabilities | null {
    return this.capabilities;
  }

  async newSession(cwd: string, mcpServers: acp.NewSessionRequest['mcpServers'] = []): Promise<CodexAcpSessionState> {
    const connection = this.requireConnection();
    const result = await connection.newSession({ cwd, mcpServers });
    return {
      sessionId: result.sessionId,
      configOptions: result.configOptions,
      models: result.models,
      modes: result.modes,
    };
  }

  async loadSession(sessionId: string, cwd: string, mcpServers: acp.LoadSessionRequest['mcpServers'] = []): Promise<CodexAcpSessionState> {
    const connection = this.requireConnection();
    const result = await connection.loadSession({ sessionId, cwd, mcpServers });
    return {
      sessionId,
      configOptions: result.configOptions,
      models: result.models,
      modes: result.modes,
    };
  }

  async setSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string
  ): Promise<acp.SessionConfigOption[]> {
    const connection = this.requireConnection();
    const result = await connection.setSessionConfigOption({
      sessionId,
      configId,
      value,
    });
    return result.configOptions;
  }

  async prompt(sessionId: string, prompt: acp.ContentBlock[]): Promise<acp.PromptResponse> {
    const connection = this.requireConnection();
    return connection.prompt({ sessionId, prompt });
  }

  async cancel(sessionId: string): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    try {
      await connection.cancel({ sessionId });
    } catch {
      // Best effort: cancellation races are expected.
    }
  }

  async disconnect(): Promise<void> {
    const child = this.child;
    this.connection = null;
    this.capabilities = null;
    this.child = null;
    this.hasClosed = true;
    this.sdk = null;
    if (child) {
      child.kill();
    }
  }

  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    return this.handlers.onPermissionRequest(params);
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    await this.handlers.onSessionUpdate(params);
  }

  async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.handlers.onExtensionNotification) {
      await this.handlers.onExtensionNotification(method, params);
    }
  }

  private requireConnection(): acp.ClientSideConnection {
    if (!this.connection) {
      throw new Error('codex-acp is not connected');
    }
    return this.connection;
  }
}

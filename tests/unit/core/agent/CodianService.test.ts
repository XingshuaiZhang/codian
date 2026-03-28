import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execFileSync: jest.fn(),
  };
});

jest.mock('@/core/agent/CodexAcpRuntime');

import { CodianService } from '@/core/agent/CodianService';
import type { ChatMessage, ImageAttachment, StreamChunk } from '@/core/types';

import {
  getLastMockCodexAcpRuntime,
  type MockCodexAcpRuntime,
  resetMockCodexAcpRuntime,
} from '../../../helpers/mockCodexAcpRuntime';

const execFileSyncMock = execFileSync as jest.MockedFunction<typeof execFileSync>;

function createMockPlugin(vaultPath: string, settings: Record<string, unknown> = {}) {
  return {
    app: {
      vault: {
        adapter: {
          basePath: vaultPath,
        },
      },
    },
    manifest: {
      version: '1.0.0',
    },
    settings: {
      model: 'gpt-5-codex',
      effortLevel: 'high',
      permissionMode: 'yolo',
      allowExternalAccess: false,
      mediaFolder: '',
      systemPrompt: '',
      allowedExportPaths: [],
      userName: '',
      codexRuntimeMode: 'native',
      wslDistribution: '',
      wslCodexPath: 'codex',
      wslCodexAcpPath: 'codex-acp',
      ...settings,
    },
    getResolvedCodexCliPath: jest.fn().mockReturnValue('/usr/local/bin/codex'),
    getResolvedCodexAcpPath: jest.fn().mockReturnValue('/usr/local/bin/codex-acp'),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
  } as any;
}

function createMockMcpManager() {
  return {
    loadServers: jest.fn().mockResolvedValue(undefined),
  } as any;
}

async function collectChunks(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('CodianService', () => {
  let vaultPath: string;
  let plugin: any;
  let service: CodianService;
  let mcpManager: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockCodexAcpRuntime();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codian-service-unit-'));
    plugin = createMockPlugin(vaultPath);
    mcpManager = createMockMcpManager();
    service = new CodianService(plugin, mcpManager);
  });

  afterEach(async () => {
    service.cleanup();
    await fs.promises.rm(vaultPath, { recursive: true, force: true });
  });

  async function getReadyRuntime(): Promise<MockCodexAcpRuntime> {
    const ready = await service.ensureReady();
    expect(ready).toBe(true);
    return getLastMockCodexAcpRuntime();
  }

  it('tracks session IDs and resets them', () => {
    expect(service.getSessionId()).toBeNull();

    service.setSessionId('session-123');
    expect(service.getSessionId()).toBe('session-123');

    service.resetSession();
    expect(service.getSessionId()).toBeNull();
  });

  it('applies fork state by invalidating the current session', () => {
    service.setSessionId('existing-session');

    const result = service.applyForkState({
      sessionId: null,
      sdkSessionId: undefined,
      forkSource: { sessionId: 'source-session', resumeAt: 'msg-1' },
    });

    expect(result).toBeNull();
    expect(service.getSessionId()).toBeNull();
    expect(service.consumeSessionInvalidation()).toBe(true);
  });

  it('notifies ready-state listeners and ensureReady reflects codex-acp availability', async () => {
    const listener = jest.fn();
    const dispose = service.onReadyStateChange(listener);

    expect(listener).toHaveBeenCalledWith(true);

    plugin.getResolvedCodexAcpPath.mockReturnValue(null);
    const ready = await service.ensureReady({ sessionId: 'session-1', externalContextPaths: ['/ctx'] });

    expect(ready).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(service.getSessionId()).toBe('session-1');

    dispose();
  });

  it('reloads MCP servers through the manager', async () => {
    await service.reloadMcpServers();
    expect(mcpManager.loadServers).toHaveBeenCalled();
  });

  it('yields an error when codex-acp is unavailable', async () => {
    plugin.getResolvedCodexAcpPath.mockReturnValue(null);

    const chunks = await collectChunks(service.query('hello'));

    expect(chunks).toEqual([
      { type: 'error', content: 'codex-acp not found. Install codex-acp and configure its path in settings.' },
    ]);
  });

  it('connects codex-acp natively, streams updates, and captures the session', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'thread-123';
    runtime.__setPromptImpl(async () => {
      await runtime.__emit({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'cmd-1',
        kind: 'execute',
        title: 'ls -la',
        status: 'completed',
        rawInput: { parsed_cmd: [{ cmd: 'ls -la' }] },
        rawOutput: { aggregated_output: 'file-a', exit_code: 0 },
      } as any);
      await runtime.__emit({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello from Codex ACP' },
      } as any);
      await runtime.__emit({
        sessionUpdate: 'usage_update',
        used: 15,
        size: 100,
      } as any);
      return { stopReason: 'end_turn' } as any;
    });

    const chunks = await collectChunks(service.query('hello'));

    expect(chunks[0].type).toBe('sdk_user_uuid');
    expect(chunks[1].type).toBe('sdk_user_sent');
    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'tool_use', id: 'cmd-1', name: 'Bash', input: { command: 'ls -la' } },
      { type: 'tool_result', id: 'cmd-1', content: 'file-a', isError: false },
      { type: 'text', content: 'Hello from Codex ACP' },
      {
        type: 'usage',
        usage: expect.objectContaining({
          model: 'gpt-5-codex',
          contextWindow: 100,
          contextTokens: 15,
          percentage: 15,
        }),
        sessionId: 'thread-123',
      },
      { type: 'done' },
    ]));
    expect(service.getSessionId()).toBe('thread-123');
    expect(runtime.connect).toHaveBeenCalledWith(expect.objectContaining({
      command: '/usr/local/bin/codex-acp',
      args: [],
      cwd: vaultPath,
    }));
  });

  it('rebuilds prompt context from history when no session exists', async () => {
    const runtime = await getReadyRuntime();
    let promptText = '';
    runtime.__setPromptImpl(async (_sessionId, promptBlocks) => {
      promptText = (promptBlocks[0] as any).text;
      return { stopReason: 'end_turn' } as any;
    });

    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Earlier question', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Earlier answer', timestamp: 2 },
    ];

    await collectChunks(service.query('Follow up question', undefined, history));

    expect(promptText).toContain('Earlier question');
    expect(promptText).toContain('Earlier answer');
    expect(promptText).toContain('Follow up question');
  });

  it('reuses the attached ACP session without rebuilding history by default', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'session-789';
    runtime.__setPromptImpl(async () => ({ stopReason: 'end_turn' } as any));

    await collectChunks(service.query('Initial prompt'));

    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Earlier question', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Earlier answer', timestamp: 2 },
    ];

    let promptText = '';
    runtime.__setPromptImpl(async (_sessionId, promptBlocks) => {
      promptText = (promptBlocks[0] as any).text;
      return { stopReason: 'end_turn' } as any;
    });

    await collectChunks(service.query('Current prompt', undefined, history));

    expect(runtime.newSession).toHaveBeenCalledTimes(1);
    expect(promptText).toContain('Current prompt');
    expect(promptText).not.toContain('Earlier question');
  });

  it('supports model overrides and plan mode prompt settings through ACP config options', async () => {
    plugin.settings.permissionMode = 'plan';
    plugin.settings.model = 'gpt-5-codex';
    service = new CodianService(plugin, mcpManager);

    const runtime = await getReadyRuntime();
    runtime.sessionId = 'session-plan';
    runtime.configOptions = [
      {
        id: 'model',
        category: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gpt-5-codex',
        options: [
          { name: 'GPT-5 Codex', value: 'gpt-5-codex' },
          { name: 'GPT-5', value: 'gpt-5' },
        ],
      },
      {
        id: 'reasoning_effort',
        category: 'thought_level',
        type: 'select',
        name: 'Reasoning Effort',
        currentValue: 'xhigh',
        options: [
          { name: 'High', value: 'high' },
          { name: 'XHigh', value: 'xhigh' },
        ],
      },
    ] as any;

    let promptText = '';
    runtime.__setPromptImpl(async (_sessionId, promptBlocks) => {
      promptText = (promptBlocks[0] as any).text;
      return { stopReason: 'end_turn' } as any;
    });

    await collectChunks(service.query('Think first', undefined, undefined, { model: 'gpt-5' }));

    expect(runtime.setSessionConfigOption).toHaveBeenCalledWith('session-plan', 'model', 'gpt-5');
    expect(runtime.setSessionConfigOption).toHaveBeenCalledWith('session-plan', 'reasoning_effort', 'high');
    expect(promptText).toContain('Plan mode is enabled.');
    expect(promptText).toContain('Think first');
  });

  it('passes image attachments to ACP as image content blocks', async () => {
    const runtime = await getReadyRuntime();
    let promptBlocksSeen: any[] = [];
    runtime.__setPromptImpl(async (_sessionId, promptBlocks) => {
      promptBlocksSeen = promptBlocks as any[];
      return { stopReason: 'end_turn' } as any;
    });

    const image: ImageAttachment = {
      id: 'img-1',
      name: 'diagram.png',
      mediaType: 'image/png',
      data: Buffer.from('png-data').toString('base64'),
      size: 8,
      source: 'file',
    };

    await collectChunks(service.query('Inspect image', [image]));

    expect(promptBlocksSeen).toHaveLength(2);
    expect(promptBlocksSeen[0]).toEqual(expect.objectContaining({ type: 'text' }));
    expect(promptBlocksSeen[1]).toEqual({
      type: 'image',
      data: image.data,
      mimeType: 'image/png',
    });
  });

  it('wraps codex-acp execution in WSL when configured', async () => {
    plugin = createMockPlugin('C:\\Vault', {
      codexRuntimeMode: 'wsl',
      wslDistribution: 'Ubuntu',
      wslCodexAcpPath: 'codex-acp',
    });
    plugin.getResolvedCodexAcpPath.mockReturnValue('codex-acp');
    service = new CodianService(plugin, mcpManager);

    const runtime = await getReadyRuntime();
    const connectOptions = runtime.connect.mock.calls[0][0] as any;

    expect(connectOptions.command).toBe('wsl.exe');
    expect(connectOptions.args.slice(0, 9)).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/Vault',
      '--exec',
      '/bin/bash',
      '-lc',
      expect.any(String),
      'bash',
    ]);
    expect(connectOptions.args[9]).toBe('codex-acp');
    expect(connectOptions.args[7]).toContain('exec "$@"');
    expect(connectOptions.args[7]).toContain('. "$HOME/.nvm/nvm.sh"');
    expect(connectOptions.cwd).toBe('C:\\Vault');
  });

  it('forwards custom environment variables explicitly into WSL exec', async () => {
    plugin = createMockPlugin('C:\\Vault', {
      codexRuntimeMode: 'wsl',
      wslDistribution: 'Ubuntu',
      wslCodexAcpPath: 'codex-acp',
    });
    plugin.getResolvedCodexAcpPath.mockReturnValue('codex-acp');
    plugin.getActiveEnvironmentVariables.mockReturnValue([
      'OPENAI_API_KEY=sk-test',
      'OPENAI_BASE_URL=https://api.example.com',
      'HTTP_PROXY=http://127.0.0.1:7890',
      'NO_PROXY=localhost,127.0.0.1,::1',
    ].join('\n'));
    service = new CodianService(plugin, mcpManager);

    const runtime = await getReadyRuntime();
    const connectOptions = runtime.connect.mock.calls[0][0] as any;

    expect(connectOptions.command).toBe('wsl.exe');
    expect(connectOptions.args).toEqual(expect.arrayContaining([
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/Vault',
      '--exec',
      '/usr/bin/env',
      'HTTP_PROXY=http://127.0.0.1:7890',
      'http_proxy=http://127.0.0.1:7890',
      'NO_PROXY=localhost,127.0.0.1,::1',
      'no_proxy=localhost,127.0.0.1,::1',
      '/bin/bash',
      '-lc',
      expect.any(String),
      'bash',
      'codex-acp',
    ]));
    expect(connectOptions.args).not.toEqual(expect.arrayContaining([
      'OPENAI_BASE_URL=https://api.example.com',
      'OPENAI_API_KEY=sk-test',
    ]));
    expect(connectOptions.env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    expect(connectOptions.env.http_proxy).toBe('http://127.0.0.1:7890');
    expect(connectOptions.env.NO_PROXY).toBe('localhost,127.0.0.1,::1');
    expect(connectOptions.env.no_proxy).toBe('localhost,127.0.0.1,::1');
    expect(connectOptions.env.OPENAI_API_KEY).toBeUndefined();
    expect(connectOptions.env.OPENAI_BASE_URL).toBeUndefined();
  });

  it('prefers an absolute wsl.exe path when SystemRoot is available', async () => {
    const originalSystemRoot = process.env.SystemRoot;
    const candidate = path.win32.join('C:\\Windows', 'System32', 'wsl.exe');
    process.env.SystemRoot = 'C:\\Windows';
    const existsSpy = jest.spyOn(fs, 'existsSync');
    existsSpy.mockImplementation((target) => String(target) === candidate);

    plugin = createMockPlugin('C:\\Vault', {
      codexRuntimeMode: 'wsl',
      wslCodexAcpPath: '/home/master/.nvm/versions/node/v24.14.0/bin/codex-acp',
    });
    plugin.getResolvedCodexAcpPath.mockReturnValue('/home/master/.nvm/versions/node/v24.14.0/bin/codex-acp');
    service = new CodianService(plugin, mcpManager);

    try {
      const runtime = await getReadyRuntime();
      const connectOptions = runtime.connect.mock.calls[0][0] as any;
      expect(connectOptions.command).toBe(candidate);
      expect(connectOptions.args.slice(0, 4)).toEqual([
        '--cd',
        '/mnt/c/Vault',
        '--exec',
        '/home/master/.nvm/versions/node/v24.14.0/bin/codex-acp',
      ]);
    } finally {
      existsSpy.mockRestore();
      if (originalSystemRoot === undefined) {
        delete process.env.SystemRoot;
      } else {
        process.env.SystemRoot = originalSystemRoot;
      }
    }
  });

  it('cancels the active ACP prompt', async () => {
    const runtime = await getReadyRuntime();
    let resolvePrompt: (() => void) | null = null;
    runtime.__setPromptImpl(async () => new Promise((resolve) => {
      resolvePrompt = () => resolve({ stopReason: 'cancelled' });
    }));

    const pending = collectChunks(service.query('long running'));
    while (runtime.prompt.mock.calls.length === 0) {
      await Promise.resolve();
    }
    service.cancel();
    (resolvePrompt as (() => void) | null)?.();
    await pending;

    expect(runtime.cancel).toHaveBeenCalledWith(runtime.sessionId);
  });

  it('yields prompt errors and completes the turn', async () => {
    const runtime = await getReadyRuntime();
    runtime.__setPromptImpl(async () => {
      throw new Error('Unsupported model for this account.');
    });

    const chunks = await collectChunks(service.query('hello'));

    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'error', content: 'Unsupported model for this account.' },
      { type: 'done' },
    ]));
  });

  it('returns an error when rewind data is missing', async () => {
    const result = await service.rewind('missing-turn', '');

    expect(result).toEqual({
      conversationRewound: true,
      restoredFiles: [],
      missingArtifacts: ['missing-turn'],
      unsafeTurns: [],
      warnings: ['No rewind data is available for turn missing-turn.'],
      insertions: 0,
      deletions: 0,
    });
  });

  it('rewinds files restored from a manifest and invalidates the session', async () => {
    const filePath = path.join(vaultPath, 'notes', 'new.md');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, 'new content');

    const manifestDir = path.join(vaultPath, '.codian', 'obsidian', 'rewind', 'turn-1');
    await fs.promises.mkdir(manifestDir, { recursive: true });
    await fs.promises.writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({
      turnId: 'turn-1',
      sessionId: 'session-1',
      filesChanged: [filePath],
      backups: [{ originalPath: filePath, existedBefore: false }],
      opaqueSideEffects: false,
      createdAt: Date.now(),
    }));

    service.setSessionId('session-1');
    const result = await service.rewind('turn-1', 'assistant-prev');

    expect(result.conversationRewound).toBe(true);
    expect(result.restoredFiles).toEqual([filePath]);
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(service.getSessionId()).toBeNull();
    expect(service.consumeSessionInvalidation()).toBe(true);
  });

  it('allows conversation rewind when later file changes are opaque', async () => {
    const manifestDir = path.join(vaultPath, '.codian', 'obsidian', 'rewind', 'turn-opaque');
    await fs.promises.mkdir(manifestDir, { recursive: true });
    await fs.promises.writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({
      turnId: 'turn-opaque',
      sessionId: 'session-1',
      filesChanged: [],
      backups: [],
      opaqueSideEffects: true,
      createdAt: Date.now(),
    }));

    const result = await service.rewind('turn-opaque', '');

    expect(result).toEqual({
      conversationRewound: true,
      restoredFiles: [],
      missingArtifacts: [],
      unsafeTurns: ['turn-opaque'],
      warnings: ['Turn turn-opaque used opaque side effects and its file changes were not restored.'],
      insertions: 0,
      deletions: 0,
    });
  });

  it('ignores legacy rewind artifacts stored under .codex/obsidian/rewind', async () => {
    const manifestDir = path.join(vaultPath, '.codex', 'obsidian', 'rewind', 'turn-legacy');
    await fs.promises.mkdir(manifestDir, { recursive: true });
    await fs.promises.writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({
      turnId: 'turn-legacy',
      sessionId: 'session-1',
      filesChanged: [],
      backups: [],
      opaqueSideEffects: false,
      createdAt: Date.now(),
    }));

    const result = await service.rewind('turn-legacy', '');

    expect(result).toEqual({
      conversationRewound: true,
      restoredFiles: [],
      missingArtifacts: ['turn-legacy'],
      unsafeTurns: [],
      warnings: ['No rewind data is available for turn turn-legacy.'],
      insertions: 0,
      deletions: 0,
    });
  });

  it('restores later turn artifacts before earlier ones for the same file', async () => {
    const filePath = path.join(vaultPath, 'notes', 'shared.md');
    const firstManifestDir = path.join(vaultPath, '.codian', 'obsidian', 'rewind', 'turn-1');
    const secondManifestDir = path.join(vaultPath, '.codian', 'obsidian', 'rewind', 'turn-2');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.mkdir(firstManifestDir, { recursive: true });
    await fs.promises.mkdir(secondManifestDir, { recursive: true });

    await fs.promises.writeFile(filePath, 'after-second-turn');
    await fs.promises.writeFile(path.join(firstManifestDir, 'backup-0'), 'before-first-turn');
    await fs.promises.writeFile(path.join(secondManifestDir, 'backup-0'), 'after-first-turn');

    await fs.promises.writeFile(path.join(firstManifestDir, 'manifest.json'), JSON.stringify({
      turnId: 'turn-1',
      sessionId: 'session-1',
      filesChanged: [filePath],
      backups: [{
        originalPath: filePath,
        backupPath: path.join(firstManifestDir, 'backup-0'),
        existedBefore: true,
      }],
      opaqueSideEffects: false,
      createdAt: Date.now(),
    }));
    await fs.promises.writeFile(path.join(secondManifestDir, 'manifest.json'), JSON.stringify({
      turnId: 'turn-2',
      sessionId: 'session-1',
      filesChanged: [filePath],
      backups: [{
        originalPath: filePath,
        backupPath: path.join(secondManifestDir, 'backup-0'),
        existedBefore: true,
      }],
      opaqueSideEffects: false,
      createdAt: Date.now(),
    }));

    const result = await service.rewind('turn-1', '', [
      { turnId: 'turn-1', expectsFileRestore: true },
      { turnId: 'turn-2', expectsFileRestore: true },
    ]);

    expect(result.conversationRewound).toBe(true);
    expect(await fs.promises.readFile(filePath, 'utf8')).toBe('before-first-turn');
  });
});

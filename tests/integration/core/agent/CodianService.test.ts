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
import type { StreamChunk } from '@/core/types';

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
    getView: jest.fn().mockReturnValue(null),
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

describe('CodianService integration', () => {
  let vaultPath: string;
  let plugin: any;
  let service: CodianService;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockCodexAcpRuntime();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codian-service-int-'));
    plugin = createMockPlugin(vaultPath);
    service = new CodianService(plugin, createMockMcpManager());
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

  function mockGitRepoSnapshot(
    headFiles: Record<string, string>,
    options?: {
      dirtyPaths?: string[];
      untrackedPaths?: string[];
    },
  ): void {
    execFileSyncMock.mockImplementation((command, args, execOptions) => {
      if (command !== 'git') {
        throw new Error(`Unexpected command: ${String(command)}`);
      }

      const argv = (args ?? []) as string[];
      const encoding = (execOptions as { encoding?: string } | undefined)?.encoding;
      const asBuffer = encoding === 'buffer';
      const output = (value: string) => (asBuffer ? Buffer.from(value, 'utf8') : value) as never;
      const hasHeadFile = (relativePath: string) => Object.prototype.hasOwnProperty.call(headFiles, relativePath);
      const dirtyPaths = options?.dirtyPaths ?? [];
      const untrackedPaths = options?.untrackedPaths ?? [];

      if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
        return output(`${vaultPath}\n`);
      }
      if (argv[0] === 'rev-parse' && argv[1] === '--verify' && argv[2] === 'HEAD') {
        return output('HEAD\n');
      }
      if (argv[0] === 'diff' && argv[1] === '--name-only') {
        return output(dirtyPaths.length > 0 ? `${dirtyPaths.join('\0')}\0` : '');
      }
      if (argv[0] === 'ls-files' && argv[1] === '--others') {
        return output(untrackedPaths.length > 0 ? `${untrackedPaths.join('\0')}\0` : '');
      }
      if (argv[0] === 'cat-file' && argv[1] === '-e') {
        const relativePath = argv[2].replace(/^HEAD:/, '');
        if (hasHeadFile(relativePath)) {
          return output('');
        }
        throw new Error(`fatal: path '${relativePath}' does not exist in HEAD`);
      }
      if (argv[0] === 'show') {
        const relativePath = argv[1].replace(/^HEAD:/, '');
        if (!hasHeadFile(relativePath)) {
          throw new Error(`fatal: path '${relativePath}' does not exist in HEAD`);
        }
        return output(headFiles[relativePath]);
      }

      throw new Error(`Unexpected git command: ${argv.join(' ')}`);
    });
  }

  it('streams incremental agent text and usage from ACP session updates', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'thread-stream';
    runtime.__setPromptImpl(async () => {
      await runtime.__emit({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
      } as any);
      await runtime.__emit({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' world' },
      } as any);
      await runtime.__emit({
        sessionUpdate: 'usage_update',
        used: 18,
        size: 100,
      } as any);
      return { stopReason: 'end_turn' } as any;
    });

    const chunks = await collectChunks(service.query('hello'));

    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'text', content: 'Hello' },
      { type: 'text', content: ' world' },
      {
        type: 'usage',
        usage: expect.objectContaining({
          contextTokens: 18,
          contextWindow: 100,
          percentage: 18,
          model: 'gpt-5-codex',
        }),
        sessionId: 'thread-stream',
      },
      { type: 'done' },
    ]));
    expect(service.getSessionId()).toBe('thread-stream');
  });

  it('persists rewind artifacts for added files and removes them on rewind', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'thread-add';

    const relativePath = path.join('notes', 'generated.md');
    const absolutePath = path.join(vaultPath, relativePath);
    runtime.__setPromptImpl(async () => {
      await runtime.__emit({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'write-1',
        kind: 'edit',
        title: 'Write file',
        status: 'completed',
        rawInput: { parsed_cmd: [{ path: relativePath }] },
        locations: [{ path: relativePath }],
      } as any);
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, '# generated');
      await runtime.__emit({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Created file' },
      } as any);
      return { stopReason: 'end_turn' } as any;
    });

    const chunks = await collectChunks(service.query('create note'));
    const turnIdChunk = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'sdk_user_uuid' }> => chunk.type === 'sdk_user_uuid');
    expect(turnIdChunk).toBeDefined();
    expect(fs.existsSync(absolutePath)).toBe(true);

    const manifestPath = path.join(vaultPath, '.codian', 'obsidian', 'rewind', turnIdChunk!.uuid, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const rewindResult = await service.rewind(turnIdChunk!.uuid, '');
    expect(rewindResult.conversationRewound).toBe(true);
    expect(rewindResult.restoredFiles).toContain(absolutePath);
    expect(fs.existsSync(absolutePath)).toBe(false);
  });

  it('restores bash-updated files when ACP reports changed locations and git history is available', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'thread-bash-existing';

    const relativePath = path.join('notes', 'existing.md');
    const absolutePath = path.join(vaultPath, relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, 'before');
    mockGitRepoSnapshot({ [relativePath.replace(/\\/g, '/')]: 'before' });

    runtime.__setPromptImpl(async () => {
      await fs.promises.writeFile(absolutePath, 'after');
      await runtime.__emit({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'bash-1',
        kind: 'execute',
        title: 'Run shell update',
        status: 'completed',
        locations: [{ path: relativePath }],
        rawInput: { parsed_cmd: [{ cmd: `python update ${relativePath}` }] },
        rawOutput: { aggregated_output: 'updated', exit_code: 0 },
      } as any);
      return { stopReason: 'end_turn' } as any;
    });

    const chunks = await collectChunks(service.query('update note'));
    const turnIdChunk = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'sdk_user_uuid' }> => chunk.type === 'sdk_user_uuid');
    expect(turnIdChunk).toBeDefined();

    const rewindResult = await service.rewind(turnIdChunk!.uuid, '');
    expect(rewindResult.conversationRewound).toBe(true);
    expect(rewindResult.restoredFiles).toContain(absolutePath);
    expect(rewindResult.warnings).toEqual([]);
    expect(await fs.promises.readFile(absolutePath, 'utf8')).toBe('before');
  });

  it('removes bash-created files when ACP reports changed locations and git history shows they were new', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'thread-bash-add';

    const relativePath = path.join('notes', 'new-from-bash.md');
    const absolutePath = path.join(vaultPath, relativePath);
    mockGitRepoSnapshot({});

    runtime.__setPromptImpl(async () => {
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, 'created');
      await runtime.__emit({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'bash-1',
        kind: 'execute',
        title: 'Create file',
        status: 'completed',
        locations: [{ path: relativePath }],
        rawInput: { parsed_cmd: [{ cmd: `touch ${relativePath}` }] },
        rawOutput: { aggregated_output: 'created', exit_code: 0 },
      } as any);
      return { stopReason: 'end_turn' } as any;
    });

    const chunks = await collectChunks(service.query('create note'));
    const turnIdChunk = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'sdk_user_uuid' }> => chunk.type === 'sdk_user_uuid');
    expect(turnIdChunk).toBeDefined();
    expect(fs.existsSync(absolutePath)).toBe(true);

    const rewindResult = await service.rewind(turnIdChunk!.uuid, '');
    expect(rewindResult.conversationRewound).toBe(true);
    expect(rewindResult.restoredFiles).toContain(absolutePath);
    expect(rewindResult.warnings).toEqual([]);
    expect(fs.existsSync(absolutePath)).toBe(false);
  });

  it('marks non-replayable update changes as opaque when no git snapshot is available', async () => {
    const runtime = await getReadyRuntime();
    runtime.sessionId = 'thread-update';

    const relativePath = path.join('notes', 'existing.md');
    const absolutePath = path.join(vaultPath, relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, 'before');

    runtime.__setPromptImpl(async () => {
      await fs.promises.writeFile(absolutePath, 'after');
      await runtime.__emit({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'bash-1',
        kind: 'execute',
        title: 'Run shell update',
        status: 'completed',
        rawInput: { parsed_cmd: [{ cmd: `python update ${relativePath}` }] },
        rawOutput: { aggregated_output: 'updated', exit_code: 0 },
      } as any);
      await runtime.__emit({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Updated file' },
      } as any);
      return { stopReason: 'end_turn' } as any;
    });

    const chunks = await collectChunks(service.query('update note'));
    const turnIdChunk = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'sdk_user_uuid' }> => chunk.type === 'sdk_user_uuid');
    expect(turnIdChunk).toBeDefined();

    const rewindResult = await service.rewind(turnIdChunk!.uuid, '');
    expect(rewindResult).toEqual({
      conversationRewound: true,
      restoredFiles: [],
      missingArtifacts: [],
      unsafeTurns: [turnIdChunk!.uuid],
      warnings: [`Turn ${turnIdChunk!.uuid} used opaque side effects and its file changes were not restored.`],
      insertions: 0,
      deletions: 0,
    });
  });

  it('invalidates the session when ACP prompt reports a session-expired error', async () => {
    const runtime = await getReadyRuntime();
    service.setSessionId('stale-session');

    runtime.__setPromptImpl(async () => {
      throw new Error('resume failed: session expired');
    });

    const chunks = await collectChunks(service.query('resume please'));

    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'error', content: 'resume failed: session expired' },
    ]));
    expect(service.getSessionId()).toBeNull();
    expect(service.consumeSessionInvalidation()).toBe(true);
  });

  it('invalidates the session when ACP prompt reports a model-mismatch error', async () => {
    const runtime = await getReadyRuntime();
    service.setSessionId('stale-session');

    runtime.__setPromptImpl(async () => {
      throw new Error('This session was recorded with model `gpt-5-codex` but is resuming with `gpt-5`.');
    });

    const chunks = await collectChunks(service.query('resume please', undefined, undefined, { model: 'gpt-5' }));

    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'error', content: 'This session was recorded with model `gpt-5-codex` but is resuming with `gpt-5`.' },
    ]));
    expect(service.getSessionId()).toBeNull();
    expect(service.consumeSessionInvalidation()).toBe(true);
  });
});

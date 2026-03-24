import { execFile } from 'child_process';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('@/utils/env', () => ({
  getEnhancedPath: jest.fn((additionalPaths?: string) => additionalPaths || '/usr/bin'),
  getWslForwardedEnvironment: jest.fn((envVars: Record<string, string>) => envVars),
  parseEnvironmentVariables: jest.fn((input: string) => {
    const result: Record<string, string> = {};
    for (const line of input.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key) {
        result[key] = rest.join('=');
      }
    }
    return result;
  }),
  resolveWindowsWslExecutable: jest.fn(() => 'wsl.exe'),
  withProxyAliases: jest.fn((input: Record<string, string>) => input),
}));

jest.mock('@/utils/path', () => ({
  translateWindowsPathToWsl: jest.fn((input: string) => input === 'C:\\Vault' ? '/mnt/c/Vault' : input),
}));

import { BangBashService } from '@/features/chat/services/BangBashService';

const execFileMock = execFile as jest.MockedFunction<typeof execFile>;

describe('BangBashService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should execute native commands via /bin/bash -lc', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, Buffer.from('hello\n'), Buffer.from(''));
      return undefined as any;
    });

    await service.execute('echo hello');

    expect(execFileMock).toHaveBeenCalledWith(
      '/bin/bash',
      ['-lc', expect.any(String), '_', 'echo hello'],
      expect.objectContaining({
        cwd: '/test/dir',
        env: expect.objectContaining({ PATH: '/usr/bin' }),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: 'buffer',
      }),
      expect.any(Function)
    );
  });

  it('should bootstrap native shell commands through the prepared shell wrapper', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, Buffer.from('total 1\n'), Buffer.from(''));
      return undefined as any;
    });

    await service.execute('ll');

    expect(execFileMock).toHaveBeenCalledWith(
      '/bin/bash',
      ['-lc', expect.stringContaining('alias ll'), '_', 'll'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should return stdout for a successful command', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, Buffer.from('hello\n'), Buffer.from(''));
      return undefined as any;
    });

    const result = await service.execute('echo hello');
    expect(result.command).toBe('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('should return non-zero exit code for a failing command', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    const error = Object.assign(new Error('Command failed'), { code: 2 });
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(error, Buffer.from(''), Buffer.from('No such file'));
      return undefined as any;
    });

    const result = await service.execute('ls /nonexistent');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('No such file');
  });

  it('should capture both stdout and stderr', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, Buffer.from('out\n'), Buffer.from('err\n'));
      return undefined as any;
    });

    const result = await service.execute('echo out && echo err >&2');
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
  });

  it('should handle timeout (killed process)', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    const error = Object.assign(new Error('Timed out'), { killed: true });
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(error, Buffer.from(''), Buffer.from(''));
      return undefined as any;
    });

    const result = await service.execute('sleep 999');
    expect(result.exitCode).toBe(124);
    expect(result.error).toContain('timed out');
  });

  it('should handle maxBuffer exceeded (killed process with ERR_CHILD_PROCESS_STDIO_MAXBUFFER)', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    const error = Object.assign(new Error('maxBuffer'), {
      killed: true,
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    });
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(error, Buffer.from('partial output'), Buffer.from(''));
      return undefined as any;
    });

    const result = await service.execute('cat /dev/urandom');
    expect(result.exitCode).toBe(124);
    expect(result.error).toContain('maximum buffer size');
    expect(result.stdout).toBe('partial output');
  });

  it('should not surface redundant error.message for non-zero exit', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    const error = Object.assign(new Error('Command failed: exit 1'), { code: 1 });
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(error, Buffer.from(''), Buffer.from(''));
      return undefined as any;
    });

    const result = await service.execute('exit 1');
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('should handle null stdout/stderr gracefully', async () => {
    const service = new BangBashService('/test/dir', '/usr/bin');
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, null, null);
      return undefined as any;
    });

    const result = await service.execute('test');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should execute commands through WSL on Windows hosts', async () => {
    const service = new BangBashService('C:\\Vault', '/usr/bin', {
      runtimeMode: 'wsl',
      wslDistribution: 'Ubuntu',
      environmentVariables: 'HTTP_PROXY=http://127.0.0.1:7890',
    });
    execFileMock.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, Buffer.from('/mnt/c/Vault\n'), Buffer.from(''));
      return undefined as any;
    });

    await service.execute('pwd');

    expect(execFileMock).toHaveBeenCalledWith(
      'wsl.exe',
      expect.arrayContaining([
        '-d',
        'Ubuntu',
        '--cd',
        '/mnt/c/Vault',
        '--exec',
        '/usr/bin/env',
        'HTTP_PROXY=http://127.0.0.1:7890',
        '/bin/bash',
        '-lc',
        expect.any(String),
        '_',
        'pwd',
      ]),
      expect.objectContaining({
        cwd: 'C:\\Vault',
        encoding: 'buffer',
      }),
      expect.any(Function)
    );
  });
});

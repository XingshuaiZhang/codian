import { execFile } from 'child_process';

import {
  getEnhancedPath,
  getWslForwardedEnvironment,
  parseEnvironmentVariables,
  resolveWindowsWslExecutable,
  withProxyAliases,
} from '../../../utils/env';
import { translateWindowsPathToWsl } from '../../../utils/path';

export interface BangBashResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 1024 * 1024; // 1MB

export interface BangBashServiceOptions {
  runtimeMode?: 'native' | 'wsl';
  wslDistribution?: string;
  environmentVariables?: string;
}

export class BangBashService {
  private cwd: string;
  private enhancedPath: string;
  private options: BangBashServiceOptions;

  constructor(cwd: string, enhancedPath: string, options: BangBashServiceOptions = {}) {
    this.cwd = cwd;
    this.enhancedPath = enhancedPath;
    this.options = options;
  }

  execute(command: string): Promise<BangBashResult> {
    const envVars = withProxyAliases(parseEnvironmentVariables(this.options.environmentVariables || ''));
    const runtimeEnv = {
      ...process.env,
      ...envVars,
      PATH: envVars.PATH ? getEnhancedPath(envVars.PATH) : this.enhancedPath,
    };
    const { file, args, cwd } = this.buildExecution(command, envVars);

    return new Promise((resolve) => {
      execFile(file, args, {
        cwd,
        env: runtimeEnv,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: 'buffer',
        windowsHide: true,
      }, (error, stdout, stderr) => {
        const decodedStdout = decodeOutput(stdout);
        const decodedStderr = decodeOutput(stderr);

        if (error && 'killed' in error && error.killed) {
          // Node.js types declare code as number, but maxBuffer errors set it to a string at runtime
          const isMaxBuffer = 'code' in error && (error.code as unknown) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          resolve({
            command,
            stdout: decodedStdout,
            stderr: decodedStderr,
            exitCode: 124,
            error: isMaxBuffer
              ? 'Output exceeded maximum buffer size (1MB)'
              : `Command timed out after ${TIMEOUT_MS / 1000}s`,
          });
          return;
        }

        resolve({
          command,
          stdout: decodedStdout,
          stderr: decodedStderr,
          exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        });
      });
    });
  }

  private buildExecution(command: string, envVars: Record<string, string>): { file: string; args: string[]; cwd: string } {
    const runtimeMode = process.platform === 'win32'
      ? 'wsl'
      : (this.options.runtimeMode ?? 'native');
    const shellScript = getShellBootstrapScript();

    if (runtimeMode === 'wsl') {
      const translatedCwd = translateWindowsPathToWsl(this.cwd) ?? this.cwd;
      const args: string[] = [];
      if (this.options.wslDistribution?.trim()) {
        args.push('-d', this.options.wslDistribution.trim());
      }
      if (translatedCwd && translatedCwd !== this.cwd) {
        args.push('--cd', translatedCwd);
      }

      const forwardedEnv = getWslForwardedEnvironment(envVars);
      args.push('--exec');
      if (Object.keys(forwardedEnv).length > 0) {
        args.push('/usr/bin/env');
        for (const [key, value] of Object.entries(forwardedEnv)) {
          args.push(`${key}=${value}`);
        }
      }
      args.push('/bin/bash', '-lc', shellScript, '_', command);

      return {
        file: resolveWindowsWslExecutable(),
        args,
        cwd: this.cwd,
      };
    }

    return {
      file: '/bin/bash',
      args: ['-lc', shellScript, '_', command],
      cwd: this.cwd,
    };
  }
}

function getShellBootstrapScript(): string {
  return [
    'for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc"; do',
    '  [ -f "$file" ] && . "$file" >/dev/null 2>&1 || true;',
    'done;',
    'if [ -s "$HOME/.nvm/nvm.sh" ]; then',
    '  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true;',
    '  nvm use default >/dev/null 2>&1 || true;',
    'fi;',
    'shopt -s expand_aliases;',
    'alias ll >/dev/null 2>&1 || alias ll="ls -alF";',
    'alias la >/dev/null 2>&1 || alias la="ls -A";',
    'alias l >/dev/null 2>&1 || alias l="ls -CF";',
    'eval "$1"',
  ].join(' ');
}

function decodeOutput(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!value) {
    return '';
  }
  return value.toString('utf8');
}

import { spawn } from 'child_process';
import * as path from 'path';
import { createInterface } from 'readline';

import { isAdaptiveThinkingModel, toCodexReasoningEffort } from '../core/types/models';
import type CodianPlugin from '../main';
import { omitUnsupportedCodexAuthEnvironmentVariables } from './codexConfig';
import {
  cliPathRequiresNode,
  findNodeExecutable,
  getEnhancedPath,
  getWslForwardedEnvironment,
  parseEnvironmentVariables,
  resolveWindowsWslExecutable,
  withProxyAliases,
} from './env';
import { translateWindowsPathToWsl } from './path';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexTextRunOptions {
  plugin: CodianPlugin;
  prompt: string;
  sessionId?: string | null;
  model?: string;
  sandboxMode?: CodexSandboxMode;
  approvalPolicy?: 'never' | 'on-request' | 'untrusted';
  ephemeral?: boolean;
  imagePaths?: string[];
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
}

export interface CodexTextRunResult {
  text: string;
  sessionId: string | null;
  stderr: string;
  exitCode: number;
}

interface CodexCommandSpec {
  command: string;
  prefixArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
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

function getRuntimeMode(plugin: CodianPlugin): 'native' | 'wsl' {
  if (process.platform === 'win32') {
    return 'wsl';
  }

  return plugin.settings.codexRuntimeMode ?? 'native';
}

function mapPathForRuntime(plugin: CodianPlugin, inputPath: string): string {
  if (getRuntimeMode(plugin) !== 'wsl') {
    return inputPath;
  }

  const translated = translateWindowsPathToWsl(inputPath);
  if (!translated) {
    return inputPath;
  }

  if (translated.includes(':')) {
    const [, wslPath] = translated.split(':', 2);
    return wslPath;
  }

  return translated;
}

function resolveCommand(
  plugin: CodianPlugin,
  cliPath: string,
  envPath: string,
  runtimeCwd: string,
  wslEnv: Record<string, string>
): { command: string; prefixArgs: string[] } {
  const runtimeMode = getRuntimeMode(plugin);
  const nodePath = cliPathRequiresNode(cliPath) ? findNodeExecutable(envPath) : null;

  if (runtimeMode === 'wsl') {
    const command = resolveWindowsWslExecutable();
    const prefixArgs: string[] = [];
    const distro = plugin.settings.wslDistribution?.trim();
    const translatedCwd = mapPathForRuntime(plugin, runtimeCwd);
    const targetCli = cliPath || 'codex';

    if (distro) {
      prefixArgs.push('-d', distro);
    }

    if (translatedCwd && translatedCwd !== runtimeCwd) {
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

function buildCommandSpec(plugin: CodianPlugin): CodexCommandSpec | null {
  const cliPath = plugin.getResolvedCodexCliPath();
  if (!cliPath) {
    return null;
  }

  const envVars = parseEnvironmentVariables(plugin.getActiveEnvironmentVariables());
  const enhancedPath = getEnhancedPath(envVars.PATH, cliPath);
  const cwd = ((plugin.app.vault.adapter as { basePath?: string }).basePath) || '';
  const runtimeEnv = omitUnsupportedCodexAuthEnvironmentVariables(withProxyAliases({
    ...process.env,
    ...envVars,
    PATH: enhancedPath,
  }));
  const { command, prefixArgs } = resolveCommand(
    plugin,
    cliPath,
    enhancedPath,
    cwd,
    omitUnsupportedCodexAuthEnvironmentVariables(getWslForwardedEnvironment(envVars))
  );

  return {
    command,
    prefixArgs,
    cwd,
    env: runtimeEnv,
  };
}

function buildExecArgs(options: CodexTextRunOptions): string[] {
  const args: string[] = [];
  const model = options.model || options.plugin.settings.model;

  if (options.sessionId) {
    args.push('exec', 'resume', options.sessionId);
  } else {
    args.push('exec');
  }

  args.push(
    '--json',
    '--skip-git-repo-check',
    '-c', `approval_policy="${options.approvalPolicy ?? 'never'}"`,
    '-c', `sandbox_mode="${options.sandboxMode ?? 'read-only'}"`,
  );

  if (model && isAdaptiveThinkingModel(model)) {
    args.push(
      '-c',
      `model_reasoning_effort="${toCodexReasoningEffort(options.plugin.settings.effortLevel)}"`,
    );
  }

  if (options.ephemeral) {
    args.push('--ephemeral');
  }

  if (options.model) {
    args.push('-m', options.model);
  }

  for (const imagePath of options.imagePaths ?? []) {
    args.push('-i', imagePath);
  }

  args.push(options.prompt);
  return args;
}

function updateTextState(
  textByItemId: Map<string, string>,
  currentText: string,
  line: string
): { text: string; sessionId?: string; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { text: currentText };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { text: currentText };
  }

  const record = parsed as {
    type?: string;
    thread_id?: string;
    message?: string;
    error?: { message?: string };
    item?: {
      id?: string;
      type?: string;
      text?: string;
      message?: string;
    };
  };

  if (record.type === 'thread.started' && typeof record.thread_id === 'string') {
    return { text: currentText, sessionId: record.thread_id };
  }

  if (record.type === 'error') {
    return {
      text: currentText,
      error: record.error?.message || record.message || record.item?.message || line,
    };
  }

  const item = record.item;
  if (!item || item.type !== 'agent_message' || typeof item.text !== 'string') {
    return { text: currentText };
  }

  const itemId = item.id || 'agent-message';
  const previousText = textByItemId.get(itemId) || '';
  textByItemId.set(itemId, item.text);

  if (item.text.startsWith(previousText)) {
    return {
      text: currentText + item.text.slice(previousText.length),
    };
  }

  return {
    text: currentText ? `${currentText}\n${item.text}` : item.text,
  };
}

export async function runCodexText(options: CodexTextRunOptions): Promise<CodexTextRunResult> {
  const commandSpec = buildCommandSpec(options.plugin);
  if (!commandSpec) {
    throw new Error('Codex CLI not found');
  }

  const child = spawn(
    commandSpec.command,
    [...commandSpec.prefixArgs, ...buildExecArgs(options)],
    {
      cwd: commandSpec.cwd,
      env: commandSpec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  const closePromise = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 0));
  });

  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  const textByItemId = new Map<string, string>();
  const stderrLines: string[] = [];

  let sessionId: string | null = null;
  let text = '';
  let earlyError: string | null = null;

  const abortHandler = () => {
    child.kill();
  };

  options.signal?.addEventListener('abort', abortHandler, { once: true });

  stderr.on('line', (line) => {
    if (line.trim()) {
      stderrLines.push(line.trim());
    }
  });

  try {
    for await (const line of stdout) {
      const next = updateTextState(textByItemId, text, line);
      text = next.text;
      if (next.sessionId) {
        sessionId = next.sessionId;
      }
      if (next.error) {
        earlyError = next.error;
      }
      if (options.onProgress && text) {
        options.onProgress(text);
      }
    }
  } finally {
    stdout.close();
    stderr.close();
    options.signal?.removeEventListener('abort', abortHandler);
  }

  let exitCode: number;
  try {
    exitCode = await closePromise;
  } catch (error) {
    throw new Error(formatRuntimeErrorMessage(error));
  }

  const stderrText = stderrLines.join('\n');

  if (options.signal?.aborted) {
    throw new Error('Cancelled');
  }

  if (exitCode !== 0) {
    throw new Error(stderrText || earlyError || 'Codex CLI exited with a non-zero status');
  }

  if (earlyError) {
    throw new Error(earlyError);
  }

  return {
    text,
    sessionId,
    stderr: stderrText,
    exitCode,
  };
}

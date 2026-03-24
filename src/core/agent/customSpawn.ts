/**
 * Custom spawn logic for the CLI runtime adapter.
 *
 * Provides a custom spawn function that resolves the full path to Node.js
 * instead of relying on PATH lookup. This fixes issues in GUI apps (like Obsidian)
 * where the minimal PATH doesn't include Node.js.
 */

import { spawn } from 'child_process';

import { findNodeExecutable } from '../../utils/env';
import type { SpawnedProcess, SpawnOptions } from '../types/sdk';

export function createCustomSpawnFunction(
  enhancedPath: string
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess => {
    let { command } = options;
    const { args, cwd, env, signal } = options;
    const shouldPipeStderr = !!env?.DEBUG_CODEX_RUNTIME;

    // Resolve full path to avoid PATH lookup issues in GUI apps
    if (command === 'node') {
      const nodeFullPath = findNodeExecutable(enhancedPath);
      if (nodeFullPath) {
        command = nodeFullPath;
      }
    }

    // Do not pass `signal` directly to spawn() — Obsidian's Electron runtime
    // uses a different realm for AbortSignal, causing `instanceof EventTarget`
    // checks inside Node's internals to fail. Handle abort manually instead.
    const child = spawn(command, args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', shouldPipeStderr ? 'pipe' : 'ignore'],
      windowsHide: true,
    });

    if (signal) {
      if (signal.aborted) {
        child.kill();
      } else {
        signal.addEventListener('abort', () => child.kill(), { once: true });
      }
    }

    if (shouldPipeStderr && child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', () => {});
    }

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to create process streams');
    }

    return child as unknown as SpawnedProcess;
  };
}

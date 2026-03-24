import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as parseToml } from 'smol-toml';

import type { CodianMcpServer, SlashCommand } from '../core/types';
import { DEFAULT_MCP_SERVER, isValidMcpServerConfig } from '../core/types';
import {
  getWslForwardedEnvironment,
  parseEnvironmentVariables,
  withProxyAliases,
} from './env';
import { resolveWindowsWslExecutable } from './env';
import { expandHomePath } from './path';
import { parsedToSlashCommand, parseSlashCommandContent } from './slashCommand';

export interface ExternalCodexResourceOptions {
  runtimeMode?: 'native' | 'wsl';
  wslDistribution?: string;
  environmentVariables?: string;
}

export interface RelativeFileReader {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
}

const WSL_MAX_BUFFER = 4 * 1024 * 1024;
export const PROJECT_CODEX_MCP_CONFIG_PATH = '.codex/config.toml';
const RESOLVE_CODEX_HOME_SCRIPT = [
  'codex_home="${CODEX_HOME:-$HOME/.codex}";',
  'case "$codex_home" in',
  '  "~") codex_home="$HOME" ;;',
  '  "~/"*) codex_home="$HOME/${codex_home#~/}" ;;',
  'esac;',
].join(' ');

function shouldUseWsl(options: ExternalCodexResourceOptions): boolean {
  return process.platform === 'win32' || options.runtimeMode === 'wsl';
}

function getNativeCodexHome(options: ExternalCodexResourceOptions): string {
  const envVars = parseEnvironmentVariables(options.environmentVariables || '');
  return expandHomePath(envVars.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'));
}

function getRuntimeEnvironment(options: ExternalCodexResourceOptions): Record<string, string> {
  return withProxyAliases(parseEnvironmentVariables(options.environmentVariables || ''));
}

function execFileText(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      maxBuffer: WSL_MAX_BUFFER,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout ?? '');
    });
  });
}

async function runWslShell(
  options: ExternalCodexResourceOptions,
  script: string,
  ...scriptArgs: string[]
): Promise<string> {
  const args: string[] = [];
  if (options.wslDistribution?.trim()) {
    args.push('-d', options.wslDistribution.trim());
  }

  const forwardedEnv = getWslForwardedEnvironment(getRuntimeEnvironment(options));
  args.push('--exec');
  if (Object.keys(forwardedEnv).length > 0) {
    args.push('/usr/bin/env');
    for (const [key, value] of Object.entries(forwardedEnv)) {
      args.push(`${key}=${value}`);
    }
  }
  args.push('/bin/bash', '-lc', script, '_', ...scriptArgs);

  return execFileText(resolveWindowsWslExecutable(), args);
}

function buildGlobalSkill(skillPath: string, content: string): SlashCommand | null {
  const skillName = path.basename(path.dirname(skillPath));
  if (!skillName) return null;

  try {
    const parsed = parseSlashCommandContent(content);
    return parsedToSlashCommand(parsed, {
      id: `skill-global-${skillName}`,
      name: skillName,
      source: 'global',
    });
  } catch {
    return null;
  }
}

async function collectExistingSkillPaths(skillRoots: string[]): Promise<string[]> {
  const existing = new Set<string>();

  for (const skillsDir of skillRoots) {
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          await fs.access(skillPath);
          existing.add(skillPath);
        } catch {
          // Ignore missing SKILL.md entries
        }
      }
    } catch {
      // Ignore missing skill roots
    }
  }

  return Array.from(existing);
}

async function loadNativeGlobalSkillPaths(options: ExternalCodexResourceOptions): Promise<string[]> {
  return collectExistingSkillPaths([
    path.join(getNativeCodexHome(options), 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
  ]);
}

async function loadWslGlobalSkillPaths(options: ExternalCodexResourceOptions): Promise<string[]> {
  const stdout = await runWslShell(
    options,
    `${RESOLVE_CODEX_HOME_SCRIPT} for skills_dir in "$codex_home/skills" "$HOME/.agents/skills"; do if [ -d "$skills_dir" ]; then find "$skills_dir" -mindepth 2 -maxdepth 2 -name 'SKILL.md' -print; fi; done`
  );
  return Array.from(new Set(stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)));
}

async function readSkillContent(
  skillPath: string,
  options: ExternalCodexResourceOptions
): Promise<string | null> {
  try {
    if (shouldUseWsl(options)) {
      return await runWslShell(options, 'cat "$1"', skillPath);
    }
    return await fs.readFile(skillPath, 'utf8');
  } catch {
    return null;
  }
}

export async function loadExternalCodexSkills(
  options: ExternalCodexResourceOptions
): Promise<SlashCommand[]> {
  const skillPaths = shouldUseWsl(options)
    ? await loadWslGlobalSkillPaths(options)
    : await loadNativeGlobalSkillPaths(options);

  const skills: SlashCommand[] = [];
  for (const skillPath of skillPaths) {
    const content = await readSkillContent(skillPath, options);
    if (!content) continue;

    const command = buildGlobalSkill(skillPath, content);
    if (command) {
      skills.push(command);
    }
  }

  return skills;
}

async function readConfigToml(options: ExternalCodexResourceOptions): Promise<string | null> {
  try {
    if (shouldUseWsl(options)) {
      const content = await runWslShell(
        options,
        `${RESOLVE_CODEX_HOME_SCRIPT} config_path="$codex_home/config.toml"; if [ -f "$config_path" ]; then cat "$config_path"; fi`
      );
      return content || null;
    }

    const configPath = path.join(getNativeCodexHome(options), 'config.toml');
    return await fs.readFile(configPath, 'utf8');
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseCodexMcpServers(
  content: string,
  source: 'project' | 'global'
): CodianMcpServer[] {
  if (!content?.trim()) {
    return [];
  }

  try {
    const parsed = parseToml(content) as Record<string, unknown>;
    const rawServers = isRecord(parsed.mcp_servers)
      ? parsed.mcp_servers
      : (isRecord(parsed.mcpServers) ? parsed.mcpServers : null);

    if (!rawServers) {
      return [];
    }

    const servers: CodianMcpServer[] = [];
    for (const [name, config] of Object.entries(rawServers)) {
      if (!isValidMcpServerConfig(config)) {
        continue;
      }

      servers.push({
        name,
        config,
        ...DEFAULT_MCP_SERVER,
        source,
      });
    }

    return servers;
  } catch {
    return [];
  }
}

export async function loadProjectCodexMcpServers(
  adapter: RelativeFileReader
): Promise<CodianMcpServer[]> {
  try {
    if (!(await adapter.exists(PROJECT_CODEX_MCP_CONFIG_PATH))) {
      return [];
    }
    const content = await adapter.read(PROJECT_CODEX_MCP_CONFIG_PATH);
    return parseCodexMcpServers(content, 'project');
  } catch {
    return [];
  }
}

export async function loadExternalCodexMcpServers(
  options: ExternalCodexResourceOptions
): Promise<CodianMcpServer[]> {
  const content = await readConfigToml(options);
  return parseCodexMcpServers(content ?? '', 'global');
}

export function mergeSlashCommands(
  localCommands: SlashCommand[],
  externalCommands: SlashCommand[]
): SlashCommand[] {
  const seenNames = new Set(localCommands.map((cmd) => cmd.name.toLowerCase()));
  const merged = [...localCommands];

  for (const command of externalCommands) {
    if (seenNames.has(command.name.toLowerCase())) {
      continue;
    }
    seenNames.add(command.name.toLowerCase());
    merged.push(command);
  }

  return merged;
}

export function mergeMcpServers(
  vaultServers: CodianMcpServer[],
  externalServers: CodianMcpServer[]
): CodianMcpServer[] {
  const merged: CodianMcpServer[] = [];
  const seenNames = new Set<string>();

  for (const server of vaultServers) {
    merged.push({ ...server, source: server.source ?? 'vault' });
    seenNames.add(server.name.toLowerCase());
  }

  for (const server of externalServers) {
    if (seenNames.has(server.name.toLowerCase())) {
      continue;
    }
    merged.push(server);
    seenNames.add(server.name.toLowerCase());
  }

  return merged;
}

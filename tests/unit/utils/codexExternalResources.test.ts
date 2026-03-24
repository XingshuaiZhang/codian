import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { CodianMcpServer, SlashCommand } from '@/core/types';
import {
  loadExternalCodexMcpServers,
  loadExternalCodexSkills,
  loadProjectCodexMcpServers,
  mergeMcpServers,
  mergeSlashCommands,
  PROJECT_CODEX_MCP_CONFIG_PATH,
} from '@/utils/codexExternalResources';

describe('codexExternalResources', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codian-codex-home-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads global skills from CODEX_HOME/skills', async () => {
    const skillDir = path.join(tempDir, 'skills', 'reviewer');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: Review code\n---\nCheck this change.');

    const skills = await loadExternalCodexSkills({
      environmentVariables: `CODEX_HOME=${tempDir}`,
    });

    expect(skills).toEqual([
      expect.objectContaining({
        id: 'skill-global-reviewer',
        name: 'reviewer',
        description: 'Review code',
        content: 'Check this change.',
        source: 'global',
      }),
    ]);
  });

  it('loads MCP servers from CODEX_HOME/config.toml', async () => {
    fs.writeFileSync(path.join(tempDir, 'config.toml'), `
[mcp_servers.akshare]
command = "mcp-server-akshare"
args = ["--stdio"]
`);

    const servers = await loadExternalCodexMcpServers({
      environmentVariables: `CODEX_HOME=${tempDir}`,
    });

    expect(servers).toEqual([
      expect.objectContaining({
        name: 'akshare',
        enabled: true,
        contextSaving: true,
        source: 'global',
        config: {
          command: 'mcp-server-akshare',
          args: ['--stdio'],
        },
      }),
    ]);
  });

  it('loads project MCP servers from .codex/config.toml', async () => {
    const adapter = {
      exists: jest.fn(async (filePath: string) => filePath === PROJECT_CODEX_MCP_CONFIG_PATH),
      read: jest.fn(async () => `
[mcp_servers.fetch]
command = "mcp-server-fetch"
`),
    };

    const servers = await loadProjectCodexMcpServers(adapter);

    expect(servers).toEqual([
      expect.objectContaining({
        name: 'fetch',
        enabled: true,
        contextSaving: true,
        source: 'project',
        config: {
          command: 'mcp-server-fetch',
        },
      }),
    ]);
  });

  it('prefers local slash commands over global duplicates', () => {
    const local: SlashCommand[] = [
      { id: 'skill-reviewer', name: 'reviewer', content: 'local', source: 'user' },
    ];
    const external: SlashCommand[] = [
      { id: 'skill-global-reviewer', name: 'reviewer', content: 'global', source: 'global' },
      { id: 'skill-global-lint', name: 'lint', content: 'lint', source: 'global' },
    ];

    expect(mergeSlashCommands(local, external)).toEqual([
      local[0],
      external[1],
    ]);
  });

  it('prefers vault MCP servers over project and global duplicates', () => {
    const vault: CodianMcpServer[] = [
      {
        name: 'akshare',
        config: { command: 'local-akshare' },
        enabled: false,
        contextSaving: false,
      },
    ];
    const project: CodianMcpServer[] = [
      {
        name: 'akshare',
        config: { command: 'project-akshare' },
        enabled: true,
        contextSaving: true,
        source: 'project',
      },
      {
        name: 'project-only',
        config: { command: 'project-only' },
        enabled: true,
        contextSaving: true,
        source: 'project',
      },
    ];
    const global: CodianMcpServer[] = [
      {
        name: 'akshare',
        config: { command: 'global-akshare' },
        enabled: true,
        contextSaving: true,
        source: 'global',
      },
      {
        name: 'fetch',
        config: { command: 'global-fetch' },
        enabled: true,
        contextSaving: true,
        source: 'global',
      },
    ];

    expect(mergeMcpServers(mergeMcpServers(vault, project), global)).toEqual([
      {
        ...vault[0],
        source: 'vault',
      },
      project[1],
      global[1],
    ]);
  });
});

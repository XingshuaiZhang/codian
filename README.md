# Codian for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

![GitHub stars](https://img.shields.io/github/stars/XingshuaiZhang/codian?style=social)
![GitHub release](https://img.shields.io/github/v/release/XingshuaiZhang/codian)
![License](https://img.shields.io/github/license/XingshuaiZhang/codian)

An Obsidian plugin that embeds Codex as an AI collaborator in your vault. Your vault becomes Codex's working directory, giving it full agentic capabilities: file read/write, search, bash commands, and multi-step workflows.

Codian is an independently published MIT-licensed fork derived from the upstream Claudian project. See [LICENSE](LICENSE) for attribution details.

## Features

- **Full Agentic Capabilities**: Use Codex to read, write, and edit files, search, and execute bash commands directly inside your Obsidian vault.
- **Context-Aware**: Automatically attach the focused note, mention files with `@`, exclude notes by tag, include editor selection (Highlight), and access external directories for additional context.
- **Vision Support**: Analyze images by sending them via drag-and-drop, paste, or file path.
- **Inline Edit**: Edit selected text or insert content at cursor position directly in notes with word-level diff preview and read-only tool access for context.
- **Instruction Mode (`#`)**: Add refined custom instructions to your system prompt directly from the chat input, with review/edit in a modal.
- **Slash Commands**: Create reusable prompt templates triggered by `/command`, with argument placeholders, `@file` references, and optional inline bash substitutions.
- **Skills**: Extend the plugin with reusable capability modules stored in Codex-compatible skill directories.
- **Custom Agents**: Define custom subagents that Codex can invoke, with support for tool restrictions and model overrides.
- **MCP Support**: Connect external tools and data sources via Model Context Protocol servers (stdio, SSE, HTTP) with context-saving mode and `@`-mention activation.
- **Advanced Model Control**: Select supported Codex/OpenAI models and tune effort / thinking behavior.
- **Plan Mode**: Toggle plan mode via Shift+Tab in the chat input. Codex CLI explores and designs before implementing.
- **Security**: Permission modes (YOLO/Safe/Plan), safety blocklist, and vault confinement with symlink-safe checks.

## Requirements

- [Codex CLI](https://developers.openai.com/codex/cli) installed
- [`codex-acp`](https://github.com/zed-industries/codex-acp) installed for streaming chat
- Obsidian v1.4.5+
- OpenAI/Codex authentication configured for the CLI
- Desktop only
- Supported platforms: macOS, Windows host with WSL2

### Install the runtimes

Streaming chat uses `codex-acp`. One-shot tasks such as title generation and inline edit still use `codex`.

```bash
# Codex CLI
npm install -g @openai/codex

# codex-acp adapter
npx @zed-industries/codex-acp --help
```

If you prefer a persistent install for the adapter, follow the release instructions in the
[`zed-industries/codex-acp`](https://github.com/zed-industries/codex-acp) repository and then point
Codian to that executable in Settings → Advanced → `codex-acp path`.

## Installation

### From GitHub Release (recommended)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/XingshuaiZhang/codian/releases/latest)
2. Create a folder called `codian` in your vault's plugins folder:
   ```
   /path/to/vault/.obsidian/plugins/codian/
   ```
3. Copy the downloaded files into the `codian` folder
4. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "Codian"

### Using BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tester) allows you to install and automatically update plugins directly from GitHub.

1. Install the BRAT plugin from Obsidian Community Plugins
2. Enable BRAT in Settings → Community plugins
3. Open BRAT settings and click "Add Beta plugin"
4. Enter the repository URL: `https://github.com/XingshuaiZhang/codian`
5. Click "Add Plugin" and BRAT will install the plugin automatically
6. Enable "Codian" in Settings → Community plugins

> **Tip**: BRAT will automatically check for updates and notify you when a new version is available.

### From source (development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/XingshuaiZhang/codian.git
   cd codian
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "Codian"

### Development

```bash
# Watch mode
npm run dev

# Production build
npm run build
```

> **Tip**: Copy `.env.local.example` to `.env.local` or `npm install` and setup your vault path to auto-copy files during development.

## Usage

**Two modes:**
1. Click the bot icon in ribbon or use command palette to open chat
2. Select text + hotkey for inline edit

Use it like Codex: read, write, edit, and search files in your vault.

### Context

- **File**: Auto-attaches focused note; type `@` to attach other files
- **@-mention dropdown**: Type `@` to see MCP servers, agents, external contexts, and vault files
  - `@Agents/` shows custom agents for selection
  - `@mcp-server` enables context-saving MCP servers
  - `@folder/` filters to files from that external context (e.g., `@workspace/`)
  - Vault files shown by default
- **Selection**: Select text in editor, or elements in canvas, then chat—selection included automatically
- **Images**: Drag-drop, paste, or type path; configure media folder for `![[image]]` embeds
- **External contexts**: Click folder icon in toolbar for access to directories outside vault

### Features

- **Inline Edit**: Select text + hotkey to edit directly in notes with word-level diff preview
- **Instruction Mode**: Type `#` to add refined instructions to system prompt
- **Slash Commands**: Type `/` for custom prompt templates or skills
- **Skills**: Add `SKILL.md` files to `~/.codex/skills/` (global) or `{vault}/.agents/skills/` (vault-specific)
- **Custom Agents**: Add agent files to `~/.codex/agents/` (global) or `{vault}/.codex/agents/` (vault-specific); select via `@Agents/` in chat, or prompt Codex CLI to invoke agents
- **MCP**: Add external tools via Settings → MCP Servers; use `@mcp-server` in chat to activate

## Configuration

### Settings

**Customization**
- **User name**: Your name for personalized greetings
- **Excluded tags**: Tags that prevent notes from auto-loading (e.g., `sensitive`, `private`)
- **Media folder**: Configure where vault stores attachments for embedded image support (e.g., `attachments`)
- **Custom system prompt**: Additional instructions appended to the default system prompt (Instruction Mode `#` saves here)
- **Enable auto-scroll**: Toggle automatic scrolling to bottom during streaming (default: on)
- **Auto-generate conversation titles**: Toggle AI-powered title generation after the first user message is sent
- **Title generation model**: Model used for auto-generating conversation titles (default: Auto/Haiku)
- **Vim-style navigation mappings**: Configure key bindings with lines like `map w scrollUp`, `map s scrollDown`, `map i focusInput`

**Hotkeys**
- **Inline edit hotkey**: Hotkey to trigger inline edit on selected text
- **Open chat hotkey**: Hotkey to open the chat sidebar

**Slash Commands**
- Create/edit/import/export custom `/commands` (optionally override model and allowed tools)

**MCP Servers**
- Add/edit/verify/delete MCP server configurations with context-saving mode

**Safety**
- **Enable command blocklist**: Block dangerous bash commands (default: on)
- **Blocked commands**: Patterns to block (supports regex, platform-specific)
- **Allowed export paths**: Paths outside the vault where files can be exported (default: `~/Desktop`, `~/Downloads`). Supports `~`, `$VAR`, `${VAR}`, and `%VAR%` (Windows).

**Environment**
- **Custom variables**: Environment variables for Codex CLI and related tooling (KEY=VALUE format, supports `export ` prefix)
- **Environment snippets**: Save and restore environment variable configurations

**Advanced**
- **codex-acp path**: Custom path to the ACP adapter used for streaming chat (leave empty for auto-detection)
- **Codex CLI path**: Custom path to Codex CLI (leave empty for auto-detection)
- **WSL2 runtime**: On Windows hosts, run the plugin through WSL2 instead of native Windows

## Safety and Permissions

| Scope | Access |
|-------|--------|
| **Vault** | Full read/write (symlink-safe via `realpath`) |
| **Export paths** | Write-only (e.g., `~/Desktop`, `~/Downloads`) |
| **External contexts** | Full read/write (session-only, added via folder icon) |

- **YOLO mode**: No approval prompts; all tool calls execute automatically (default)
- **Normal mode**: Uses the standard interactive chat flow
- **Plan mode**: Explores and designs a plan before implementing. Toggle via Shift+Tab in the chat input

## Privacy & Data Use

- **Sent to API**: Your input, attached files, images, and tool call outputs are sent by the installed Codex CLI using its current login state.
- **Local storage**: Settings, MCP config, commands, sessions, and rewind artifacts stored in `vault/.codian/obsidian/`. Vault agents live in `vault/.codex/agents/`. Vault skills live in `vault/.agents/skills/`.
- **No telemetry**: No tracking beyond your configured API provider.

## Troubleshooting

### codex-acp not found

If chat opens but immediately reports that `codex-acp` cannot be found, Codian cannot auto-detect the ACP adapter used for streaming chat.

**Solution**: Find your adapter path and set it in Settings → Advanced → `codex-acp path`.

| Platform | Command | Example Path |
|----------|---------|--------------|
| macOS/Linux | `which codex-acp` | `/Users/you/.local/bin/codex-acp` |
| Windows host + WSL2 | `wsl which codex-acp` | `/home/you/.local/bin/codex-acp` |
| npx shim | `which codex-acp` | `/Users/you/.npm-global/bin/codex-acp` |

> **Note**: Native Windows execution is not supported in Codian. Use WSL2 on Windows hosts.

### Codex CLI not found

If you encounter `spawn codex ENOENT` or `Codex CLI not found`, the plugin can't auto-detect your Codex installation. This is common with Node version managers (nvm, fnm, volta) or when Obsidian is launched with a minimal PATH.

**Solution**: Find your CLI path and set it in Settings → Advanced → Codex CLI path.

| Platform | Command | Example Path |
|----------|---------|--------------|
| macOS/Linux | `which codex` | `/Users/you/.volta/bin/codex` |
| Windows host + WSL2 | `wsl which codex` | `/home/you/.local/bin/codex` |
| npm global install | `npm root -g` | `{root}/@openai/codex/bin/codex.js` |

> **Note**: Native Windows execution is not supported in Codian. Use WSL2 on Windows hosts.

**Alternative**: Add your Node.js bin directory to PATH in Settings → Environment → Custom variables.

### npm CLI and Node.js not in same directory

If using npm-installed CLI, check if `codex` and `node` are in the same directory:
```bash
dirname $(which codex)
dirname $(which node)
```

If different, GUI apps like Obsidian may not find Node.js.

**Solutions**:
1. Install native binary (recommended)
2. Add Node.js path to Settings → Environment: `PATH=/path/to/node/bin`

**Still having issues?** [Open a GitHub issue](https://github.com/XingshuaiZhang/codian/issues) with your platform, CLI path, and error message.

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── core/                        # Core infrastructure
│   ├── agent/                   # ACP chat runtime + Codex one-shot helpers
│   ├── agents/                  # Custom agent management (AgentManager)
│   ├── commands/                # Slash command management (SlashCommandManager)
│   ├── hooks/                   # PreToolUse/PostToolUse hooks
│   ├── images/                  # Image caching and loading
│   ├── mcp/                     # MCP server config, service, and testing
│   ├── plugins/                 # Legacy plugin manager stub
│   ├── prompts/                 # System prompts for agents
│   ├── sdk/                     # SDK message transformation
│   ├── security/                # Approval, blocklist, path validation
│   ├── storage/                 # Distributed storage system
│   ├── tools/                   # Tool constants and utilities
│   └── types/                   # Type definitions
├── features/                    # Feature modules
│   ├── chat/                    # Main chat view + UI, rendering, controllers, tabs
│   ├── inline-edit/             # Inline edit service + UI
│   └── settings/                # Settings tab UI
├── shared/                      # Shared UI components and modals
│   ├── components/              # Input toolbar bits, dropdowns, selection highlight
│   ├── mention/                 # @-mention dropdown controller
│   ├── modals/                  # Instruction modal
│   └── icons.ts                 # Shared SVG icons
├── i18n/                        # Internationalization (10 locales)
├── utils/                       # Modular utility functions
└── style/                       # Modular CSS (→ styles.css)
```

## Roadmap

- [x] Codex CLI runtime
- [x] Custom agent (subagent) support
- [x] WSL2 support on Windows hosts
- [x] `/compact` command
- [x] Plan mode
- [x] `rewind` and `fork` support (including `/fork` command)
- [x] `!command` support
- [x] Tool renderers refinement
- [x] Plugin-owned session storage in `vault/.codian/obsidian`
- [ ] Hooks and other advanced features
- [ ] More to come!

## License

Licensed under the [MIT License](LICENSE).

## Star History

<a href="https://www.star-history.com/?repos=XingshuaiZhang%2Fcodian&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=XingshuaiZhang/codian&type=date&legend=top-left&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=XingshuaiZhang/codian&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=XingshuaiZhang/codian&type=date&legend=top-left" />
  </picture>
</a>

## Acknowledgments

- [Obsidian](https://obsidian.md) for the plugin API
- [OpenAI](https://openai.com) for Codex and the Codex CLI
- Yishen Tu and the upstream Claudian project for the original foundation

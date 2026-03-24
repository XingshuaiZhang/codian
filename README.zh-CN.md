# Codian for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

![GitHub stars](https://img.shields.io/github/stars/XingshuaiZhang/codian?style=social)
![GitHub release](https://img.shields.io/github/v/release/XingshuaiZhang/codian)
![License](https://img.shields.io/github/license/XingshuaiZhang/codian)

Codian 是一个将 Codex 嵌入 Obsidian 的插件。你的 vault 会成为 Codex 的工作目录，因此它可以直接在 Obsidian 中读取、写入、搜索文件，执行 bash 命令，并完成多步工作流。

Codian 是基于上游 Claudian 项目独立发布的 MIT 许可证分支。版权与许可信息见 [LICENSE](LICENSE)。

## 功能特性

- **完整 Agent 能力**：可直接在 vault 内读写、编辑文件、搜索内容并执行 bash 命令。
- **上下文感知**：自动附加当前聚焦笔记；支持 `@` 引用文件；支持按标签排除；支持带入编辑器选区与外部目录。
- **视觉支持**：支持拖拽、粘贴或通过路径发送图片。
- **内联编辑**：可直接在笔记中修改选中文本或在光标处插入内容，并提供词级 diff 预览。
- **指令模式（`#`）**：可直接在输入框中追加系统提示，并在弹窗中审阅或编辑。
- **Slash Commands**：支持自定义 `/command` 提示模板、参数占位符、`@file` 引用和可选的 bash 内联替换。
- **Skills**：支持通过 Codex 兼容目录扩展可复用能力模块。
- **自定义 Agents**：支持定义可被 Codex 调用的子代理，可配置工具限制与模型覆盖。
- **MCP 支持**：支持通过 stdio、SSE、HTTP 接入 Model Context Protocol 服务，并支持上下文保存模式与 `@` 激活。
- **模型控制**：可选择支持的 Codex/OpenAI 模型，并调整 effort / thinking 行为。
- **计划模式**：在聊天输入框中按 `Shift+Tab` 切换。Codex 会先规划再执行。
- **安全机制**：支持权限模式、危险命令阻止列表，以及基于真实路径的 vault 边界控制。

## 运行要求

- 已安装 [Codex CLI](https://developers.openai.com/codex/cli)
- 已安装 [`codex-acp`](https://github.com/zed-industries/codex-acp) 用于流式聊天
- Obsidian v1.4.5+
- 已为 Codex CLI 配置登录认证
- 仅支持桌面端
- 支持平台：macOS、Windows 主机 + WSL2

### 安装运行时

流式聊天使用 `codex-acp`。标题生成、内联编辑等一次性任务仍使用 `codex`。

```bash
# Codex CLI
npm install -g @openai/codex

# codex-acp 适配器
npx @zed-industries/codex-acp --help
```

如果你想长期安装 `codex-acp`，请参考 [`zed-industries/codex-acp`](https://github.com/zed-industries/codex-acp) 仓库中的发布说明，然后在 Codian 的 设置 → Advanced → `codex-acp path` 中填入对应可执行文件路径。

## 安装方式

### 从 GitHub Release 安装（推荐）

1. 从 [latest release](https://github.com/XingshuaiZhang/codian/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`
2. 在 vault 的插件目录下新建 `codian` 文件夹：
   ```
   /path/to/vault/.obsidian/plugins/codian/
   ```
3. 将下载的文件复制到 `codian` 文件夹中
4. 在 Obsidian 中启用插件：
   - 设置 → 社区插件 → 启用 `Codian`

### 使用 BRAT 安装

[BRAT](https://github.com/TfTHacker/obsidian42-brat) 可以直接从 GitHub 安装并自动跟踪更新。

1. 在 Obsidian 社区插件中安装 BRAT
2. 启用 BRAT
3. 打开 BRAT 设置并点击 `Add Beta plugin`
4. 输入仓库地址：`https://github.com/XingshuaiZhang/codian`
5. 点击 `Add Plugin`
6. 在 Obsidian 中启用 `Codian`

> **提示**：BRAT 会自动检查更新并在有新版本时提醒你。

### 从源码安装（开发）

1. 将仓库克隆到 vault 的插件目录中：
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/XingshuaiZhang/codian.git
   cd codian
   ```

2. 安装依赖并构建：
   ```bash
   npm install
   npm run build
   ```

3. 在 Obsidian 中启用插件：
   - 设置 → 社区插件 → 启用 `Codian`

### 开发命令

```bash
# 监听构建
npm run dev

# 生产构建
npm run build
```

> **提示**：可以将 `.env.local.example` 复制为 `.env.local`，并配置你的 vault 路径，用于开发时自动复制构建产物。

## 使用方式

**主要有两种模式：**
1. 点击左侧功能区图标，或通过命令面板打开聊天侧边栏
2. 选中文本后使用快捷键触发内联编辑

你可以像使用 Codex 一样，在 vault 中读、写、改、搜文件。

### 上下文

- **文件**：自动附加当前聚焦笔记；输入 `@` 可附加其他文件
- **@ 引用下拉**：输入 `@` 会看到 MCP 服务、agents、外部上下文和 vault 文件
  - `@Agents/`：显示可选的自定义 agents
  - `@mcp-server`：启用支持上下文保存的 MCP 服务
  - `@folder/`：筛选某个外部目录中的文件，例如 `@workspace/`
  - 默认也会显示 vault 文件
- **选区**：在编辑器中选择文本，或在 canvas 中选择元素后聊天，选区会自动带入
- **图片**：支持拖拽、粘贴或输入路径；可配置媒体目录以支持 `![[image]]` 嵌入
- **外部上下文**：点击工具栏中的文件夹图标，为当前会话添加 vault 外目录

### 主要能力

- **Inline Edit**：选中文本后直接在笔记中编辑，并查看词级 diff
- **Instruction Mode**：输入 `#` 为系统提示追加指令
- **Slash Commands**：输入 `/` 使用自定义提示模板或 skills
- **Skills**：将 `SKILL.md` 放到 `~/.codex/skills/`（全局）或 `{vault}/.agents/skills/`（项目级）
- **Custom Agents**：将 agent 文件放到 `~/.codex/agents/`（全局）或 `{vault}/.codex/agents/`（项目级）；可在聊天中通过 `@Agents/` 选择，也可让 Codex CLI 自行调用
- **MCP**：通过 设置 → MCP Servers 添加外部工具，并在聊天中使用 `@mcp-server` 激活

## 配置说明

### 设置项

**Customization**
- **User name**：你的名字，用于个性化显示
- **Excluded tags**：自动加载上下文时要排除的标签，例如 `sensitive`、`private`
- **Media folder**：Obsidian 附件目录，用于图片嵌入
- **Custom system prompt**：附加到默认系统提示后的自定义提示词
- **Enable auto-scroll**：流式输出时自动滚动到底部
- **Auto-generate conversation titles**：在第一条用户消息发送后自动生成会话标题
- **Title generation model**：生成标题所用模型
- **Vim-style navigation mappings**：自定义键位，例如 `map w scrollUp`

**Hotkeys**
- **Inline edit hotkey**：触发内联编辑的快捷键
- **Open chat hotkey**：打开聊天侧边栏的快捷键

**Slash Commands**
- 创建、编辑、导入、导出自定义 `/commands`

**MCP Servers**
- 添加、编辑、验证、删除 MCP 服务，并支持上下文保存模式

**Safety**
- **Enable command blocklist**：启用危险命令阻止列表
- **Blocked commands**：要阻止的命令模式，支持正则与平台区分
- **Allowed export paths**：允许导出到 vault 外的路径，例如 `~/Desktop`、`~/Downloads`

**Environment**
- **Custom variables**：传给 Codex CLI 及相关工具的环境变量，格式为 `KEY=VALUE`
- **Environment snippets**：保存和恢复环境变量配置片段

**Advanced**
- **codex-acp path**：流式聊天使用的 ACP 适配器路径，留空则自动探测
- **Codex CLI path**：Codex CLI 路径，留空则自动探测
- **WSL2 runtime**：在 Windows 主机上通过 WSL2 运行，而不是使用原生 Windows 环境

## 安全与权限

| 范围 | 权限 |
|------|------|
| **Vault** | 完整读写（基于 `realpath` 防止越界） |
| **Export paths** | 仅写入 |
| **External contexts** | 完整读写（仅当前会话有效） |

- **YOLO mode**：不弹审批，工具调用直接执行
- **Normal mode**：标准交互聊天模式
- **Plan mode**：先规划再实现，可在输入框中通过 `Shift+Tab` 切换

## 隐私与数据

- **发送到 API 的内容**：你的输入、附加文件、图片和工具输出会通过已安装的 Codex CLI 按当前登录态发出
- **本地存储**：设置、MCP 配置、commands、sessions 和 rewind 数据保存在 `vault/.codian/obsidian/`；vault agents 保存在 `vault/.codex/agents/`；vault skills 保存在 `vault/.agents/skills/`
- **无额外遥测**：插件本身不发送额外跟踪数据

## 故障排查

### 找不到 `codex-acp`

如果聊天窗口能打开，但立即提示找不到 `codex-acp`，说明 Codian 无法自动探测用于流式聊天的 ACP 适配器。

**解决方法**：先找到适配器路径，再填到 设置 → Advanced → `codex-acp path`。

| 平台 | 命令 | 示例路径 |
|------|------|----------|
| macOS/Linux | `which codex-acp` | `/Users/you/.local/bin/codex-acp` |
| Windows 主机 + WSL2 | `wsl which codex-acp` | `/home/you/.local/bin/codex-acp` |
| npx shim | `which codex-acp` | `/Users/you/.npm-global/bin/codex-acp` |

> **注意**：Codian 不支持原生 Windows 执行。Windows 主机请使用 WSL2。

### 找不到 Codex CLI

如果你遇到 `spawn codex ENOENT` 或 `Codex CLI not found`，说明插件没有自动找到 Codex 的安装位置。这在使用 `nvm`、`fnm`、`volta` 等 Node 版本管理器时比较常见。

**解决方法**：找到 CLI 路径并填到 设置 → Advanced → `Codex CLI path`。

| 平台 | 命令 | 示例路径 |
|------|------|----------|
| macOS/Linux | `which codex` | `/Users/you/.volta/bin/codex` |
| Windows 主机 + WSL2 | `wsl which codex` | `/home/you/.local/bin/codex` |
| npm 全局安装 | `npm root -g` | `{root}/@openai/codex/bin/codex.js` |

> **注意**：Codian 不支持原生 Windows 执行。Windows 主机请使用 WSL2。

**替代方案**：也可以把 Node.js 的 bin 目录加入 设置 → Environment → Custom variables 中的 `PATH`。

### npm CLI 与 Node.js 不在同一目录

如果使用 npm 安装的 CLI，可以检查 `codex` 和 `node` 是否在同一目录：

```bash
dirname $(which codex)
dirname $(which node)
```

如果不在同一目录，Obsidian 这类 GUI 应用可能无法自动找到 Node.js。

**解决方案：**
1. 改用原生二进制安装方式
2. 在设置中显式追加 `PATH=/path/to/node/bin`

**仍有问题？** 请到 [GitHub Issues](https://github.com/XingshuaiZhang/codian/issues) 提交问题，并附上你的平台、CLI 路径和报错信息。

## 项目结构

```text
src/
├── main.ts                      # 插件入口
├── core/                        # 核心基础设施
│   ├── agent/                   # ACP 聊天运行时 + Codex 一次性任务封装
│   ├── agents/                  # 自定义 agent 管理
│   ├── commands/                # Slash command 管理
│   ├── hooks/                   # PreToolUse / PostToolUse hooks
│   ├── images/                  # 图片缓存与加载
│   ├── mcp/                     # MCP 配置、服务和测试
│   ├── plugins/                 # 遗留插件管理占位层
│   ├── prompts/                 # 系统提示模板
│   ├── sdk/                     # SDK 消息转换
│   ├── security/                # 审批、黑名单与路径校验
│   ├── storage/                 # 存储层
│   ├── tools/                   # 工具常量与工具函数
│   └── types/                   # 类型定义
├── features/                    # 功能模块
│   ├── chat/                    # 聊天视图、渲染、控制器、标签页
│   ├── inline-edit/             # 内联编辑服务与界面
│   └── settings/                # 设置页
├── shared/                      # 共享 UI 组件与弹窗
├── i18n/                        # 国际化
├── utils/                       # 工具函数
└── style/                       # 模块化 CSS（最终输出为 styles.css）
```

## 路线图

- [x] Codex CLI 运行时
- [x] 自定义 agent / subagent 支持
- [x] Windows 主机上的 WSL2 支持
- [x] `/compact` 命令
- [x] Plan mode
- [x] `rewind` 与 `fork` 支持（含 `/fork`）
- [x] `!command` 支持
- [x] 工具渲染优化
- [x] 插件私有会话存储到 `vault/.codian/obsidian`
- [ ] Hooks 和其他高级能力
- [ ] 持续完善中

## License

使用 [MIT License](LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=XingshuaiZhang%2Fcodian&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=XingshuaiZhang/codian&type=date&legend=top-left&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=XingshuaiZhang/codian&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=XingshuaiZhang/codian&type=date&legend=top-left" />
  </picture>
</a>

## 致谢

- [Obsidian](https://obsidian.md) 提供插件 API
- [OpenAI](https://openai.com) 提供 Codex 与 Codex CLI
- Yishen Tu 与上游 Claudian 项目提供了最初的基础

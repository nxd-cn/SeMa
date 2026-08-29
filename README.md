# SeMa

跨平台（**Windows / macOS**）桌面应用：在一个窗口里管理多个 AI CLI 会话。

基于 **Tauri 2 + Rust + React/TypeScript + xterm.js + portable-pty**，按项目目录打开：

- Claude Code
- Cursor Agent
- OpenCode
- Codex
- Gemini
- Pi
- Kimi Code
- Terminal

支持分栏、续聊、侧栏折叠、活跃脉冲、未读提示，以及只读 Git 分支底栏。

> 开发约定见 [AGENTS.md](./AGENTS.md)。English: [README.en.md](./README.en.md)。

## 环境要求

- Node.js（建议 LTS）
- Rust（stable，含 Cargo）— 见 [https://rustup.rs](https://rustup.rs)
- 已安装并配置好 PATH 的 AI CLI（按需安装，未检测到的不会出现在列表中）；**Terminal** 始终可用
- 可选：本机 `git`（用于会话底栏显示当前分支；未安装则显示 `~`）
- Windows 或 macOS（打包还需各平台系统依赖，见 [Tauri 文档](https://v2.tauri.app/start/prerequisites/)）

## 安装与启动

```bash
npm install
npm run tauri:dev
```

### 打包客户端

```bash
npm run tauri:build
```

产物位于 `src-tauri/target/release/bundle/`：

- macOS：`.app` 与 `.dmg`
- Windows：NSIS `.exe`（在 Windows 主机上构建）

### macOS：提示「文件已损坏」时

从 GitHub Release 下载的 macOS 包目前**未签名 / 未公证**。系统可能提示「已损坏、无法打开」——这是 Gatekeeper 隔离，不是文件坏了。

把 `SeMa.app` 拖进「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/SeMa.app
```

然后再打开 SeMa。正式对外分发需 Apple Developer 账号做签名 + 公证。

### 自动更新

安装后的 SeMa 会在启动时检查 GitHub Release 是否有新版本；有则弹窗，点「立即更新」会下载安装并重启（无需先卸载）。

发布流水线需要仓库 Secrets（本地私钥在 `.tauri/sema.key`，勿提交）：

| Secret | 内容 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | `.tauri/sema.key` 全文 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 若生成密钥时设了密码则填写，否则可留空或不建 |

推送 `v*` tag 后 CI 会签名更新包并上传 `latest.json`。

## 使用说明

### 新建与侧栏

1. **新建会话**：点 **+**，选择项目目录与 CLI。  
   - macOS：`+` 在窗口顶栏（与红绿灯同一行）  
   - Windows：`+` 在左侧栏顶部  
2. **折叠侧栏**：◀ / ☰（Mac 在顶栏，Win 在内容区工具栏最左）。  
3. **CLI 快捷按钮**：在当前焦点栏的目录 / 组内再开一列（无会话时禁用）。  
4. **侧栏 tab 排序**：拖动 tab 到另一 tab 的**上/下边缘**可调整顺序，写入配置，下次打开保持。  
5. **合并分栏**：将 tab 拖到另一 tab **中部**可合并为同组多分栏。  
6. **重命名 tab**：双击侧栏 tab 可改显示名；清空恢复为文件夹名。  
7. **Terminal**：CLI 列表始终有 **Terminal**（界面不显示 shell 名）。实际启动：Windows 为 `cmd`（`%COMSPEC%`），macOS 为 `$SHELL`（回退 zsh/bash）。不可续聊、无 ↻。

### 快捷键（仅 SeMa 窗口在前台时生效）

| 操作 | macOS | Windows |
|------|--------|---------|
| 新建会话 | `⌘⇧N` | `Ctrl+Shift+N` |
| 显隐侧栏 | `⌘⇧B` | `Ctrl+Shift+B` |

后台时不会触发（非系统全局热键）。

### 会话栏

- 栏顶：路径；**↻** 续聊（有历史时）；**⤢** 同分栏时独立为新会话；**×** 关闭。  
- 栏底：只读 Git 分支（有则显示图标+分支名，否则 `~`）。不提供切分支。  
- 非当前组有回复：侧栏蓝点未读 + Toast。

默认打开的是**新会话**，不会自动续聊。

### macOS 顶栏与绿钮

- 顶栏与红绿灯对齐（Overlay）；侧栏只保留会话 tab。  
- 绿色按钮：铺满屏幕并隐藏菜单栏/Dock，红绿灯仍留在顶栏；再点一次恢复进入前的窗口大小（不是系统 Spaces 全屏，避免红绿灯藏进顶部热区）。

## 数据目录

| 用途 | Windows | macOS |
|------|---------|--------|
| SeMa 配置与缓存 | `%APPDATA%\com.sema.app\` | `~/Library/Application Support/com.sema.app/` |
| 各 CLI 会话内容 | 由对应 CLI 自行存储（SeMa 不存 transcript） | 同左 |

## 架构概览

| 层 | 路径 | 职责 |
|----|------|------|
| UI | `src/` | React 侧栏、分栏、顶栏/工具栏、分支底栏、xterm |
| API | `src/api/tui.ts` | Tauri invoke / events |
| Rust | `src-tauri/` | PTY、CLI 探测、续聊、git 分支、prefs、打包 |

图标在 `src-tauri/icons/`；换标：`npx tauri icon <源图>` 后清理多余 Store/移动端尺寸再提交。

## 平台说明

Windows 与 macOS **都要支持**，且修一边时**不能影响另一边**。细节见 [AGENTS.md](./AGENTS.md)。

## 参与贡献

1. Fork 本仓库并创建分支  
2. 小步改动；改探测 / spawn / 续聊时注意 Windows 与 macOS 两边路径  
3. 提交说明写清原因；提 Pull Request  

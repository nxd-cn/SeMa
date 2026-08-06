# SeMa

跨平台（**Windows / macOS**）桌面应用：在一个窗口里管理多个 AI CLI 会话。

基于 Electron + xterm.js + node-pty，按项目目录打开：

- Claude Code
- Cursor Agent
- OpenCode
- Codex
- Gemini
- Pi

支持分栏、续聊、侧栏折叠、活跃脉冲与未读提示。

> 开发约定见 [AGENTS.md](./AGENTS.md)。English: [README.en.md](./README.en.md)。

## 环境要求

- Node.js（建议 LTS）
- 已安装并配置好 PATH 的 AI CLI（按需安装，未检测到的不会出现在列表中）
- Windows 或 macOS

## 安装与启动

```bash
npm install
npm start
```

### 便捷启动（无需每次敲命令）

见 [launcher/README.md](./launcher/README.md)：macOS 用 `launcher/mac/SeMa.app`（可拖进 Dock）；Windows 用 `launcher/windows/SeMa.vbs`，并可用 `launcher/windows/install-shortcut.ps1` 生成桌面/开始菜单快捷方式。

`postinstall` 会执行 `electron-rebuild`，用于对齐 `node-pty` 与 Electron ABI。若 Mac 上仍启动失败，可手动执行：

```bash
npx @electron/rebuild
```

**注意：** 修改主进程（如 `main.js`）后需完全退出应用再 `npm start`，仅刷新渲染进程不够。当前仓库**未提供打包安装脚本**，以 `electron .` 开发运行。

## 使用说明

1. 点击左侧 **+**，选择项目目录与 CLI，打开会话。
2. 顶部工具栏：
   - 最左 **◀ / ☰**：折叠或展开左侧会话列表（右侧终端保持）。
   - 右侧 CLI 按钮：在当前焦点栏的目录 / 组内再开一列。
3. 栏顶：
   - **↻**：探测到该目录历史时可续聊（失败则回退新会话）。
   - **⤢**：同分栏时可将当前栏独立为新会话。
4. 非当前会话组有回复时：侧栏蓝点未读 + 右下角 Toast；点击可清除。

默认打开的是**新会话**，不会自动续聊。

## 数据目录

| 用途 | Windows | macOS |
|------|---------|--------|
| SeMa 配置与缓存 | `%APPDATA%\sema\` | `~/Library/Application Support/sema/` |
| 各 CLI 会话内容 | 由对应 CLI 自行存储（SeMa 不存 transcript） | 同左 |

## 架构概览

| 层 | 文件 | 职责 |
|----|------|------|
| Main | `main.js` | 窗口、偏好、CLI 探测、PTY、IPC |
| Preload | `preload.js` | `window.tui.*` |
| Renderer | `renderer/` | 侧栏、分栏、工具栏、续聊与未读 UI |
| Detect / Spawn / Resume | `cli-detect.js`、`spawn-helpers.js`、`resume-detect.js` | 探测、启动、续聊参数 |

## 平台说明

Windows 与 macOS **都要支持**，且修一边时**不能影响另一边**（PATH、`where`/`which`、Windows shim、`cmd.exe`、路径分隔符等按平台分支）。细节见 [AGENTS.md](./AGENTS.md)。

## 参与贡献

1. Fork 本仓库并创建分支
2. 小步改动；改探测 / spawn / 续聊时注意 Windows 与 macOS 两边路径
3. 提交说明写清原因；提 Pull Request

设计稿与实现计划：`docs/superpowers/specs/`、`docs/superpowers/plans/`。

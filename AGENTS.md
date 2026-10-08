# AGENTS.md — SeMa

跨平台桌面应用（**Windows / macOS**）：**多 AI CLI 会话管理器**（Tauri 2 + Rust + React/TypeScript）。按项目目录使用 Claude / Cursor Agent / OpenCode / Codex / Gemini / Pi / Kimi Code（**Headless Chat**，无应用内 TUI），以及系统 **Terminal**（xterm.js + portable-pty；Win `cmd` / Mac `$SHELL`）。支持分栏、续聊、侧栏折叠、活跃脉冲与未读。

设计主路径见 `docs/superpowers/specs/2026-10-08-headless-chat-ux-design.md`。

## 强制：双平台（且互不影响）

**每次改动都必须同时考虑 Windows 与 macOS。**

- **默认两边行为一致**；共享逻辑优先，不要为修一边而改坏另一边。
- **有差异时必须隔离**：用 `cfg!(windows)` / `cfg!(target_os = "macos")`（Rust）或前端 `tui.isWin` / `tui.isMac` 显式分支，只动出问题的那一侧；并在本文件「平台差异」补一句说明。
- **互不影响**：针对 Mac 的 workaround（例如 OpenCode 不用坏掉的 `--continue`）不得改变 Windows 既有成功路径；针对 Windows 的 shim/`cmd.exe`/`where` 逻辑不得套到 Mac 上。
- **回归自检**：改探测 / spawn / resume / headless argv / 路径后，想一遍「另一边现在会不会拿到错误 argv、错误 PATH 或错误数据目录」；单测断言按平台分支，禁止写死只过一边。

改下列任一区域时，先想清两条路径再写代码：

| 区域 | Windows 要点 | macOS 要点 |
|------|----------------|------------|
| PATH / 探测 | `where`；优先 `.cmd/.exe/.bat` | `which`；Homebrew 常在 `/opt/homebrew/bin` |
| Spawn / headless | 无扩展名 shim → `cmd.exe /c`；有 `.cmd` 则直启 + args；GUI 子进程加 `CREATE_NO_WINDOW` | 直接 `tool.path` + args |
| 用户数据（SeMa） | `%APPDATA%/com.sema.app/`（Tauri app data） | `~/Library/Application Support/com.sema.app/` |
| 任务栏 / Dock | AUMID / identifier `com.sema.app`；`icon.ico` / 满幅 `icon.png`（勿加透明边） | Dock 用带边距的 `icon.icns`（源 `icon-mac.png`：内容约 86% + 透明外边距，避免比别的 App 大一圈）。**不要**用满幅 `icon.png` 直接 `tauri icon` 覆盖 `.icns`；重做 icns：`magick icon.png -background none -gravity center -extent 116.279% PNG32:icon-mac.png`，再 `iconutil` 打进 `icon.icns`。换标后须重编 |
| 窗口顶栏 UI | 侧栏 `+` + 内容区 `#cli-toolbar`（折叠 + CLI） | Overlay 顶栏 `MacTitleBar`（`+` / 折叠 / CLI）；侧栏无 `+`、无 `#cli-toolbar`（`tauri.macos.conf.json`） |
| Git 分支底栏 | 同左：只读 `git_branch`；失败/`~` 不崩溃 | 同左；`where`/`which` 找 git；Win `.cmd` 走 `cmd.exe /c` |
| OpenCode 数据 | `%USERPROFILE%\.local\share\opencode`；另试 `%APPDATA%\opencode` | `~/.local/share/opencode`；另试 `~/Library/Application Support/opencode` |
| Kimi 数据 | `%USERPROFILE%\.kimi-code`（`$KIMI_CODE_HOME`） | `~/.kimi-code`（`$KIMI_CODE_HOME`） |
| Terminal 启动 | `%COMSPEC%`（通常 `cmd.exe`）；直启 `.exe` | `$SHELL` → `/bin/zsh` → `/bin/bash`；直启 shell 路径 |
| 路径比较 | `\` 与 `/`、盘符大小写；`resume` 模块已 normalize | POSIX；`realpath` 候选（`/var`→`/private/var`） |

禁止：只在本机（某一边）验证通过就当完成；禁止把某一边的路径/命令硬编码成唯一实现；禁止用「全局改默认」去修单边 bug（应分支或兼容探测）。

## 快速命令

```bash
npm install
npm run tauri:dev      # 开发（Vite + Rust）
npm run tauri:build    # 打包安装包（macOS dmg/app；Windows nsis）
npm run check:pack     # 发版前预检：tsc + vite build + cargo test（不打安装包、不需签名）
cd src-tauri && cargo test
```

- 前端：`src/`（React + Vite）
- 后端：`src-tauri/`（Rust commands / headless / PTY / resume）
- 改 Rust 后 `tauri:dev` 会重编；正式产物用 `tauri:build`

## 架构

| 层 | 路径 | 职责 |
|----|------|------|
| UI | `src/` | 侧栏、分栏、Mac 顶栏 / Win 工具栏、续聊/活跃/未读、分支底栏；**AI → `ChatHost`**，**Terminal → xterm `TerminalHost`** |
| API 门面 | `src/api/tui.ts` | `invoke` / `listen`；`CHAT_CLI_IDS` / `isChatCli`；`chat_send` / `cli_auth_*` |
| Auth 缓存 | `src/lib/cliAuthCache.ts` | 按 `cliId` 缓存 / 合并 `cli_auth_status`（避免启动卡顿） |
| Rust 入口 | `src-tauri/src/lib.rs` | 窗口、状态、plugins；Mac 红绿灯 / 沉浸缩放 |
| Commands | `src-tauri/src/commands.rs` | session / prefs / cli / dialog / badge / `git_branch` / chat / auth |
| Headless | `src-tauri/src/headless/` | argv / 流式 run / auth / models / config 代理 / permission；**不接 SDK** |
| 设置 UI | `src/components/SettingsModal.tsx` | 审批模式、按引擎登录、模型、Key 表单（写入 CLI 配置） |
| PTY | `src-tauri/src/pty.rs` | portable-pty（**仅 Terminal**；AI CLI 主路径不 spawn PTY） |
| Git | `src-tauri/src/git.rs` | 只读当前分支（失败恒为 `~`） |
| Detect / Spawn / Trust | `cli_detect.rs` / `spawn.rs` / `trust_args.rs` | 探测、启动包装、授信 argv（亦并入 headless） |
| Resume | `src-tauri/src/resume/` | 各 CLI 历史探测；Chat ↻ 只绑定 `cliSessionId`，不拉起 Ink TUI |
| Mac 顶栏原生 | `mac_traffic_lights.rs` + `tauri.macos.conf.json` | Overlay、钉红绿灯、绿钮沉浸缩放（非 Spaces） |

### 双路径（务必分清）

| | AI CLI（`claude` / `opencode` / `kimi` / `cursor` / `codex` / `gemini` / `pi`） | Terminal |
|--|--|--|
| UI | `ChatHost`（气泡 + 输入框） | `TerminalHost`（xterm） |
| 进程 | `chat_send` → headless spawn，捕获 stdout/stderr | PTY 交互 shell |
| `session_create` | **不**开 PTY；可预分配 `cliSessionId`（如 pi） | spawn PTY |
| ↻ 续聊 | `session_respawn` 只解析/绑定 session；前端 `chatResumeArmed`，下一条带 `--session` / `--continue` 等 | 杀旧 PTY 再按 resume argv 拉起 |
| 鉴权 | `cli_auth_*` 或发消息失败 `needsAuth`；OAuth token **不**存 SeMa | 无 |
| 产物 / 未读 / 脉冲 | 有（约定见下） | 无产物、无续聊、无脉冲 |

前端用 `isChatCli(cliId)`（`CHAT_CLI_IDS`）分支；Rust 用 `headless::is_chat_cli`。两边名单必须同步。

**Terminal** 与 AI CLI 同列于探测列表（`cli_detect.rs` 末尾 synthetic，不 PATH 探测）。UI 标签固定 **Terminal**（Win/Mac 同文案，**不**在括号里显示 shell 名）。Spawn 走 `spawn_target` 直启 shell（Win 不用 `cmd /c` 包一层）。

### 平台差异（实现细节）

- **PATH**：Windows `where` + 优先 `.cmd/.exe`；macOS/Linux `which`。Mac GUI 启动时 PATH 很窄：`platform::enrich_path_for_gui_launch` 补 Homebrew、`~/.local/bin`、`~/.npm-global/bin`、`~/bin`、`~/.opencode/bin`、`~/.kimi-code/bin`（不改 Windows）。**Windows GUI**：`where` / git / headless / auth 的 `cmd.exe` 探测与子进程必须设 `CREATE_NO_WINDOW`（对齐旧 Electron `windowsHide`），否则闪黑框并拖慢启动
- **空布局启动**：两边无 `layout` 时都保持空白（关光全部会话会清 `layout`/`split`/`last`）
- **启动首帧**：两边 `backgroundColor: #1e1e1e` + `index.html` 内联同色兜底。**仅 Windows**（`tauri.windows.conf.json`）主窗 `visible: false`，前端首帧 paint 后再 `show()`。**macOS 不要** `visible: false`。平台 conf 按 RFC 7396 **整段替换** `app.windows`，须重写完整窗口字段（含 `title: "SeMa"`）。`detect_tools` 在 setup 后台线程跑，不挡首帧
- **启动性能（Chat）**：布局恢复会挂载**所有**栏（含不可见组）。**禁止**在 `ChatHost` mount 时对每个栏调用 `cli_auth_status`（会 spawn Node CLI，多栏连打极卡）。仅在栏 **`visible`** 时探测；按 `cliId` 用 `cliAuthCache` 缓存/合并；后端 `cli_auth_status` 必须 `spawn_blocking`，勿堵异步线程
- **前端缓存 / 自动更新**：打包后禁用页面右键。版本相对 `webview-asset-version.txt` 变化时 `clear_all_browsing_data` + `reload`（`webview_cache.rs`；`debug_assertions` 跳过）。发版须抬版本号
- **图标**：`src-tauri/icons/`（打包必需：`32x32` / `128x128` / `128x128@2x` / `icon.icns` / `icon.ico`；Win 满幅 `icon.png`；Mac Dock 源 `icon-mac.png` → `icon.icns`）。换标后须重编
- **窗口顶栏**：仅 macOS — Overlay + `MacTitleBar` 高 38px；Win 侧栏 `+` + `#cli-toolbar`。见 `docs/superpowers/specs/2026-08-08-macos-titlebar-toolbar-design.md`
- **Mac 绿钮「全屏」**：`FullScreenNone` + 沉浸缩放（非 Spaces），红绿灯留在顶栏
- **Git 分支底栏**：只读；无 git / 失败显示 `~`；`git_branch` 永不因 git 缺失 reject
- **xterm（仅 Terminal）**：可见闪烁 `block` + 前景色光标，不锁 Ink 样式。历史 Ink 光标兼容（`lockInkHardwareCursor` 等）仅在仍开 AI TUI 的调试路径需要时保留，**主路径 AI 不再嵌 xterm**
- **分栏 fit 滚动**：Terminal 栏 `fitPane` 前后用 `termScroll` 快照/恢复；`ResizeObserver` 仅本栏 textarea 已聚焦才 `focus`
- **Headless argv**：按 `cliId` 在 `headless/argv.rs`；禁止一套 argv 通吃。常见：`claude -p`、`cursor-agent -p --force`、`opencode run --auto`、`pi -p --approve` 等（以该文件与各 CLI `--help` 为准）。授信类 flag 与 `trust_args` 对齐/合并
- **鉴权分型**：A Key/配置文件 · B 浏览器 OAuth（`login`）· C 外置终端兜底 · D 工作区 trust（如 Cursor `--trust`，**≠** 账号登录）。B：`cli_auth_login` spawn 官方 login，打开系统浏览器；SeMa **不**嵌登录页、**不**存 token
- **OpenCode 数据目录**：先查 `~/.local/share/opencode`；Mac 另试 Application Support；Windows 另试 `%APPDATA%\opencode`
- **续聊**：磁盘探测仍在 `resume/`。Chat ↻ → 绑定 id + `chatResumeArmed`；headless 带 `--session` / `-c` / `--continue`（OpenCode Mac：无 id 时勿盲传坏掉的 `--continue`，与既有 resume 约定一致）。**新开栏不要在 create 时 discover**；用户提交后 discover / follow（`/clear` 等换 id 逻辑对 Chat 同样适用时保持）
- **终端选区 / 剪贴板（Terminal）**：Win `Ctrl(+Shift)+C/V`；Mac `Cmd+C/V`。仅 Win：`Ctrl+Z` → `\x1f`。图片附件（Win+Mac）：拖入 / 剪贴板路径 / 位图落盘 → `@path`（Terminal 裸路径）。`file://`：Win 剥 `/C:`，Mac 保留 `/Users/...`
- **应用内快捷键**（窗口前台；勿抢 PTY readline）：新建 Mac `⌘⇧N` / Win `Ctrl+Shift+N`；侧栏 Mac `⌘⇧B` / Win `Ctrl+Shift+B`
- **自定义滚动条**（Win + Mac，`ChromeScrollbar`）：多分栏横向 `#term-columns`；侧栏 tag 可滚无条
- **中文 IME / CapsLock**：主要影响 Terminal xterm；Mac composition 去重、吞 CapsLock、`imeAnchor` 仍按需保留
- **未读角标**：macOS Dock badge；Windows `set_overlay_icon`（`badge.rs`）。失焦算「不在看」；关窗清零
- **Windows 安装包**：默认仅 NSIS。关窗：`kill_all` + `taskkill /T` + `exit(0)`

### Commands / events（常用）

- `cli_list` / `prefs_get` / `prefs_set` / `dialog_pick_folder`
- `session_create` → `{ id, label, canResume }`（默认不自动续聊；**AI 不 spawn PTY**）
- `session_respawn`（↻；Chat 只绑定 session；Terminal 重拉 PTY）
- `chat_send` → headless 一轮；推送 `chat:chunk` /（ask）`chat:permission`；返回最终文本
- `chat_permission_reply` → 向进行中进程 stdin 写入 allow/deny（Claude host 协议）
- `chat_cancel` → 停止进行中的 headless（Win `taskkill /T`；返回 `cancelled`）
- `chat_history` → 只读各 CLI 磁盘会话，返回 `{ sessionId, messages[{role,text}] }`（↻ 后续聊气泡）
- `cli_models_list` / `cli_config_get` / `cli_config_set_provider` / `cli_config_open_dir`
- `cli_auth_status` / `cli_auth_login` → 状态与触发官方 login（async + `spawn_blocking`）
- Prefs：`approvalMode`（`auto`|`ask`）、`cliModels`（cliId → model id）
- `session_kill` / `session_write` / `session_resize`（后两者主要服务 Terminal PTY）
- `session_discover_cli_session` / `session_follow_cli_session`
- `git_branch` → 分支名或 `~`
- `session_artifacts` / `session_artifacts_seq`
- `read_text_file` / `write_text_file`
- `pane_webview_*` → 栏内链接/HTML 子 WebView
- `open_external` / `open_path`
- 推送事件：`session:data`、`session:exit`（**Terminal PTY**）；`chat:chunk`（**Chat 流式**）

### Prefs（常用字段）

- `sidebarWidth`、`sidebarCollapsed`
- `layout` / 旧 `split`、`last`、`cliCounts`
- `docFontSize`、`termFontSize`

## 产品约定（改 UI / 会话时遵守）

1. **AI = Chat，Terminal = xterm**：不要把 AI 主路径改回嵌套 Ink/PTY「套壳」；不要给 Terminal 做聊天气泡。
2. **续聊**：栏顶 ↻ 在 `canResume` 或布局绑定 `cliSessionId` 时显示（Terminal 永不显示）。Chat：点 ↻ → `respawn` 绑定 + `chatResumeArmed`，下一条 headless 续聊；Terminal：点 ↻ → 重拉 PTY。失败兜底新开。开聊后隐藏 ↻。
3. **独立为新会话（⤢）**：仅同组 ≥2 栏时显示。
4. **活跃脉冲**：回车/Chat 发送后武装；有实质输出才绿点；静默 2.5s 结束。↻ **不**武装。Chat 目前主要靠发送态 `busy`；勿为脉冲在启动时扫全栏。
5. **未读 / Toast**：不在看该组时蓝点 + 10s 卡片 + 角标；聚焦/点 tab 清除。
6. **布局**：`prefs.layout = { groups[], activeGroupIndex }`；关光全部会话后清 layout。
7. **工具栏**：Win — 内容区顶栏折叠 + CLI；Mac — Overlay 顶栏同控件，侧栏仅 tab。
8. **分支底栏**：只读；不提供切分支 UI。
9. **快捷键**：新建 / 侧栏折叠见上；须窗口前台；勿注册全局热键。
10. **溢出滚动**：多分栏横向用 `ChromeScrollbar`；侧栏 tag 可滚无条；Win + Mac 一起验收。
11. **侧栏 tab**：默认第一栏文件夹名；双击改 `customTitle`；拖动排序/合并见 `reorderGroups.ts`。栏顶 chrome：`{tool.label} · {cwd}`；× 左侧「打开当前目录」→ `open_path(cwd)`。
12. **会话产物条**：**Terminal 无产物图标**。绑定 `cliSessionId` 且非「待续聊」后，栏顶显示文档/链接数；Portal 下拉；栏内分屏预览规则同前（见 `docs/superpowers/specs/2026-08-16-in-pane-artifact-preview-design.md`）。子 WebView 叠层时下拉开须 `pane_webview_set_visible(false)`。
13. **鉴权 UX**：未登录时 Chat 内引导「登录 / 刷新状态」；设置页按引擎登录。配置代理写引擎自己的配置（OpenCode/Pi）；**不要**接 SDK，**不要**把 OAuth token / 明文 Key 写入 SeMa prefs（Key 只进 CLI 配置文件，UI 只显示脱敏 hint）。
14. **模型**：Chat 顶栏选择器 + prefs `cliModels`；列表来自各 CLI 列模型命令。
15. **审批**：默认 auto（各 CLI skip/yolo/force/auto）。ask 时 Claude 弹审批卡片；其它引擎仅去掉自动批准，可能卡住——设置里说明清楚。
16. **不接 SDK**：AI 能力一律本机 CLI headless；新增引擎只加适配器。

## 代码习惯

- 前端 TypeScript + React；后端 Rust（CommonJS Electron 已退役）。
- 新 AI CLI：`cli_detect.rs` CATALOG + `headless/argv.rs`（+ `auth.rs` 若有 login/status）+（若可续聊）`resume/` +（若有授信）`trust_args.rs` + 前端 `CHAT_CLI_IDS`。
- 设计稿：`docs/superpowers/specs/`；实现计划：`docs/superpowers/plans/`。
- 分栏 `min-width: 240px`；Terminal host 未达约 20×5 格时不 fit / 不 resize。

## 不要做的事

- 不要为修一边而改坏另一边；单边问题用平台分支。
- 不要只按单一 OS 假设改 PATH、spawn、headless argv、路径或续聊参数。
- 不要默认自动续聊打开会话。
- 不要把 transcript / 会话内容存进 SeMa（Chat 气泡为当次 UI 状态，不作第二套主库）。
- 不要引入重型前端框架堆栈（保持 Vite + React + Zustand 量级）。
- 不要为 AI CLI 主路径重新嵌入 xterm/Ink「套壳」；不要接各厂商/CLI 官方 SDK 当主路径。
- 不要在每个 Chat 栏 mount 时同步/并发狂打 `cli_auth_status`（会拖垮启动）。

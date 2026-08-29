# AGENTS.md — SeMa

跨平台桌面应用（**Windows / macOS**）：**多 AI CLI 会话管理器**（Tauri 2 + Rust + React/TypeScript + xterm.js + portable-pty）。按项目目录打开 Claude / Cursor Agent / OpenCode / Codex / Gemini / Pi / Kimi Code，以及系统 **Terminal**（Win `cmd` / Mac `$SHELL`），支持分栏、续聊、侧栏折叠、活跃脉冲与未读。

## 强制：双平台（且互不影响）

**每次改动都必须同时考虑 Windows 与 macOS。**

- **默认两边行为一致**；共享逻辑优先，不要为修一边而改坏另一边。
- **有差异时必须隔离**：用 `cfg!(windows)` / `cfg!(target_os = "macos")`（Rust）或前端 `tui.isWin` / `tui.isMac` 显式分支，只动出问题的那一侧；并在本文件「平台差异」补一句说明。
- **互不影响**：针对 Mac 的 workaround（例如 OpenCode 不用坏掉的 `--continue`）不得改变 Windows 既有成功路径；针对 Windows 的 shim/`cmd.exe`/`where` 逻辑不得套到 Mac 上。
- **回归自检**：改探测 / spawn / resume / 路径后，想一遍「另一边现在会不会拿到错误 argv、错误 PATH 或错误数据目录」；单测断言按平台分支，禁止写死只过一边。

改下列任一区域时，先想清两条路径再写代码：

| 区域 | Windows 要点 | macOS 要点 |
|------|----------------|------------|
| PATH / 探测 | `where`；优先 `.cmd/.exe/.bat` | `which`；Homebrew 常在 `/opt/homebrew/bin` |
| Spawn | 无扩展名 shim → `cmd.exe /c`；有 `.cmd` 则直启 + args | 直接 `tool.path` + args |
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
npm test               # Vitest（前端纯逻辑）
cd src-tauri && cargo test
```

- 前端：`src/`（React + Vite）
- 后端：`src-tauri/`（Rust commands / PTY / resume）
- 改 Rust 后 `tauri:dev` 会重编；正式产物用 `tauri:build`

## 架构

| 层 | 路径 | 职责 |
|----|------|------|
| UI | `src/` | 侧栏、分栏、Mac 顶栏 / Win 工具栏、续聊/活跃/未读、分支底栏、xterm |
| API 门面 | `src/api/tui.ts` | `invoke` / `listen`，对齐原 `window.tui` |
| Rust 入口 | `src-tauri/src/lib.rs` | 窗口、状态、plugins；Mac 红绿灯 / 沉浸缩放 |
| Commands | `src-tauri/src/commands.rs` | session / prefs / cli / dialog / badge / `git_branch` |
| PTY | `src-tauri/src/pty.rs` | portable-pty 会话表与事件推送 |
| Git | `src-tauri/src/git.rs` | 只读当前分支（失败恒为 `~`） |
| Detect / Spawn / Trust | `cli_detect.rs` / `spawn.rs` / `trust_args.rs` | 探测、启动、授信 argv |
| Resume | `src-tauri/src/resume/` | 各 CLI 历史探测与续聊 argv |
| Mac 顶栏原生 | `mac_traffic_lights.rs` + `tauri.macos.conf.json` | Overlay、钉红绿灯、绿钮沉浸缩放（非 Spaces） |

**Terminal** 与 AI CLI 同列于探测列表（`cli_detect.rs` 末尾 synthetic 条目，不 PATH 探测）。UI 标签固定 **Terminal**（Win/Mac 同文案，**不**在括号里显示 shell 名）。**无续聊 / 无 CLI 会话绑定 / 无产物条 / 无活跃脉冲**（`cliId === "terminal"` 分支）。Spawn 走 `spawn_target` 直启 shell（Win 不用 `cmd /c` 包一层）；实际进程见下表「Terminal 启动」。

### 平台差异（实现细节）

- **PATH**：Windows `where` + 优先 `.cmd/.exe`；macOS/Linux `which`。Mac GUI 启动时 PATH 很窄：`platform::enrich_path_for_gui_launch` 补 Homebrew、`~/.local/bin`、`~/.npm-global/bin`、`~/bin`、OpenCode 官方安装脚本默认的 `~/.opencode/bin`、以及 Kimi Code 官方安装脚本默认的 `~/.kimi-code/bin`（不改 Windows）。**Windows GUI**：`where` / git 的 `cmd.exe` 探测必须设 `CREATE_NO_WINDOW`（对齐旧 Electron `windowsHide`），否则启动/底栏会连闪黑框并拖慢感知启动
- **空布局启动**：两边无 `layout` 时都保持空白（关光全部会话会清 `layout`/`split`/`last`）
- **启动首帧**：两边 `backgroundColor: #1e1e1e` + `index.html` 内联同色兜底。**仅 Windows**（`tauri.windows.conf.json`）主窗 `visible: false`，前端首帧 paint 后再 `show()`（修安装包 WebView2 白屏）。**macOS 不要** `visible: false`——hidden + `show()` 在 WKWebView 上不可靠，窗口会一直不出现。平台 conf 按 RFC 7396 **整段替换** `app.windows` 数组，所以 `tauri.windows.conf.json` / `tauri.macos.conf.json` 必须重写完整窗口字段（含 `title: "SeMa"`），不能只写差分。`detect_tools` 在 setup 后台线程跑，不挡首帧（`cli_list` 在 tools 仍空时会 refresh）
- **图标**：`src-tauri/icons/`（打包必需：`32x32` / `128x128` / `128x128@2x` / `icon.icns` / `icon.ico`；Win 满幅源 `icon.png`；Mac Dock 源 `icon-mac.png` → `icon.icns`）。勿提交 Store/UWP/`ios`/`android` 多余尺寸。换标后须重编（dev 缓存可能仍嵌旧图；Mac 可 `cargo clean -p sema`）
- **窗口顶栏**：仅 macOS — `titleBarStyle: Overlay`、`MacTitleBar` 高 38px 与红绿灯同条；Win 保持侧栏 `+` + `#cli-toolbar`。设计见 `docs/superpowers/specs/2026-08-08-macos-titlebar-toolbar-design.md`
- **Mac 绿钮「全屏」**：关闭 Spaces 全屏（`FullScreenNone`），绿钮切换沉浸缩放（铺满屏 + 藏菜单栏/Dock，红绿灯仍留在顶栏）；再点按保存的 frame 还原。勿再走系统 Spaces（会藏红绿灯到顶部热区）
- **Git 分支底栏**：每栏底部固定一行；有分支显示分支图标+名；无 git / 失败显示 `~`（无图标）。只读，不可切换分支。命令 `git_branch` 永不因 git 缺失而 reject
- **xterm 硬件光标**：Ink/TUI（Cursor 等）自绘反色光标；硬件光标常叠在同一格。勿用与背景同色的 `block`（`cursorBlink: false` 时 `!important` 铺底会盖掉反色格，表现为「能输入但无光标」）。用 `cursorStyle: "bar"` + 光标色=背景（无单元格填充，暗底上 1px 条不可见）
- **Spawn**：Windows 无扩展名 shim 时走 `cmd.exe /c`；Unix 直接 `tool.path` + args
- **OpenCode 数据目录**：两边都先查 `~/.local/share/opencode`；Mac 另试 Application Support；Windows 另试 `%APPDATA%\opencode`
- **OpenCode 续聊 argv**：优先 `--session <id>`；查不到 id 时 Windows 回退 `--continue`，macOS 空 argv
- **Kimi 续聊 argv**：优先 `--session <id>`；查不到 id 时 Windows 与 macOS 均回退 `--continue`
- **Kimi 启动授信**：`trust_args` 注入 `--auto`（自动权限模式；Win + Mac 相同；与 `--yolo` 互斥，勿同时加）
- **续聊路径探测（Mac）**：`resolve` + `realpath` 候选；Claude / Cursor hash / Pi / OpenCode 均走候选
- **Cursor 会话绑定**：只认存在 `store.db` 的目录；无效 id 的 ↻ 回退 last-in-cwd（OpenCode 在 Mac 仍不传 `--continue`）
- **同目录多分栏续聊**：优先绑定 `cliSessionId`；否则最新未占用 + claim；**新开栏不要在 spawn 时 discover**，仅该栏用户提交后 discover。CLI `/clear`（`/new`/`/reset`）会换新会话 id：输入检测后立刻清绑定并 rediscover；提交后短轮询 + 回合 idle / ↻ / 恢复时 `follow` 到更新的未占用 id
- **终端选区 / 剪贴板**：右键菜单两边相同。Win `Ctrl(+Shift)+C/V`；Mac `Cmd+C/V`。仅 Windows：`Ctrl+Z` → `\x1f`（禁止 `\x1a` EOF）。`Ctrl+U` → `\x15`
- **应用内快捷键**（仅 SeMa 窗口前台生效，非 OS 全局热键；避免裸 Ctrl+N/B 抢 PTY readline）：
  - 新建会话：Mac `⌘⇧N` / Win `Ctrl+Shift+N`（`src/lib/newSessionKeys.ts`）
  - 显隐侧栏：Mac `⌘⇧B` / Win `Ctrl+Shift+B`（`src/lib/sidebarToggleKeys.ts`）
- **自定义滚动条**（Win + Mac，`ChromeScrollbar`）：Mac WKWebView 忽略 `::-webkit-scrollbar`，隐藏原生条后用 DOM 画 chrome 色（`#252526` 轨、`#3c3c3c` 块、hover `#094771`）。
  - 多分栏横向：`#term-columns` + `.term-hscroll`；滚轮在栏顶/底栏/分隔条横向滑；终端内普通滚轮仍 scrollback，**Shift+滚轮**或触控板横向手势滑分栏（`horizontalWheel.ts` 按 `deltaMode` 归一化，Win 鼠标常见 LINE）
  - 侧栏 tag 纵向：`#tabs` 可滚轮/触控板上下滚，**不展示滚动条**（`scrollbar-width: none` + 隐藏 webkit 条）
- **中文 IME / CapsLock**：Mac 预编辑中途 CapsLock 切英文会双发（xterm 5.5）；`compositionstart` 起短时去重相同 `onData`（仅 Mac）。吞 CapsLock keydown（含 `code`，Win 亦安全）。`imeAnchor.ts` 钉 IME 到反色光标格（Win + Mac）
- **未读角标**：按未读组数同步；macOS Dock badge；Windows `set_overlay_icon`（`badge.rs` 生成 32×32 数字图，不用 `set_badge_count` / 不闪烁任务栏）。窗口失焦也算「不在看」；关窗 / 退出时清零
- **Windows 安装包**：默认只打 NSIS（`SeMa_*_x64-setup.exe`）；MSI/WiX 卸载易被残留进程卡住，已从默认 targets 去掉
- **Windows 退出**：关窗时后台 `kill_all` + `taskkill /T` 清进程树，并 `exit(0)`，避免关窗后残留挡卸载

### Commands / events（常用）

- `cli_list` / `prefs_get` / `prefs_set` / `dialog_pick_folder`
- `session_create` → `{ id, label, canResume }`（默认新开会话，不自动续聊）
- `session_respawn`（↻；失败则回退新会话）
- `session_kill` / `session_write` / `session_resize` / `session_discover_cli_session`
- `git_branch` → 分支名或 `~`（永不抛错）
- `session_artifacts` / `session_artifacts_seq` → 按 `cliSessionId` 抽文档/链接（可选 `sinceSeq`）
- `read_text_file` / `write_text_file` → 栏内文档读写
- `pane_webview_open` / `pane_webview_set_bounds` / `pane_webview_set_visible` / `pane_webview_close` → 栏内链接/HTML 子 WebView
- `open_external` → 系统浏览器（产物右键 Open、链接加载失败兜底）
- 推送事件：`session:data`、`session:exit`

### Prefs（常用字段）

- `sidebarWidth`、`sidebarCollapsed`
- `layout` / 旧 `split`、`last`、`cliCounts`

## 产品约定（改 UI / 会话时遵守）

1. **续聊**：栏顶 ↻ 在探测到历史（`canResume`）或布局绑定了 `cliSessionId` 时显示；点后 `respawn`；失败兜底新开。回车开聊后隐藏 ↻（IME keyCode 229 不触发）。
2. **独立为新会话（⤢）**：仅同组 ≥2 栏时显示。
3. **活跃脉冲**：仅回车发消息后武装；有实质输出才绿点脉冲；静默 2.5s 结束。↻ **不**武装脉冲。
4. **未读 / Toast**：不在看该组时蓝点 + 10s 卡片 + 角标；聚焦/点 tab 清除。
5. **布局**：`prefs.layout = { groups[], activeGroupIndex }`；`groups` 数组顺序即侧栏 tab 顺序（拖动排序后写入）；关光全部会话后清 layout。
6. **工具栏**：Win — 内容区顶栏最左折叠、右侧 CLI；Mac — 同上控件在 Overlay 顶栏（与红绿灯一行），侧栏仅 tab。
7. **分支底栏**：只读展示；不提供切分支 UI（交给 IDE / CLI）。
8. **快捷键**：新建 / 侧栏折叠见上表；须窗口前台；勿注册全局热键。
9. **溢出滚动**：多分栏横向用 `ChromeScrollbar`（Mac 勿只靠 `::-webkit-scrollbar`）；侧栏 tag 纵向可滚但不显示滚动条；Win + Mac 一起验收。
10. **侧栏 tab**：默认第一栏文件夹名；双击可改并写入 `layout.groups[].customTitle`；清空恢复默认。**拖动排序**（pointer 拖拽，非 HTML5 DnD）：拖到某 tab 上/下边缘（约各 25%）插入并重排，顺序随 `layout.groups` 持久化、下次启动恢复；**拖到标签中部**合并分栏。拖拽时禁用文字选中与 `:hover` 高亮（`#tabs.is-dragging`；仅保留合并目标 `drop-target` 与插入线 `drop-insert-before`）；被拖 tab 文字透明、由 ghost 显示标签名。右键或 Delete 关闭组。栏顶 chrome：`{tool.label} · {cwd}`（点两侧有空格）。逻辑见 `src/lib/reorderGroups.ts`、`src/components/Sidebar.tsx`。
11. **会话产物条**：**Terminal 无产物图标**。绑定 `cliSessionId` 且非「待续聊」后，栏顶 **`.pane-actions`**（`×` 左侧）显示 **文件夹图标 + 文档数**、**地球图标 + 链接数**（UI **无「产物」**、无 chrome 下折叠条）。点击图标 → **Portal 悬浮下拉**（锚在图标下方、右对齐；`Esc`/点外关闭）。左键条目 → **栏内分屏**（左 xterm | 右内容，可拖分隔条）：`.md`/`.markdown` 默认**预览**、工具栏**单图标**切换编辑/预览；`.html`/`.htm` 与 `http(s)` 链接用 Tauri **子 WebView**；其余白名单文档为文本编辑器；**保存** Mac `⌘S` / Win `Ctrl+S`。右键条目 **Open** → 系统浏览器。按 `cliSessionId` 只读各 CLI 会话存储；**布局恢复 / 待 ↻ 时不展示**，须点 ↻ 或开聊后才有；↻ 续聊展示**全量历史**；新会话仅展示绑定后的新条目。不可栏内打开的 `http(s)` 在收集阶段过滤。**子 WebView 叠在主窗口 HTML 之上**：链接预览已开时，产物下拉打开须 **`pane_webview_set_visible(false)`**，右栏显示 URL/文件名占位，关菜单后恢复页面（Win+Mac 同逻辑）。**× 仅关右栏**；切组 hide WebView；`/clear`/`/new`/`/reset` 清空并关右栏；预览态仅内存。见 `docs/superpowers/specs/2026-08-16-in-pane-artifact-preview-design.md`。
12. **Terminal**：CLI 选择器与栏顶 chrome 均显示 **Terminal**（无括号后缀）。后台 Win 启 `COMSPEC`/`cmd.exe`，Mac 启 `$SHELL`（回退 zsh/bash）。不可续聊、不 discover 会话 id、不显示 ↻。

## 代码习惯

- 前端 TypeScript + React；后端 Rust（CommonJS Electron 已退役）。
- 新 CLI：`cli_detect.rs` CATALOG +（若可续聊）`resume/` +（若有授信 flag）`trust_args.rs`。
- 设计稿：`docs/superpowers/specs/`；实现计划：`docs/superpowers/plans/`。
- 分栏 `min-width: 240px`；host 未达约 20×5 格时不 fit / 不 resize。

## 不要做的事

- 不要为修一边而改坏另一边；单边问题用平台分支。
- 不要只按单一 OS 假设改 PATH、spawn、路径或续聊参数。
- 不要默认自动续聊打开会话。
- 不要把 transcript / 会话内容存进 SeMa。
- 不要引入重型前端框架堆栈（保持 Vite + React + Zustand 量级）。

# SeMa

跨平台（**Windows / macOS**）桌面应用：在一个窗口里管理多个 AI CLI 会话。

按项目目录打开 Claude Code、Cursor Agent、OpenCode、Codex、Gemini、Pi 等工具，支持分栏、续聊、侧栏折叠、活跃脉冲与未读提示。

## 功能

- **多 CLI 会话**：按项目目录启动已安装的 AI CLI（未检测到的不会出现在列表中）
- **分栏布局**：同一组内并排多个会话，可拖拽调整宽度
- **右上角 CLI 快捷按钮**：终端区顶部右侧列出已检测到的 CLI；点击即可在当前焦点栏的同一项目目录下，于本组内再开一列（无需再选文件夹）
- **拖动合并**：将左侧会话组标签拖到另一个标签上，即可把源组的所有会话并入目标组（追加为新分栏）；不同项目目录也可合并，各栏仍保留各自目录
- **续聊**：探测到该目录历史时，栏顶显示 ↻，一键恢复上次会话
- **侧栏折叠**：工具栏最左 ◀ / ☰ 折叠左侧会话列表，终端区域保持
- **活跃脉冲**：发送消息后有实质回复时，侧栏绿点脉冲提示
- **未读提示**：非当前会话组有回复时，蓝点未读 + Toast；macOS Dock / Windows 任务栏角标
- **布局记忆**：退出后记住分组与分栏；关闭全部会话后下次启动保持空白

默认打开的是**新会话**，不会自动续聊。会话内容由各 CLI 自行存储，SeMa 不保存 transcript。

## 环境要求

- Node.js（建议 LTS）
- Windows 或 macOS
- 已安装并配置好 PATH 的 AI CLI（按需安装即可）

## 安装

在仓库根目录执行：

```bash
npm install
```

`postinstall` 会处理 `node-pty` 权限等初始化。若启动失败（原生模块与 Electron ABI 不匹配），可手动执行：

```bash
npx @electron/rebuild
```

该命令会通过 **node-gyp** 重编原生模块（本项目主要是 `node-pty`）。若 rebuild 报错、无法编译，通常不是再装一个 npm 包就能解决，而是缺少 node-gyp 所需的**系统编译环境**：

| 平台 | 需要准备 |
|------|----------|
| macOS | 安装 Xcode Command Line Tools：`xcode-select --install` |
| Windows | 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选「使用 C++ 的桌面开发」），并安装 Python（node-gyp 会用到） |

也可先装工具本身：`npm install -g node-gyp`，但仍需上面的编译器 / 工具链齐全后再执行 `npx @electron/rebuild`。

## 启动方式

### 命令行

```bash
npm start
```

修改主进程代码后需**完全退出**再重新启动，仅刷新窗口不够。

### 便捷启动（Launcher）

不必每次敲 `npm start`。先完成上方 `npm install`，再用平台对应方式启动。

#### macOS

| 方式 | 说明 |
|------|------|
| 双击 `launcher/mac/SeMa.app` | 推荐；可拖进 Dock |
| `launcher/mac/start-sema.sh` | 命令行调试用 |
| `npm run build:launcher-mac` | 更新图标或模板后重新生成 `.app` |

首次若被 Gatekeeper 拦截：右键 → **打开**，或在系统设置中允许。

#### Windows

| 方式 | 说明 |
|------|------|
| 双击 `launcher/windows/SeMa.vbs` | 无黑色控制台窗口；默认可用，无需额外构建 |
| `launcher/windows/SeMa.exe` | 需本地先构建（见下） |
| `install-shortcut` | 生成桌面与开始菜单快捷方式 |

构建带图标的 exe（可选）：

```powershell
powershell -ExecutionPolicy Bypass -File launcher/windows/build-sema-exe.ps1
```

或双击 `launcher/windows/build-sema-exe.bat`。也可用：

```bash
npm run build:launcher-win
```

生成桌面 / 开始菜单快捷方式（可选，推荐）：

```powershell
powershell -ExecutionPolicy Bypass -File launcher/windows/install-shortcut.ps1
```

或双击 `launcher/windows/install-shortcut.bat`。之后可从开始菜单或桌面将 **SeMa** 固定到任务栏。

> 当前仓库以开发方式运行（`electron .`），不是安装包形态的正式发行版。移动仓库目录后，请重新运行 `install-shortcut`。

## 使用说明

1. 点击左侧 **+**，选择项目目录与 CLI，打开会话。
2. **左侧会话组**：将一个组标签拖到另一个组标签上，可合并为一组分栏（源组会话追加到目标组；标签文件夹名以目标组为准）。栏顶 **⤢** 可把当前栏再拆回独立会话。
3. **顶部工具栏**
   - 最左 **◀ / ☰**：折叠或展开左侧会话列表
   - **右上角 CLI 按钮**：按使用频率列出可用 CLI；点击后在当前焦点会话的**同一目录**下新开一列，并加入当前分栏组。无焦点会话时按钮不可用。也可通过左侧 **+** 选目录开全新一组。
4. **栏顶按钮**
   - **↻**：探测到该目录历史时可续聊（失败则回退为新会话）
   - **⤢**：同分栏（同组 ≥ 2 栏）时，将当前栏独立为新会话
5. **未读**：非当前会话组有回复时，侧栏蓝点 + Toast；点击 tab / 卡片可清除；窗口重新聚焦且停在该组时也会清除

## 数据目录

| 用途 | Windows | macOS |
|------|---------|--------|
| SeMa 配置与缓存 | `%APPDATA%\sema\` | `~/Library/Application Support/sema/` |
| 各 CLI 会话内容 | 由对应 CLI 自行存储 | 同左 |

## 常见问题

| 现象 | 处理 |
|------|------|
| 提示执行 `npm install` | 在仓库根目录安装依赖 |
| `npx @electron/rebuild` 失败 / node-gyp 报错 | 先装齐编译环境（见上方「安装」）；macOS：`xcode-select --install`；Windows：VS Build Tools（C++）+ Python，再重跑 rebuild |
| Windows 任务栏显示为 Electron | 完全退出后重开；或重跑 `install-shortcut.ps1`；取消旧 Electron 固定后改钉 SeMa |
| 启动后原生模块报错 | 执行 `npx @electron/rebuild` 后重新启动 |
| macOS 开会话报 `posix_spawnp failed` | 多为 `node-pty` 的 `spawn-helper` 丢失执行位；重启应用会自动修复，或再执行一次 `npm install` |
| 移动仓库后快捷方式失效 | 重新运行 `launcher/windows/install-shortcut.ps1` |

English: [README.en.md](./README.en.md)

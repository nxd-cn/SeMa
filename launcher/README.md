# SeMa 启动器

双击或固定到 Dock / 开始菜单即可打开 SeMa，不必每次敲 `npm start`。仍需在仓库内先执行 `npm install`（不是安装包形态的正式发行版）。

## 前置条件

在仓库根目录执行：

```bash
npm install
```

## macOS

1. 双击 `launcher/mac/SeMa.app`（也可拖进 Dock）。
2. 若首次被 Gatekeeper 拦截：右键 → **打开**，或在系统设置中允许。
3. 更新图标或模板后：执行 `bash launcher/mac/build-sema-app.sh`（或 `npm run build:launcher-mac`）重新生成 `.app`。
4. 若仍显示通用图标：把 `launcher/mac/SeMa.app` 移出再移回 `launcher/mac/`，或重启 Finder。

说明：`SeMa.app` 内嵌启动逻辑（**不会**调用包外的 `start-sema.sh`）。从 Finder / Dock 启动时，系统不允许执行 `.app` 包外的脚本（否则会 `Operation not permitted`）。命令行调试可用 `launcher/mac/start-sema.sh`。应用图标为 `Contents/Resources/AppIcon.icns`（由圆角+透明边距的 `assets/icon-mac1024.png` 生成；Windows 仍用直角满幅的 `assets/icon.png` / `icon1024.png`）。真正进程是仓库内的 `Electron.app`（`exec`），因此启动前会把 SeMa 图标/名称写进该 bundle，Cmd+Tab / 调度中心才会显示 SeMa 而不是 Electron（Windows 不走此逻辑）。

## Windows

脚本与产物均在 `launcher/windows/` 下。

1. 双击 `launcher/windows/SeMa.vbs` 启动（无黑色控制台窗口）。仓库**默认不包含** `SeMa.exe`，未本地构建前请用 vbs。

2. 可选（推荐）：在 Windows 上执行一次，生成带图标的 `SeMa.exe`：

```powershell
powershell -ExecutionPolicy Bypass -File launcher/windows/build-sema-exe.ps1
```

也可直接双击：`launcher/windows/build-sema-exe.bat`

生成后可优先双击 `launcher/windows/SeMa.exe`；未生成时继续用 `SeMa.vbs` 即可。

3. 可选：在仓库根目录执行一次，生成桌面与开始菜单快捷方式（优先指向 `SeMa.exe`）：

```powershell
powershell -ExecutionPolicy Bypass -File launcher/windows/install-shortcut.ps1
```

也可直接双击：`launcher/windows/install-shortcut.bat`

`install-shortcut.ps1` 会调用本地 Electron 运行 `write-shortcuts.js`，写入带 `AppUserModelID` 的桌面与开始菜单快捷方式。

然后从开始菜单或桌面将 **SeMa** 固定到任务栏。

说明：未打包时真正进程仍是 `electron.exe`。快捷方式会写入 `AppUserModelID=com.sema.app`（与 `main.js` 一致），任务栏才会显示 SeMa 名称/图标而不是 Electron。应用启动时也会自动维护开始菜单里的 `SeMa.lnk`。若任务栏仍钉着旧的 Electron，先取消固定再钉 SeMa。

## 排错

| 现象 | 处理 |
|------|------|
| 弹窗提示执行 `npm install` | 在仓库根目录安装依赖 |
| Windows：没生成 `SeMa.exe` | 执行 `powershell -ExecutionPolicy Bypass -File launcher/windows/build-sema-exe.ps1` |
| Windows：exe 启动失败 / 找不到仓库 | 确认 `launcher/windows/` 仍在仓库内；`SeMa.exe` 须本地 `build-sema-exe.ps1` 生成，未生成时用 `SeMa.vbs` |
| Windows：编译器缺失 | 继续使用 `launcher/windows/SeMa.vbs`（脚本会提示）；这是无额外安装的兜底路径 |
| Windows：任务栏仍是 Electron 图标/名称 | 完全退出后重开；或重跑 `launcher/windows/install-shortcut.ps1`；取消旧 Electron 固定后改钉 SeMa |
| macOS：Cmd+Tab / 调度中心仍是 Electron 图标 | 完全退出后重开 `launcher/mac/SeMa.app`（启动会 brand `Electron.app`）；或执行 `node scripts/brand-electron-mac.js`。若图标缓存僵住：把 `launcher/mac/SeMa.app` 移出再移回 `launcher/mac/` |
| macOS：双击无反应 / `open` 报 Launch failed | `SeMa` 脚本须有执行位：`chmod +x launcher/mac/SeMa.app/Contents/MacOS/SeMa`（仓库内应为 `100755`） |
| macOS：`posix_spawnp failed` 无法开会话 | 多为 `node-pty` 的 `spawn-helper` 丢了执行位（iCloud/Desktop 同步常见）。应用启动会自动修复；也可执行 `npm run postinstall` 或 `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` |
| macOS：窗口起不来 / 原生模块错误 | 执行 `npx @electron/rebuild` 后重新启动 |
| 移动仓库后快捷方式失效 | 重新运行 `launcher/windows/install-shortcut.ps1`（`.lnk` 内是绝对路径） |
| Windows：错误弹窗中文乱码 | `launcher/windows/SeMa.vbs` 须保持 UTF-16 LE + BOM（已处理）；可在 Windows 上再确认一次 MsgBox 文案 |

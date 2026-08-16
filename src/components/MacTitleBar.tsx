import { tui } from "../api/tui";
import { newSessionShortcutLabel } from "../lib/newSessionKeys";
import { sidebarToggleShortcutLabel } from "../lib/sidebarToggleKeys";
import { useAppStore } from "../store/appStore";

type Props = {
  onNewSession: () => void;
  onToggleSidebar: () => void;
  onOpenTool: (cliId: string) => void;
};

/** macOS overlay title bar: + / sidebar toggle / CLI tools (Windows unused). */
export default function MacTitleBar({
  onNewSession,
  onToggleSidebar,
  onOpenTool,
}: Props) {
  const tools = useAppStore((s) => s.tools);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const hasPanes = useAppStore((s) => Object.keys(s.panes).length > 0);
  const tipBase = sidebarCollapsed ? "显示侧栏" : "隐藏侧栏";
  const tip = `${tipBase} (${sidebarToggleShortcutLabel(tui.isMac)})`;

  return (
    <header id="mac-titlebar" aria-label="窗口工具栏">
      <div className="mac-titlebar-left">
        <button
          type="button"
          className="mac-titlebar-btn"
          title={`新建会话 (${newSessionShortcutLabel(tui.isMac)})`}
          aria-label={`新建会话 (${newSessionShortcutLabel(tui.isMac)})`}
          onClick={() => void onNewSession()}
        >
          +
        </button>
        <button
          type="button"
          className="mac-titlebar-btn"
          id="sidebar-toggle"
          title={tip}
          aria-label={tip}
          aria-expanded={sidebarCollapsed ? "false" : "true"}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? "☰" : "◀"}
        </button>
      </div>
      <div className="mac-titlebar-drag" data-tauri-drag-region />
      <div className="mac-titlebar-tools" aria-label="分栏打开 CLI">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="mac-titlebar-btn"
            title={`分栏打开 ${tool.label}`}
            disabled={!hasPanes}
            onClick={() => onOpenTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </div>
    </header>
  );
}

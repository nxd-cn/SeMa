import { tui } from "../api/tui";
import { sidebarToggleShortcutLabel } from "../lib/sidebarToggleKeys";
import { useAppStore } from "../store/appStore";

type Props = {
  onToggleSidebar: () => void;
  onOpenTool: (cliId: string) => void;
};

export default function CliToolbar({ onToggleSidebar, onOpenTool }: Props) {
  const tools = useAppStore((s) => s.tools);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const hasPanes = useAppStore((s) => Object.keys(s.panes).length > 0);
  const tipBase = sidebarCollapsed ? "显示侧栏" : "隐藏侧栏";
  const tip = `${tipBase} (${sidebarToggleShortcutLabel(tui.isMac)})`;

  return (
    <div id="cli-toolbar" aria-label="分栏打开 CLI">
      <button
        id="sidebar-toggle"
        type="button"
        title={tip}
        aria-label={tip}
        aria-expanded={sidebarCollapsed ? "false" : "true"}
        onClick={onToggleSidebar}
      >
        {sidebarCollapsed ? "☰" : "◀"}
      </button>
      <div id="cli-toolbar-tools">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            title={`分栏打开 ${tool.label}`}
            disabled={!hasPanes}
            onClick={() => onOpenTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </div>
    </div>
  );
}

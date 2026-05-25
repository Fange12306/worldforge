import { useStore } from "@/lib/store";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";

/** Sidebar collapse/expand control. */
export function SidebarToggle() {
  const { t } = useT();
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  const label = sidebarOpen ? t.layout.collapse : t.layout.expand;

  return (
    <Tooltip content={label}>
      <button
        onClick={toggleSidebar}
        className="
          flex items-center justify-center
          w-7 h-7 rounded-lg
          text-ink-muted hover:text-ink
          hover:bg-surface-800
          transition-colors
        "
        aria-label={label}
      >
        {sidebarOpen ? (
          <PanelLeftClose className="w-4 h-4" />
        ) : (
          <PanelLeftOpen className="w-4 h-4" />
        )}
      </button>
    </Tooltip>
  );
}

import { useStore } from "@/lib/store";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

/** Sidebar collapse/expand control. */
export function SidebarToggle() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  return (
    <Tooltip content={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>
      <button
        onClick={toggleSidebar}
        className="
          flex items-center justify-center
          w-7 h-7 rounded-lg
          text-ink-muted hover:text-ink
          hover:bg-surface-800
          transition-colors
        "
        aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
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

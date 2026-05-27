import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { invoke } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Sun, Moon, Command, BookOpen } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { WorldForgeLogo } from "@/components/brand/WorldForgeLogo";

export function Header() {
  const { t } = useT();
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const [chapterCount, setChapterCount] = useState(0);
  const [chapterDone, setChapterDone] = useState(0);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const activeStory = activeWorld?.stories.find((s) =>
    s.conversations.some((c) => c.id === activeConversationId),
  );
  const activeConv = activeStory?.conversations.find(
    (c) => c.id === activeConversationId,
  );

  // Reload outline count when world/story switches or data changes
  useEffect(() => {
    if (!activeWorld || !activeStory) {
      setChapterCount(0);
      setOutlineLoaded(false);
      return;
    }
    let cancelled = false;
    invoke<Array<{ order: number; status: string; has_body: boolean }>>("read_outline", {
      worldPath: activeWorld.path,
      storyId: activeStory.id,
    })
      .then((chapters) => {
        if (cancelled) return;
        const done = chapters.filter((c) => c.status === "done" || c.has_body).length;
        setChapterCount(chapters.length);
        setChapterDone(done);
        setOutlineLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setOutlineLoaded(true);
      });
    return () => { cancelled = true; };
  }, [activeWorld?.path, activeStory?.id, refreshKey]);

  // Listen for outline changes from Agent tool calls
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener("worldforge-data-changed", handler);
    return () => window.removeEventListener("worldforge-data-changed", handler);
  }, []);

  return (
    <header className="h-12 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-ink-secondary truncate">
          {activeWorld ? (
            <>
              <span className="text-ink-muted">{activeWorld.name}</span>
              {activeStory && (
                <>
                  <span className="text-ink-muted mx-1">/</span>
                  <span>{activeStory.title}</span>
                </>
              )}
              {activeConv && (
                <>
                  <span className="text-ink-muted mx-1">/</span>
                  <span className="text-ink">{activeConv.title}</span>
                </>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-2">
              <WorldForgeLogo className="w-4 h-4" />
              <span>WorldForge</span>
            </span>
          )}
        </span>

        {/* Outline progress badge */}
        {activeStory && outlineLoaded && (
          <span className="flex items-center gap-1 text-[0.625rem] text-ink-muted bg-surface-900 border border-edge rounded-full px-2 py-0.5">
            <BookOpen className="w-3 h-3" />
            {chapterCount > 0 ? t.entry.chapterCount(chapterDone, chapterCount) : t.entry.noOutline}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => (window as any).__worldforge?.openPalette?.()}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-ink-muted bg-surface-900 border border-edge rounded-md hover:bg-surface-800 transition-colors"
        >
          <Command className="w-3 h-3" />
          <span>{t.commands.panel}</span>
        </button>

        <Tooltip content={theme === "dark" ? t.layout.switchLight : t.layout.switchDark}>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

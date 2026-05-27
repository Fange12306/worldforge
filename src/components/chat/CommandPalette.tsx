import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "@/lib/store";
import { invoke } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Search, ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";

type Command = { id: string; name: string; desc: string; action: () => void };

type Props = { isOpen: boolean; onClose: () => void };

export function CommandPalette({ isOpen, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);

  const { t } = useT();

  const world = worlds.find((w) => w.id === activeWorldId);

  // Build commands
  const fireCommand = (text: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent("worldforge-command", { detail: { text } }));
  };
  const commands: Command[] = [
    { id: "stats", name: "/stats", desc: t.commands.stats, action: () => fireCommand("/stats") },
    { id: "desc", name: "/desc", desc: t.commands.desc, action: () => fireCommand("/desc ") },
    { id: "new-entry", name: "/new-entry", desc: t.commands.newEntry, action: () => fireCommand("/new-entry") },
    { id: "new-conv", name: "/new-conv", desc: t.commands.newConv, action: () => fireCommand("/new-conv") },
    { id: "outline", name: "/outline", desc: t.commands.outline, action: () => fireCommand("/outline") },
    { id: "settings", name: "/settings", desc: t.commands.settings, action: () => {
      onClose();
      (window as any).__worldforge?.openSettings?.();
    }},
  ];

  const filtered = query
    ? commands.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase()))
    : commands;

  const selected = filtered[activeIdx];

  const execute = useCallback(() => {
    if (selected) selected.action();
  }, [selected]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIdx(0);
    inputRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter") { execute(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, filtered, execute, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-700">
          <Search className="w-4 h-4 text-ink-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder={t.commands.title}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={cmd.action}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                i === activeIdx ? "bg-surface-800 text-ink" : "text-ink-secondary hover:bg-surface-800/50",
              )}
            >
              <span className="text-sm flex-1">{cmd.name}</span>
              <span className="text-[0.688rem] text-ink-muted">{cmd.desc}</span>
              {i === activeIdx && <ArrowRight className="w-3.5 h-3.5 text-ink-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

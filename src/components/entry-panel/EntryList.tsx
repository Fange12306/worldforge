import { useMemo } from "react";
import { type EntryType, ENTRY_TYPES } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import type { Entry } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

type Props = {
  entries: Entry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function EntryList({ entries, selectedId, onSelect, onDelete }: Props) {
  const { t } = useT();
  const grouped = useMemo(() => {
    const map = new Map<EntryType, Entry[]>();
    for (const t of ENTRY_TYPES) map.set(t, []);
    for (const e of entries) {
      const list = map.get(e.type) || [];
      list.push(e);
      map.set(e.type, list);
    }
    return map;
  }, [entries]);

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-3">
        {ENTRY_TYPES.map((type) => {
          const items = grouped.get(type) || [];
          if (items.length === 0) return null;
          return (
            <div key={type}>
              <div className="text-[0.625rem] font-semibold text-ink-muted uppercase tracking-wider px-2 pb-1">
                {t.entryTypes[type]}
              </div>
              {items.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => onSelect(entry.id)}
                  className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors text-xs",
                    selectedId === entry.id
                      ? "bg-surface-800 text-ink"
                      : "text-ink-secondary hover:bg-surface-850 hover:text-ink",
                  )}
                >
                  <span className="flex-1 truncate">{entry.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-700 text-ink-muted hover:text-error transition-all"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

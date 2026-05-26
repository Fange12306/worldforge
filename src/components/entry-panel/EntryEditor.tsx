import { useState, useEffect } from "react";
import type { Entry } from "@/lib/types";
import { ENTRY_TYPE_LABELS } from "@/lib/constants";
import { Edit3, Save, X, Trash2 } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { ImplicationTrace } from "./ImplicationTrace";
import { EntryTimelineEvents } from "./EntryTimelineEvents";
import { useT } from "@/lib/i18n";

type Props = {
  entry: Entry;
  editing: boolean;
  worldPath?: string;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (entry: Entry) => void;
  onDelete?: () => void;
  onNavigateEntry?: (entryId: string) => void;
  onNavigateToTimeline?: (eventId: string, timelineId: string) => void;
};

export function EntryEditor({ entry, editing, worldPath, onEdit, onCancel, onSave, onDelete, onNavigateEntry, onNavigateToTimeline }: Props) {
  const { t } = useT();
  const [name, setName] = useState(entry.name);
  const [body, setBody] = useState(entry.body || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-confirm]")) setConfirmDelete(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [confirmDelete]);

  const handleSave = () => {
    onSave({ ...entry, name, body });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-10 flex items-center justify-between px-3 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="px-1.5 py-0.5 rounded bg-surface-800">{ENTRY_TYPE_LABELS[entry.type] || entry.type}</span>
          <span className="px-1.5 py-0.5 rounded bg-surface-800/50 text-ink-muted/50 font-mono text-[10px] select-all">{entry.id}</span>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={handleSave} className="p-1 rounded text-success hover:bg-surface-800 transition-colors"><Save className="w-3.5 h-3.5" /></button>
              <button onClick={onCancel} className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </>
          ) : (
            <button onClick={onEdit} className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
          )}
          {onDelete && (confirmDelete ? (
            <button data-confirm onClick={() => { onDelete(); setConfirmDelete(false); }} className="text-[10px] text-error hover:bg-surface-700 px-1.5 py-0.5 rounded ml-1 transition-colors">{t.entry.confirmDelete}</button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="p-1 rounded text-ink-muted hover:text-error hover:bg-surface-800 transition-colors ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {editing ? (
          <div className="space-y-4">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full text-lg font-semibold bg-transparent text-ink border-b border-surface-700 pb-1 outline-none" placeholder={t.entry.namePlaceholder} />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} className="w-full h-64 bg-surface-900 text-sm text-ink rounded-lg p-3 border border-surface-700 resize-none outline-none font-mono" placeholder={t.entry.bodyPlaceholder} />
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold mb-4">{entry.name}</h2>
            {entry.tags?.length > 0 && (
              <div className="flex gap-1 mb-3">
                {entry.tags.map((t: string) => <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-surface-800 text-ink-muted">{t}</span>)}
              </div>
            )}
            <div className="text-sm text-ink-secondary">
              {entry.body ? <MarkdownContent content={entry.body} /> : <span className="text-ink-muted italic">{t.entry.noBody}</span>}
            </div>
            {worldPath && !editing && (
              <EntryTimelineEvents worldPath={worldPath} entryId={entry.id} onNavigateToTimeline={onNavigateToTimeline} onNavigateEntry={onNavigateEntry} />
            )}
            {worldPath && !editing && (
              <ImplicationTrace
                worldPath={worldPath}
                entryId={entry.id}
                entryName={entry.name}
                onNavigate={(type, id) => {
                  if (type === "entry" && onNavigateEntry) onNavigateEntry(id);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

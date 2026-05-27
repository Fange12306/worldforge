import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { invoke } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Pencil, Trash2, RefreshCw, Loader2 } from "lucide-react";

type MemoryEntry = {
  name: string;
  path: string;
  description: string;
};

type MemoryWithWorld = MemoryEntry & {
  worldName: string;
  worldPath: string;
};

export function MemoryManager() {
  const { t } = useT();
  const worlds = useStore((s) => s.worlds);
  const [memories, setMemories] = useState<MemoryWithWorld[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<MemoryWithWorld | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MemoryWithWorld | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // Deduplicate worlds by path to avoid duplicate fetches
      const seen = new Set<string>();
      const unique = worlds.filter((w) => {
        if (seen.has(w.path)) return false;
        seen.add(w.path);
        return true;
      });
      const results = await Promise.all(
        unique.map(async (w) => {
          try {
            const entries = await invoke<MemoryEntry[]>("list_memories", { worldPath: w.path });
            return entries.map((e) => ({ ...e, worldName: w.name, worldPath: w.path }));
          } catch {
            return [] as MemoryWithWorld[];
          }
        })
      );
      if (!cancelled) {
        setMemories(results.flat());
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [worlds]);

  const handleEdit = async (mem: MemoryWithWorld) => {
    setEditing(mem);
    try {
      const content = await invoke<string>("read_memory", { worldPath: mem.worldPath, fileName: mem.path });
      setEditContent(content);
    } catch {
      setEditContent("");
    }
    setEditDescription(mem.description);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await invoke("write_memory", {
        worldPath: editing.worldPath,
        fileName: editing.path,
        content: editContent,
        description: editDescription,
      });
      setEditing(null);
      setEditContent("");
      setEditDescription("");
      // Reload after save
      const entries = await invoke<MemoryEntry[]>("list_memories", { worldPath: editing.worldPath });
      setMemories((prev) => {
        const others = prev.filter((m) => m.worldPath !== editing.worldPath);
        return [...others, ...entries.map((e) => ({ ...e, worldName: editing.worldName, worldPath: editing.worldPath }))];
      });
    } catch (e) {
      alert(`${t.memory.saveFailed}: ${e}`);
    }
    setSaving(false);
  };

  const handleDelete = async (mem: MemoryWithWorld) => {
    try {
      await invoke("delete_memory", { worldPath: mem.worldPath, fileName: mem.path });
      setMemories((prev) => prev.filter((m) => !(m.path === mem.path && m.worldPath === mem.worldPath)));
    } catch (e) {
      alert(`${t.memory.deleteFailed}: ${e}`);
    }
    setDeleting(null);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-medium text-ink">{t.memory.title}</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted" />}
      </div>

      {!loading && memories.length === 0 ? (
        <p className="text-xs text-ink-muted italic">
          {t.memory.empty}
        </p>
      ) : (
        <div className="space-y-0">
          {memories.map((mem) => {
            const isEditing = editing?.path === mem.path && editing?.worldPath === mem.worldPath;
            const isDeleting = deleting?.path === mem.path && deleting?.worldPath === mem.worldPath;
            return (
              <div key={`${mem.worldPath}/${mem.path}`}>
                <div className="flex items-center gap-3 py-2 border-b border-edge/30 last:border-0">
                  {isDeleting ? (
                    <>
                      <span className="text-xs text-error flex-1">{t.memory.confirmDelete}</span>
                      <button
                        onClick={() => handleDelete(mem)}
                        className="px-2 h-6 rounded text-[0.625rem] text-error hover:bg-error-bg transition-colors"
                      >
                        {t.memory.delete}
                      </button>
                      <button
                        onClick={() => setDeleting(null)}
                        className="px-2 h-6 rounded text-[0.625rem] text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                      >
                        {t.memory.cancel}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-ink bg-surface-900 px-1.5 py-0.5 rounded flex-shrink-0 max-w-[160px] truncate">
                        {mem.name}
                      </span>
                      <span className="text-xs text-ink-secondary truncate flex-1 min-w-0">
                        {mem.description}
                      </span>
                      <span className="text-[0.625rem] text-ink-muted bg-surface-800 px-1.5 py-0.5 rounded flex-shrink-0 max-w-[100px] truncate">
                        {mem.worldName}
                      </span>
                      <button
                        onClick={() => handleEdit(mem)}
                        className="h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors flex-shrink-0"
                        title={t.memory.edit}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeleting(mem)}
                        className="h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-error hover:bg-surface-900 transition-colors flex-shrink-0"
                        title={t.memory.deleteTitle}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
                {isEditing && (
                  <div className="py-3 px-1 space-y-2 border-b border-edge/30">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full h-72 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 py-1.5 outline-none focus:border-brand-500/30 transition-colors resize-y"
                      placeholder={t.memory.contentPlaceholder}
                    />
                    <input
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                      placeholder={t.memory.descPlaceholder}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="px-3 h-7 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors disabled:opacity-50"
                      >
                        {saving ? t.memory.saving : t.memory.save}
                      </button>
                      <button
                        onClick={() => { setEditing(null); setEditContent(""); setEditDescription(""); }}
                        className="px-3 h-7 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors"
                      >
                        {t.memory.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

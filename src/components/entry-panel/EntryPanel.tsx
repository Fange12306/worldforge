import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import { ENTRY_TYPES, ENTRY_TYPE_LABELS } from "@/lib/constants";
import { invoke } from "@/lib/api";
import { EntryList } from "./EntryList";
import { EntryEditor } from "./EntryEditor";
import { X, Plus } from "lucide-react";
import type { Entry } from "@/lib/types";
import type { EntryType } from "@/lib/constants";

type Props = { onClose: () => void };

export function EntryPanel({ onClose }: Props) {
  const activeWorldId = useStore((s) => s.activeWorldId);
  const worlds = useStore((s) => s.worlds);
  const world = worlds.find((w) => w.id === activeWorldId);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<EntryType>("character");

  const loadEntries = useCallback(async () => {
    if (!world) return;
    try {
      const result = await invoke<Entry[]>("list_entries", { worldPath: world.path });
      setEntries(Array.isArray(result) ? result : []);
    } catch {
      setEntries([]);
    }
  }, [world]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const [fullEntry, setFullEntry] = useState<Entry | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const selectEntry = useCallback(async (id: string) => {
    setSelectedId(id);
    setShowCreate(false);
    setEditing(false);
    setLoadingId(id);
    if (!world) return;
    try {
      const result = await invoke<Entry>("read_entry", { worldPath: world.path, entryId: id });
      setFullEntry(result);
      setLoadingId(null);
    } catch {
      setFullEntry(null);
      setLoadingId(null);
    }
  }, [world]);

  const handleCreate = async () => {
    if (!newName.trim() || !world) return;
    try {
      await invoke("create_entry", { worldPath: world.path, name: newName.trim(), entryType: newType });
      await loadEntries();
      setShowCreate(false);
      setNewName("");
      setNewType("character");
    } catch (e) {
      alert(`创建失败: ${e}`);
    }
  };

  const handleSave = async (entry: Entry) => {
    try {
      await invoke("update_entry", {
        worldPath: world!.path,
        entryId: entry.id,
        name: entry.name,
        body: entry.body || "",
      });
      await loadEntries();
      setEditing(false);
      // Refresh the full entry display
      if (selectedId) await selectEntry(selectedId);
    } catch (e) {
      alert(`保存失败: ${e}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!world) return;
    try {
      await invoke("delete_entry", { worldPath: world.path, entryId: id });
      if (selectedId === id) setSelectedId(null);
      await loadEntries();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  if (!world) return null;

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-3 flex-shrink-0">
        <span className="text-sm font-semibold text-ink">词条面板</span>
        <div className="flex items-center gap-1">
          <button onClick={() => { setShowCreate(true); setSelectedId(null); }} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors" title="新建词条"><Plus className="w-4 h-4" /></button>
          <button onClick={onClose} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="mx-4 h-px bg-surface-700" />

      {/* Body: list or editor (sidebar is narrow, single column) */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {selectedId || showCreate ? (
          <div className="flex flex-col h-full">
            <button onClick={() => { setSelectedId(null); setShowCreate(false); setEditing(false); }} className="text-[10px] text-ink-muted hover:text-ink px-3 py-1.5 border-b border-surface-700">← 返回列表</button>
            <div className="flex-1 overflow-auto">
              {showCreate ? (
                <CreateEntryForm name={newName} onNameChange={setNewName} type={newType} onTypeChange={setNewType} onCreate={handleCreate} onCancel={() => { setShowCreate(false); setNewName(""); }} />
              ) : fullEntry && !loadingId ? (
                <EntryEditor entry={fullEntry} editing={editing} onEdit={() => setEditing(true)} onCancel={() => setEditing(false)} onSave={handleSave} />
              ) : (
                <div className="h-full flex items-center justify-center text-ink-muted text-xs">加载中...</div>
              )}
            </div>
          </div>
        ) : (
          <EntryList entries={entries} selectedId={selectedId} onSelect={selectEntry} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}

/** Inline form for creating a new entry */
function CreateEntryForm({
  name,
  onNameChange,
  type,
  onTypeChange,
  onCreate,
  onCancel,
}: {
  name: string;
  onNameChange: (v: string) => void;
  type: EntryType;
  onTypeChange: (v: EntryType) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="h-10 flex items-center px-3 flex-shrink-0">
        <span className="text-xs text-ink-secondary">新建词条</span>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <label className="text-xs text-ink-secondary block mb-1">名称</label>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onCreate(); }}
            placeholder="词条名称"
            autoFocus
            className="w-full h-9 rounded-lg bg-surface-900 border border-edge text-sm text-ink px-3 outline-none focus:border-brand-500/30 transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-ink-secondary block mb-1">类型</label>
          <select
            value={type}
            onChange={(e) => onTypeChange(e.target.value as EntryType)}
            className="w-full h-9 rounded-lg bg-surface-900 border border-edge text-sm text-ink px-3 outline-none focus:border-brand-500/30 transition-colors"
          >
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>{ENTRY_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mx-4 h-px bg-surface-700" />
      <div className="h-12 flex items-center justify-end gap-2 px-4 flex-shrink-0">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          取消
        </button>
        <button
          onClick={onCreate}
          disabled={!name.trim()}
          className="px-4 py-1.5 text-xs rounded-lg bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40 transition-colors"
        >
          创建
        </button>
      </div>
    </div>
  );
}

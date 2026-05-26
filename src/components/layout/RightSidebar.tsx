import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import { invoke } from "@/lib/api";
import { PanelRightClose, Plus, BookOpen, FileText, FolderOpen, ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Entry, ChapterInfo } from "@/lib/types";

type Tab = "entries" | "outline" | "resources";

type Props = {
  onSelectEntry: (entry: Entry) => void;
  onSelectOutlineChapter: (chapter: ChapterInfo) => void;
  onSelectFile?: (fileName: string) => void;
  onSelectMemory?: (fileName: string) => void;
  onClose: () => void;
};

export function RightSidebar({ onSelectEntry, onSelectOutlineChapter, onSelectFile, onSelectMemory, onClose, onCloseSidebar, refreshKey }: Props & { onCloseSidebar: () => void; refreshKey?: number }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("entries");
  const [entries, setEntries] = useState<Entry[]>([]);
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const world = worlds.find((w) => w.id === activeWorldId);

  const loadEntries = useCallback(async () => {
    if (!world) return;
    try {
      const result = await invoke<Entry[]>("list_entries", { worldPath: world.path });
      setEntries(Array.isArray(result) ? result : []);
    } catch { setEntries([]); }
  }, [world]);

  useEffect(() => { loadEntries(); }, [loadEntries, refreshKey]);

  // Clear when world is closed
  useEffect(() => {
    if (!world) setEntries([]);
  }, [world]);

  return (
    <div className="flex flex-col h-full bg-surface-900 select-none">
      {/* Tab bar */}
      <div className="h-12 flex items-center gap-0.5 px-3 border-b border-surface-700">
        <button
          onClick={() => setTab("entries")}
          className={`flex-1 h-8 flex items-center justify-center gap-1 rounded-lg text-[11px] transition-colors ${tab === "entries" ? "bg-surface-700 text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          <BookOpen className="w-3 h-3" /> {t.labels.entry}
        </button>
        <button
          onClick={() => setTab("outline")}
          className={`flex-1 h-8 flex items-center justify-center gap-1 rounded-lg text-[11px] transition-colors ${tab === "outline" ? "bg-surface-700 text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          <FileText className="w-3 h-3" /> {t.entry.outline}
        </button>
        <button
          onClick={() => setTab("resources")}
          className={`flex-1 h-8 flex items-center justify-center gap-1 rounded-lg text-[11px] transition-colors ${tab === "resources" ? "bg-surface-700 text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          <FolderOpen className="w-3 h-3" /> {t.entry.resources}
        </button>
        <button onClick={onCloseSidebar} className="flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors flex-shrink-0 ml-1">
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "entries" && <EntriesTab entries={entries} onSelect={onSelectEntry} onRefresh={loadEntries} worldPath={world?.path || ""} />}
        {tab === "outline" && <OutlineTab worldPath={world?.path || ""} storyId={world?.stories.find((s) => s.conversations.some((c) => c.id === activeConversationId))?.id || ""} refreshKey={refreshKey} onClick={onSelectOutlineChapter} />}
        {tab === "resources" && <ResourcesTab worldPath={world?.path || ""} conversationId={activeConversationId || ""} onSelectFile={onSelectFile} onSelectMemory={onSelectMemory} />}
      </div>
    </div>
  );
}

function EntriesTab({ entries, onSelect, onRefresh, worldPath }: { entries: Entry[]; onSelect: (e: Entry) => void; onRefresh: () => void; worldPath: string }) {
  const { t } = useT();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("character");
  const [showNew, setShowNew] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await invoke("create_entry", { worldPath, name: newName.trim(), entryType: newType });
      onRefresh();
      setNewName("");
      setNewType("character");
      setShowNew(false);
    } catch {}
  };

  const grouped: Record<string, Entry[]> = {};
  for (const e of entries) {
    if (!grouped[e.type]) grouped[e.type] = [];
    grouped[e.type].push(e);
  }

  return (
    <div className="p-2">
      {worldPath && !showNew && (
        <button onClick={() => setShowNew(true)} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-ink-muted hover:text-ink hover:bg-surface-800 rounded-lg transition-colors mb-2">
          <Plus className="w-3 h-3" /> {t.entry.newEntry}
        </button>
      )}
      {showNew && (
        <div className="px-2 pb-2 space-y-1.5">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} placeholder={t.entry.name} autoFocus className="w-full h-7 text-[11px] bg-surface-800 rounded px-2 text-ink outline-none" />
          <select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full h-7 text-[11px] bg-surface-800 rounded px-2 text-ink outline-none">
            {Object.entries(t.entryTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex gap-1">
            <button onClick={handleCreate} disabled={!newName.trim()} className="flex-1 h-7 text-[11px] rounded bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40 transition-colors">{t.status.confirm}</button>
            <button onClick={() => { setShowNew(false); setNewName(""); }} className="flex-1 h-7 text-[11px] rounded bg-surface-700 text-ink-muted hover:text-ink transition-colors">{t.status.cancel}</button>
          </div>
        </div>
      )}
      {Object.entries(grouped).map(([type, items]) => {
        const isCollapsed = collapsed.has(type);
        return (
          <div key={type} className="mb-1">
            <button
              onClick={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; })}
              className="w-full flex items-center gap-1 px-2 py-0.5 text-[10px] text-ink-muted uppercase tracking-wider hover:text-ink transition-colors"
            >
              {isCollapsed ? <ChevronRight className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
              <span>{t.entryTypes[type as keyof typeof t.entryTypes] || type}</span>
              <span className="text-ink-muted/50 ml-auto">{items.length}</span>
            </button>
            {!isCollapsed && items.map((e) => (
              <button key={e.id} onClick={() => onSelect(e)} className="w-full text-left px-2 pl-6 py-1 text-[11px] text-ink-secondary hover:text-ink hover:bg-surface-800 rounded transition-colors truncate">
                {e.name}
              </button>
            ))}
          </div>
        );
      })}
      {entries.length === 0 && <p className="text-[11px] text-ink-muted text-center py-4">{t.entry.empty}</p>}
    </div>
  );
}

function OutlineTab({ worldPath, storyId, refreshKey, onClick }: { worldPath: string; storyId: string; refreshKey?: number; onClick: (chapter: ChapterInfo) => void }) {
  const { t } = useT();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  useEffect(() => {
    invoke<ChapterInfo[]>("read_outline", { worldPath, storyId })
      .then(setChapters).catch(() => setChapters([]));
  }, [worldPath, storyId, refreshKey]);

  const statusIcon = (s: string) => s === "done" ? "✓" : s === "drafting" ? "✎" : "○";
  const statusColor = (s: string) => s === "done" ? "text-success" : s === "drafting" ? "text-brand-400" : "text-ink-muted";

  return (
    <div className="p-2">
      {chapters.length > 0 ? (
        chapters.map((ch) => (
            <button key={ch.id} onClick={() => onClick(ch)} className="w-full text-left text-[11px] text-ink-secondary hover:text-ink hover:bg-surface-800 rounded px-2 py-1 transition-colors">
            <span className={statusColor(ch.status)}>{statusIcon(ch.status)}</span>{" "}
            <span>Ch{ch.order} {ch.title}</span>
            {ch.word_count > 0 && <span className="text-ink-muted ml-1">({ch.word_count}{t.common.words})</span>}
          </button>
        ))
      ) : (
        <p className="text-[11px] text-ink-muted text-center py-4">{t.entry.noOutline}</p>
      )}
    </div>
  );
}

function ResourcesTab({ worldPath, conversationId, onSelectFile, onSelectMemory }: { worldPath: string; conversationId: string; onSelectFile?: (fileName: string) => void; onSelectMemory?: (fileName: string) => void }) {
  const { t } = useT();
  const [files, setFiles] = useState<string[]>([]);
  const [memories, setMemories] = useState<Array<{ name: string; path: string; description: string }>>([]);
  const [showFiles, setShowFiles] = useState(true);
  const [showMemories, setShowMemories] = useState(true);

  // Load uploaded files for this conversation — reset on switch
  useEffect(() => {
    setFiles([]);
    if (!worldPath || !conversationId) return;
    let cancelled = false;
    invoke<string[]>("list_files", { worldPath, subdir: `uploads/${conversationId}` })
      .then((r) => { if (!cancelled) setFiles(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [worldPath, conversationId]);

  // Load world memories
  useEffect(() => {
    if (!worldPath) return;
    invoke<Array<{ name: string; path: string; description: string }>>("list_memories", { worldPath })
      .then((r) => setMemories(Array.isArray(r) ? r : []))
      .catch(() => setMemories([]));
  }, [worldPath]);

  return (
    <div className="p-2 space-y-1">
      {/* Uploaded files */}
      <button
        onClick={() => setShowFiles(!showFiles)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] text-ink-muted hover:text-ink hover:bg-surface-800 rounded-lg transition-colors"
      >
        {showFiles ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium">{t.chat.files}</span>
      </button>
      {showFiles && (
        <div className="ml-4 space-y-0.5">
          {files.length > 0 ? (
            files.map((f) => (
              <button
                key={f}
                onClick={() => onSelectFile?.(f)}
                className="w-full text-left flex items-center gap-1.5 px-2 py-1 text-[11px] text-ink-secondary hover:text-ink hover:bg-surface-800 rounded transition-colors"
              >
                <FileText className="w-3 h-3 text-ink-muted/50 flex-shrink-0" />
                <span className="truncate">{f}</span>
              </button>
            ))
          ) : (
            <p className="text-[10px] text-ink-muted px-2 py-1">{t.chat.noFiles}</p>
          )}
        </div>
      )}

      {/* Memories */}
      <button
        onClick={() => setShowMemories(!showMemories)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] text-ink-muted hover:text-ink hover:bg-surface-800 rounded-lg transition-colors"
      >
        {showMemories ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium">{t.chat.worldMemory}</span>
      </button>
      {showMemories && (
        <div className="ml-4 space-y-0.5">
          {memories.length > 0 ? (
            memories.map((m) => (
              <button
                key={m.path}
                onClick={() => onSelectMemory?.(m.path)}
                className="w-full text-left px-2 py-1 text-[11px] text-ink-secondary hover:text-ink hover:bg-surface-800 rounded transition-colors truncate"
              >
                {m.name}
              </button>
            ))
          ) : (
            <p className="text-[10px] text-ink-muted px-2 py-1">{t.chat.noMemory}</p>
          )}
        </div>
      )}
    </div>
  );
}

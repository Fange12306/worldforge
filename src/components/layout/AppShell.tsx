import { useEffect, useState, Component, ReactNode } from "react";
import { useStore, type ModelConfig } from "@/lib/store";
import { applyTheme } from "@/lib/theme";
import { initWorld, invoke } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { useT } from "@/lib/i18n";

class ErrorBoundary extends Component<{ children: ReactNode; renderError: string; retry: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-sm">
          <p className="text-red-500 font-medium">{this.props.renderError}</p>
          <p className="text-ink-muted text-xs max-w-md text-center">{this.state.error}</p>
          <button className="px-3 py-1 mt-2 bg-surface-800 rounded text-xs hover:bg-surface-700"
            onClick={() => this.setState({ error: null })}>{this.props.retry}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { SidebarToggle } from "./SidebarToggle";
import { RightSidebar } from "./RightSidebar";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { EntryEditor } from "@/components/entry-panel/EntryEditor";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { ConsistencyReport } from "@/components/chat/ConsistencyReport";
import { TimelinePanel } from "@/components/timeline/TimelinePanel";
import { PanelLeftOpen, PanelRightOpen, Save, X, Edit3, Trash2, Clock, Hash, ChevronDown, ChevronRight } from "lucide-react";
import type { Entry, ChapterInfo } from "@/lib/types";

type CenterView = null | { type: "entry"; entry: Entry; editing: boolean } | { type: "outline"; chapterOrder: number; chapterId?: string; title: string; content: string; editing: boolean } | { type: "file"; fileName: string; content: string } | { type: "memory"; fileName: string; content: string } | { type: "timeline"; initialEventId?: string; initialTimelineId?: string };

export function AppShell() {
  const { t } = useT();
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const theme = useStore((s) => s.theme);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [rightOpen, setRightOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [centerView, setCenterView] = useState<CenterView>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Close center view when world is closed
  useEffect(() => {
    if (!activeWorldId) setCenterView(null);
  }, [activeWorldId]);

  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener("worldforge-data-changed", handler);
    // Clear last session on quit so reopen always starts fresh
    const unloadHandler = () => {
      invoke("save_last_session", { worldPath: "", storyId: "", conversationId: "" }).catch(() => {});
    };
    window.addEventListener("beforeunload", unloadHandler);
    return () => {
      window.removeEventListener("worldforge-data-changed", handler);
      window.removeEventListener("beforeunload", unloadHandler);
    };
  }, []);

  useEffect(() => {
    (window as any).__worldforge = { openSettings: () => setSettingsOpen(true), openPalette: () => setPaletteOpen(true), openTimeline: () => setCenterView({ type: "timeline" }) };
    invoke<{ provider: string; models: ModelConfig[]; activeModel?: string }>("load_config").then((cfg) => {
      if (cfg.provider) useStore.getState().setLlmProvider(cfg.provider);
      if (cfg.models?.length) {
        useStore.getState().setLlmModels(cfg.models);
        const saved = cfg.activeModel;
        const valid = saved && cfg.models.some((m) => m.name === saved);
        useStore.getState().setActiveModel(valid ? saved! : cfg.models[0].name);
      }
    }).catch(() => {});
    invoke<string>("load_language").then((lang) => {
      if (lang === "en" || lang === "zh") useStore.getState().setLanguage(lang);
    }).catch(() => {});
    // Apply persisted font size
    const stored = (() => { try { return localStorage.getItem("worldforge-font-size") as "sm" | "md" | "lg" | null; } catch { return null; } })();
    if (stored) useStore.getState().setFontSize(stored);
  }, []);

  // Restore last session on startup (no demo-world fallback)
  useEffect(() => {
    if (worlds.length > 0) return;

    const loadWorld = async (worldPath: string) => {
      const s = useStore.getState();
      let name = worldPath.split(/[/\\]/).pop() || t.layout.unnamedWorld;
      try {
        const meta = await invoke<{ name: string }>("open_world", { path: worldPath });
        if (meta.name) name = meta.name;
      } catch {}
      const wid = s.openWorld(name, worldPath);

      try {
        const stories = await invoke<Array<{ id: string; title: string; status: string; conversations: Array<{ id: string; title: string }> }>>("load_stories", { worldPath });
        if (stories.length > 0) {
          const convId = s.hydrateStories(wid, stories);
          for (const st of stories) {
            for (const c of (st.conversations || [])) {
              try {
                const tokens = await invoke<number>("load_session_tokens", { worldPath, sessionId: c.id });
                const stateJson = await invoke<string>("load_session_state", { worldPath, sessionId: c.id });
                const stateData = JSON.parse(stateJson);
                if (tokens > 0 || stateData.contextUsed > 0) {
                  useStore.setState((prev) => ({
                    worlds: prev.worlds.map((ww) => ww.id === wid ? {
                      ...ww, stories: ww.stories.map((ss) => ss.id === st.id ? {
                        ...ss, conversations: ss.conversations.map((cc) => cc.id === c.id ? {
                          ...cc,
                          ...(tokens > 0 ? { totalTokens: tokens } : {}),
                          contextUsed: stateData.contextUsed ?? 0,
                          contextBreakdown: stateData.contextBreakdown ?? null,
                        } : cc),
                      } : ss),
                    } : ww),
                  }));
                }
              } catch {}
            }
          }
          if (convId) {
            try {
              const msgs = await invoke<Array<{ type: string; content: string; thinking?: string; tool?: string; input?: unknown; output?: string }>>("load_session", { worldPath, sessionId: convId });
              type SM = { id: string; role: "user" | "assistant" | "system"; content: string; thinking?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown>; result: string }>; timestamp: number };
              const result: SM[] = [];
              let pending: Array<{ id: string; name: string; input: Record<string, unknown>; result: string }> = [];
              let lastAssistantIdx: number | null = null;
              for (const m of msgs) {
                if (m.type === "user") { result.push({ id: `msg_${result.length}`, role: "user", content: m.content, timestamp: Date.now() }); pending = []; lastAssistantIdx = null; }
                else if (m.type === "assistant") {
                  result.push({ id: `msg_${result.length}`, role: "assistant", content: m.content, thinking: m.thinking, toolCalls: pending.length > 0 ? [...pending] : undefined, timestamp: Date.now() });
                  lastAssistantIdx = result.length - 1;
                  pending = [];
                }
                else if (m.type === "system") result.push({ id: `msg_${result.length}`, role: "system", content: m.content, timestamp: Date.now() });
                else if (m.type === "tool_use") pending.push({ id: `tc_${pending.length}`, name: m.tool || "", input: (m.input as Record<string, unknown>) || {}, result: "" });
                else if (m.type === "tool_result") {
                  const output = (m.output as string) || "";
                  const last = pending[pending.length - 1];
                  if (last) { last.result = output; }
                  else if (lastAssistantIdx !== null) {
                    const lastMsg = result[lastAssistantIdx];
                    if (lastMsg?.toolCalls) {
                      for (const tc of lastMsg.toolCalls) { if (!tc.result) { tc.result = output; break; } }
                    }
                  }
                  result.push({ id: `msg_${result.length}`, role: "system", content: `[工具结果: ${m.tool || "tool"}]\n${output}`, timestamp: Date.now() });
                }
              }
              if (result.length > 0) {
                useStore.setState((prev) => ({
                  worlds: prev.worlds.map((ww) => ww.id === wid ? {
                    ...ww, stories: ww.stories.map((ss) => ss.id === stories[0].id ? {
                      ...ss, conversations: ss.conversations.map((cc) => cc.id === convId ? { ...cc, messages: result } : cc),
                    } : ss),
                  } : ww),
                }));
              }
            } catch {}
          }
        }
      } catch {}
    };

    invoke<{ world_path: string; story_id: string; conversation_id: string } | null>("load_last_session")
      .then((last) => {
        if (last?.world_path) loadWorld(last.world_path);
      })
      .catch(() => {});
  }, []);

  // Save last session on navigation changes
  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  useEffect(() => {
    if (!activeWorld || !activeConversationId) {
      // Clear last session when world is closed
      invoke("save_last_session", {
        worldPath: "", storyId: "", conversationId: "",
      }).catch(() => {});
      return;
    }
    const story = activeWorld.stories.find((s) =>
      s.conversations.some((c) => c.id === activeConversationId)
    );
    if (story) {
      invoke("save_last_session", {
        worldPath: activeWorld.path,
        storyId: story.id,
        conversationId: activeConversationId,
      }).catch(() => {});
    }
  }, [activeWorld?.id, activeConversationId]);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="relative flex h-screen bg-surface-950 text-surface-100 overflow-hidden p-2 gap-2">
      <div className={`h-full flex-shrink-0 rounded-2xl bg-surface-900 overflow-hidden transition-all ${sidebarOpen ? "w-60" : "w-0"}`}>
        <Sidebar />
      </div>
      <div className="flex flex-col flex-1 min-w-0 rounded-2xl bg-surface-900 overflow-hidden">
        <Header />
        <ErrorBoundary renderError={t.layout.renderError} retry={t.layout.retry}>
          {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : centerView ? (
            <DetailView view={centerView} onBack={() => { setCenterView(null); setRefreshKey(k => k + 1); }} onUpdate={(v) => { setCenterView(v); setRefreshKey(k => k + 1); }} activeWorldId={activeWorldId} activeConversationId={activeConversationId} worlds={worlds} sidebarOpen={sidebarOpen} rightOpen={rightOpen} theme={theme} />
          ) : <ChatLayout />}
        </ErrorBoundary>
        <StatusBar />
      </div>
      <div className={`h-full flex-shrink-0 rounded-2xl bg-surface-900 overflow-hidden transition-all ${rightOpen ? "w-60" : "w-0"}`}>
        <RightSidebar onCloseSidebar={() => setRightOpen(false)} refreshKey={refreshKey}
          onSelectOutlineChapter={async (chapter: ChapterInfo) => { try { const w = worlds.find((x) => x.id === activeWorldId); if (!w) return; const story = w.stories.find((s) => s.conversations.some((c) => c.id === activeConversationId)); if (!story) return; const content = await invoke<string>("read_chapter", { worldPath: w.path, storyId: story.id, chapterId: chapter.id }); setCenterView({ type: "outline", chapterOrder: chapter.order, chapterId: chapter.id, title: chapter.title || `第${chapter.order}章`, content, editing: false }); } catch {} }}
          onSelectEntry={async (e) => { try { const w = worlds.find((x) => x.id === activeWorldId); const full = w ? await invoke<Entry>("read_entry", { worldPath: w.path, entryId: e.id }) : e; setCenterView({ type: "entry", entry: full, editing: false }); } catch { setCenterView({ type: "entry", entry: e, editing: false }); } }}
          onSelectFile={async (fileName) => { try { const w = worlds.find((x) => x.id === activeWorldId); if (w) { const content = await invoke<string>("read_file", { worldPath: w.path, filePath: `uploads/${activeConversationId}/${fileName}` }); setCenterView({ type: "file", fileName, content }); } } catch {} }}
          onSelectMemory={async (fileName) => { try { const w = worlds.find((x) => x.id === activeWorldId); if (w) { const content = await invoke<string>("read_memory", { worldPath: w.path, fileName }); setCenterView({ type: "memory", fileName, content }); } } catch {} }}
          onClose={() => setRightOpen(false)}
        />
      </div>
      {!sidebarOpen && <button onClick={() => useStore.getState().toggleSidebar()} className="absolute left-[20px] top-[52px] z-10 w-7 h-7 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><PanelLeftOpen className="w-4 h-4" /></button>}
      {!rightOpen && <button onClick={() => setRightOpen(true)} className="absolute right-4 top-[52px] z-10 w-7 h-7 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><PanelRightOpen className="w-4 h-4" /></button>}
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ConsistencyReport />
    </div>
  );
}

function DetailView({ view, onBack, onUpdate, activeWorldId, activeConversationId, worlds, sidebarOpen, rightOpen, theme }: {
  view: NonNullable<CenterView>; onBack: () => void; onUpdate: (v: CenterView) => void;
  activeWorldId: string | null; activeConversationId: string | null; worlds: ReturnType<typeof useStore.getState>["worlds"];
  sidebarOpen: boolean; rightOpen: boolean; theme: "dark" | "light";
}) {
  const { t } = useT();
  if (view.type === "timeline") {
    const w = worlds.find((x) => x.id === activeWorldId);
    if (!w) return null;
    return (
      <TimelinePanel
        worldPath={w.path}
        onClose={onBack}
        sidebarOpen={sidebarOpen}
        rightOpen={rightOpen}
        initialEventId={view.type === "timeline" ? view.initialEventId : undefined}
        initialTimelineId={view.type === "timeline" ? view.initialTimelineId : undefined}
        onNavigateEntry={async (entryId) => {
          try {
            const full = await invoke<Entry>("read_entry", { worldPath: w.path, entryId });
            onUpdate({ type: "entry", entry: full, editing: false });
          } catch { }
        }}
        onNavigateOutline={async (storyId, order) => {
          try {
            const chapters = await invoke<Array<{ id: string; order: number; title: string }>>("read_outline", { worldPath: w.path, storyId });
            const ch = chapters.find((c) => c.order === order);
            if (!ch) return;
            const content = await invoke<string>("read_chapter", { worldPath: w.path, storyId, chapterId: ch.id });
            onUpdate({ type: "outline", chapterOrder: order, chapterId: ch.id, title: ch.title || `第${order}章`, content, editing: false });
          } catch { }
        }}
      />
    );
  }

  const name = view.type === "entry" ? view.entry.name
    : view.type === "outline" ? view.title
    : view.type === "file" ? view.fileName
    : view.type === "memory" ? view.fileName : "";
  const label = view.type === "entry" ? t.labels.entry : view.type === "outline" ? t.labels.outline : view.type === "file" ? t.labels.file : t.labels.memory;
  const proseClass = `prose prose-sm max-w-none ${theme === "dark" ? "prose-invert" : ""}`;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 border-b border-surface-700 flex-shrink-0" style={{ height: 40, paddingLeft: !sidebarOpen ? 48 : 12 }}>
        <button onClick={onBack} className="text-[0.688rem] text-ink-muted hover:text-ink h-full flex items-center flex-shrink-0">{t.entry.backToChat}</button>
        <span className="text-[0.625rem] text-ink-muted/50">{label}</span>
        <span className="text-[0.688rem] text-ink-secondary truncate flex-1">{name}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {view.type === "entry" ? (
          <EntryEditor entry={view.entry} editing={view.editing} worldPath={worlds.find(w => w.id === activeWorldId)?.path || ""} onEdit={() => onUpdate({ ...view, editing: true })} onCancel={() => onUpdate({ ...view, editing: false })} onSave={async (e: Entry) => { try { const w = worlds.find((x) => x.id === activeWorldId); if (w) { const result = await invoke<Entry>("update_entry", { worldPath: w.path, entryId: e.id, name: e.name, body: e.body || "" }); onUpdate({ type: "entry", entry: result, editing: false }); } } catch {} }} onDelete={async () => { const w = worlds.find((x) => x.id === activeWorldId); if (w) { await invoke("delete_entry", { worldPath: w.path, entryId: view.entry.id }); onBack(); } }}
            onNavigateEntry={async (entryId) => { try { const w = worlds.find((x) => x.id === activeWorldId); if (w) { const full = await invoke<Entry>("read_entry", { worldPath: w.path, entryId }); onUpdate({ type: "entry", entry: full, editing: false }); } } catch {} }}
            onNavigateToTimeline={(eventId, timelineId) => onUpdate({ type: "timeline", initialEventId: eventId, initialTimelineId: timelineId })}
          />
        ) : view.type === "outline" ? (
          <OutlineDetail chapterOrder={view.chapterOrder} chapterId={view.chapterId} title={view.title} content={view.content} editing={view.editing} theme={theme} worldPath={worlds.find((w) => w.id === activeWorldId)?.path} onEdit={() => onUpdate({ ...view, editing: true })} onCancel={() => onUpdate({ ...view, editing: false })} onSave={async (title: string, body: string) => { const w = worlds.find((x) => x.id === activeWorldId); const s = w?.stories.find((x) => x.conversations.some((y) => y.id === activeConversationId)); if (w && s && view.chapterId) await invoke("write_outline", { worldPath: w.path, storyId: s.id, chapterId: view.chapterId, title, body }); onUpdate({ ...view, title, content: body, editing: false }); }} onDelete={async () => { const w = worlds.find((x) => x.id === activeWorldId); const s = w?.stories.find((x) => x.conversations.some((y) => y.id === activeConversationId)); if (w && s && view.chapterId) await invoke("delete_chapter", { worldPath: w.path, storyId: s.id, chapterId: view.chapterId }); onBack(); }} onNavigateEntry={async (entryId) => { try { const w = worlds.find((x) => x.id === activeWorldId); if (w) { const full = await invoke<Entry>("read_entry", { worldPath: w.path, entryId }); onUpdate({ type: "entry", entry: full, editing: false }); } } catch {} }} onNavigateToTimeline={(eventId, timelineId) => onUpdate({ type: "timeline", initialEventId: eventId, initialTimelineId: timelineId })} />
        ) : (
          <div className={`p-4 ${proseClass}`}>
            <div className="text-xs text-ink-muted mb-3">
              {view.type === "file" ? t.entry.fileContent : t.entry.memoryContent}
            </div>
            <MarkdownContent content={view.content} />
          </div>
        )}
      </div>
    </div>
  );
}

function OutlineDetail({ chapterOrder, chapterId, title, content, editing, onEdit, onCancel, onSave, onDelete, worldPath, theme, onNavigateEntry, onNavigateToTimeline }: {
  chapterOrder: number; chapterId?: string; title: string; content: string; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: (title: string, body: string) => void;
  onDelete?: () => void; worldPath?: string; theme: "dark" | "light";
  onNavigateEntry?: (entryId: string) => void;
  onNavigateToTimeline?: (eventId: string, timelineId: string) => void;
}) {
  const { t } = useT();
  const displayBody = content.startsWith("---") ? content.replace(/^---[\s\S]*?---\r?\n?/, "") : content;
  const [editTitle, setEditTitle] = useState(title);
  const [text, setText] = useState(displayBody);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(true);
  useEffect(() => { setEditTitle(title); setText(displayBody); }, [title, content]);
  // Load event summaries and timeline IDs for linked_events
  const [eventInfos, setEventInfos] = useState<Record<string, {summary: string; timelineId: string}>>({});
  const [entryNames, setEntryNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!worldPath) return;
    const loadAll = async () => {
      const infos: Record<string, {summary: string; timelineId: string}> = {};
      const eNames: Record<string, string> = {};
      try {
        const [timelines, entries] = await Promise.all([
          invoke<Array<{id: string}>>("list_timelines", { worldPath }),
          invoke<Array<{id: string; name: string}>>("list_entries", { worldPath }),
        ]);
        if (Array.isArray(entries)) {
          for (const e of entries) eNames[e.id] = e.name;
        }
        for (const tl of timelines) {
          try {
            const events = await invoke<Array<{id: string; summary: string}>>("list_events", { worldPath, timelineId: tl.id });
            for (const ev of events) {
              infos[ev.id] = { summary: ev.summary, timelineId: tl.id };
            }
          } catch {}
        }
      } catch {}
      setEventInfos(infos);
      setEntryNames(eNames);
    };
    loadAll();
  }, [worldPath]);

  // Click-away reset
  useEffect(() => {
    if (!confirmDelete) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-confirm]")) setConfirmDelete(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [confirmDelete]);
  const proseClass = `prose prose-sm max-w-none ${theme === "dark" ? "prose-invert" : ""}`;
  // Parse frontmatter for time_period, involved_entries, and linked_events
  let fmTimePeriod: [number, number] | null = null;
  let fmInvolved: string[] = [];
  let fmLinkedEvents: string[] = [];
  if (content.startsWith("---")) {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const tpMatch = fm.match(/time_period:\s*"?(\d+)\s*,\s*(\d+)"?/);
      if (tpMatch) fmTimePeriod = [parseInt(tpMatch[1]), parseInt(tpMatch[2])];
      const ieMatch = fm.match(/involved_entries:\s*\[([\s\S]*?)\]/);
      if (ieMatch) {
        fmInvolved = ieMatch[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
      }
      const leMatch = fm.match(/linked_events:\s*\[([\s\S]*?)\]/);
      if (leMatch) {
        fmLinkedEvents = leMatch[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
      }
    }
  }
  return (
    <div className="h-full flex flex-col">
      <div className="h-10 flex items-center justify-between px-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">Ch{chapterOrder}</span>
          <span className="text-xs text-ink-secondary font-medium truncate max-w-[200px]">{title}</span>
          {chapterId && <span className="px-1.5 py-0.5 rounded bg-surface-800/50 text-ink-muted/50 font-mono text-[0.625rem] select-all">{chapterId}</span>}
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={() => onSave(editTitle, text)} className="p-1 rounded text-success hover:bg-surface-800 transition-colors"><Save className="w-3.5 h-3.5" /></button>
              <button onClick={onCancel} className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><X className="w-3.5 h-3.5" /></button>
            </>
          ) : (
            <button onClick={onEdit} className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
          )}
          {onDelete && (confirmDelete ? (
            <button data-confirm onClick={() => { onDelete(); setConfirmDelete(false); }} className="text-[0.625rem] text-error hover:bg-surface-700 px-1.5 py-0.5 rounded ml-1 transition-colors">{t.status.confirm}</button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="p-1 rounded text-ink-muted hover:text-error hover:bg-surface-800 transition-colors ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {editing ? (
          <div className="flex flex-col h-full">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder={t.entry.chapterTitle} className="w-full h-9 text-sm bg-surface-900 text-ink px-4 border-b border-surface-700 outline-none flex-shrink-0" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} className="flex-1 w-full bg-surface-900 text-sm text-ink p-4 resize-none outline-none font-mono" />
          </div>
        ) : (
          <div className={`p-4 ${proseClass}`}>
            <h2 className="text-sm font-bold text-ink mb-2">{title}</h2>
            <MarkdownContent content={displayBody} />
            {(fmTimePeriod || fmInvolved.length > 0 || fmLinkedEvents.length > 0) && (
              <div className="mt-6 pt-4 border-t border-surface-700/50">
                <button
                  onClick={() => setMetaExpanded(!metaExpanded)}
                  className="flex items-center gap-1.5 px-1 py-1 w-full text-left"
                >
                  {metaExpanded ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
                  <Clock className="w-3 h-3 text-ink-muted" />
                  <span className="text-[0.688rem] text-ink-muted font-medium">{t.entry.chapterInfo}</span>
                </button>
                {metaExpanded && (
                  <div className="mt-2 pl-4 space-y-2">
                    {fmTimePeriod && (
                      <div>
                        <p className="text-[0.625rem] text-ink-muted/50 uppercase tracking-wider mb-1">{t.entry.timePoint}</p>
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-[0.688rem] rounded bg-surface-800 text-ink-secondary">
                          {fmTimePeriod[0]} → {fmTimePeriod[1]}
                        </span>
                      </div>
                    )}
                    {fmInvolved.length > 0 && (
                      <div>
                        <p className="text-[0.625rem] text-ink-muted/50 uppercase tracking-wider mb-1">{t.entry.involvedEntries}</p>
                        <div className="flex flex-wrap gap-1">
                          {fmInvolved.map((e) => (
                            <button key={e} onClick={() => onNavigateEntry?.(e)} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[0.625rem] rounded bg-surface-800/50 text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors">
                              {entryNames[e] || e.slice(0, 8)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {fmLinkedEvents.length > 0 && (
                      <div>
                        <p className="text-[0.625rem] text-ink-muted/50 uppercase tracking-wider mb-1">{t.entry.linkedEvents}</p>
                        <div className="flex flex-col gap-1">
                          {fmLinkedEvents.map((le) => {
                            const parts = le.split(":");
                            const eventId = parts.length >= 2 ? parts[1] : le;
                            const info = eventInfos[eventId];
                            const summary = info?.summary;
                            return (
                              <button key={le} onClick={() => { if (info) onNavigateToTimeline?.(eventId, info.timelineId); }} className="inline-flex items-start gap-1.5 px-2 py-1 text-[0.625rem] rounded bg-amber-600/10 text-amber-500 hover:bg-amber-600/20 transition-colors text-left">
                                <span className="mt-0.5 flex-shrink-0">🕐</span>
                                <span className="leading-snug">{summary || eventId}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {fmLinkedEvents.length === 0 && (
                      <div>
                        <p className="text-[0.625rem] text-ink-muted/50 uppercase tracking-wider mb-1">{t.entry.linkedEvents}</p>
                        <p className="text-[0.625rem] text-amber-500/60 italic">{t.entry.noLinkedEvents}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import {
  Plus,
  Trash2,
  Settings,
  Globe,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FilePlus,
  Clock,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarToggle } from "./SidebarToggle";
import { initWorld, invoke } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { WorldForgeLogo } from "@/components/brand/WorldForgeLogo";

export function Sidebar() {
  const { t } = useT();
  const {
    worlds,
    activeWorldId,
    activeConversationId,
    openWorld,
    closeWorld,
    setActiveWorld,
    addStory,
    renameWorld,
    renameStory,
    renameConversation,
    deleteStory,
    createConversation,
    deleteConversation,
    setActiveConversation,
  } = useStore();

  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const [editing, setEditing] = useState<{ type: "world" | "story" | "conv"; id: string; value: string } | null>(null);
  const [creatingStory, setCreatingStory] = useState(false);
  const [creatingWorld, setCreatingWorld] = useState(false);
  const [openingWorld, setOpeningWorld] = useState(false);
  const [scanningWorlds, setScanningWorlds] = useState(false);
  const [newWorldName, setNewWorldName] = useState("");
  const [worldList, setWorldList] = useState<{ name: string; path: string; description: string }[]>([]);
  const [confirmDeleteWorld, setConfirmDeleteWorld] = useState(false);

  // Click-away resets delete confirmation
  useEffect(() => {
    if (!confirmDeleteWorld) return;
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-confirm]")) setConfirmDeleteWorld(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [confirmDeleteWorld]);

  // ── State A: No world open ──
  if (!activeWorld) {
    return (
      <div className="flex flex-col h-full bg-surface-900 select-none">
        <div className="h-12 flex items-center gap-2.5 px-3 flex-shrink-0">
          <WorldForgeLogo className="w-8 h-8 flex-shrink-0" />
          <span className="font-semibold text-sm tracking-tight flex-1">WorldForge</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8">
          <Globe className="w-10 h-10 text-ink-muted opacity-40" />
          <p className="text-xs text-ink-muted text-center">
            {t.sidebar.openWorldPrompt}
          </p>
          <div className="w-full space-y-2">
            {creatingWorld ? (
              <input
                autoFocus
                value={newWorldName}
                onChange={(e) => setNewWorldName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newWorldName.trim()) {
                    const name = newWorldName.trim();
                    invoke<string>("get_worlds_dir").then((worldsDir) => {
                      const path = `${worldsDir}/${name}`;
                      const wid = openWorld(name, path);
                      initWorld(path, name).catch(() => {});
                      const sid = useStore.getState().addStory(wid, t.sidebar.newStoryDefault);
                      invoke("save_story_meta", { worldPath: path, story: { id: sid, title: t.sidebar.newStoryDefault, status: "drafting", conversations: [], created_at: new Date().toISOString() } }).catch(() => {});
                      useStore.getState().createConversation(sid);
                    }).catch(() => {});
                    setNewWorldName("");
                    setCreatingWorld(false);
                  }
                  if (e.key === "Escape") { setCreatingWorld(false); setNewWorldName(""); }
                }}
                onBlur={() => { setCreatingWorld(false); setNewWorldName(""); }}
                placeholder={t.sidebar.worldNamePlaceholder}
                className="w-full h-9 rounded-lg bg-surface-800 border border-edge text-sm text-ink px-3 outline-none focus:border-brand-500/30"
              />
            ) : (
              <button onClick={() => setCreatingWorld(true)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink bg-surface-800 border border-edge rounded-lg hover:bg-surface-700 transition-colors">
                <Plus className="w-4 h-4 text-brand-500" />
                {t.sidebar.createWorld}
              </button>
            )}
            {openingWorld ? (
              <div className="space-y-1">
                {scanningWorlds && <p className="text-[0.688rem] text-ink-muted text-center py-2">{t.sidebar.scanning}</p>}
                {!scanningWorlds && worldList.length === 0 && <p className="text-[0.688rem] text-ink-muted text-center py-2">{t.sidebar.emptyWorlds}</p>}
                {worldList.map((w) => (
                  <button key={w.path} onClick={async () => {
                    const wid = openWorld(w.name, w.path);
                    setOpeningWorld(false);
                    try {
                      const stories = await invoke<Array<{ id: string; title: string; status: string; conversations: Array<{ id: string; title: string }> }>>("load_stories", { worldPath: w.path });
                      if (stories.length > 0) {
                        const convId = useStore.getState().hydrateStories(wid, stories);
                        if (convId) {
                          const msgs = await invoke<Array<{ type: string; content: string; thinking?: string; id?: string; tool?: string; tool_use_id?: string; input?: unknown; output?: string }>>("load_session", { worldPath: w.path, sessionId: convId });
                          type StoreMessage = { id: string; role: "user" | "assistant" | "system"; content: string; thinking?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown>; result: string }>; timestamp: number };
                          const convMsgs: StoreMessage[] = [];
                          const pendingMap = new Map<string, { id: string; name: string; input: Record<string, unknown>; result: string }>();
                          const pendingOrder: string[] = [];
                          for (const m of msgs) {
                            if (m.type === "user") {
                              convMsgs.push({ id: `msg_${convMsgs.length}`, role: "user", content: m.content, timestamp: Date.now() });
                              pendingMap.clear(); pendingOrder.length = 0;
                            } else if (m.type === "assistant") {
                              const toolCalls = pendingOrder.map((tid) => pendingMap.get(tid)!).filter(Boolean);
                              convMsgs.push({ id: `msg_${convMsgs.length}`, role: "assistant", content: m.content, thinking: m.thinking, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, timestamp: Date.now() });
                              pendingMap.clear(); pendingOrder.length = 0;
                            } else if (m.type === "system") {
                              convMsgs.push({ id: `msg_${convMsgs.length}`, role: "system", content: m.content, timestamp: Date.now() });
                            } else if (m.type === "tool_use") {
                              const tid = m.id || `tc_${pendingOrder.length}`;
                              pendingMap.set(tid, { id: tid, name: m.tool || "", input: (m.input as Record<string, unknown>) || {}, result: "" });
                              pendingOrder.push(tid);
                            } else if (m.type === "tool_result") {
                              const output = (m.output as string) || "";
                              const tuid = m.tool_use_id || "";
                              const tc = tuid ? pendingMap.get(tuid) : undefined;
                              if (tc) tc.result = output;
                              convMsgs.push({ id: `msg_${convMsgs.length}`, role: "system", content: `[工具结果: ${m.tool || "tool"}]\n${output}`, timestamp: Date.now() });
                            }
                          }
                          if (convMsgs.length > 0) {
                            useStore.setState((prev) => ({
                              worlds: prev.worlds.map((ww) => ww.id === wid ? {
                                ...ww, stories: ww.stories.map((ss) => ss.id === stories[0].id ? {
                                  ...ss, conversations: ss.conversations.map((cc) => cc.id === convId ? { ...cc, messages: convMsgs } : cc),
                                } : ss),
                              } : ww),
                            }));
                          }
                        }
                      }
                    } catch {}
                  }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-800 rounded-lg transition-colors text-left">
                    <Globe className="w-4 h-4 text-ink-muted flex-shrink-0" />
                    <span>{w.name}</span>
                  </button>
                ))}
                <button onClick={() => setOpeningWorld(false)} className="w-full text-center text-[0.688rem] text-ink-muted hover:text-ink py-1">{t.common.cancel}</button>
              </div>
            ) : (
              <button onClick={async () => {
                setOpeningWorld(true);
                setScanningWorlds(true);
                setWorldList([]);
                try {
                  const worldsDir = await invoke<string>("get_worlds_dir");
                  const list = await invoke<{ name: string; path: string; description: string }[]>("list_worlds", { rootDir: worldsDir });
                  setWorldList(list);
                } catch { setWorldList([]); }
                setScanningWorlds(false);
              }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink-secondary border border-edge rounded-lg hover:bg-surface-800 transition-colors">
                <FolderOpen className="w-4 h-4" />
                {t.sidebar.openWorld}
              </button>
            )}
          </div>
        </div>

        <div className="p-2 flex-shrink-0">
          <UserProfileFooter />
        </div>
      </div>
    );
  }

  // ── State B: World is open ──
  return (
    <div className="flex flex-col h-full bg-surface-900 select-none">
      {/* World header */}
      <div className="h-12 flex items-center gap-2 px-3 flex-shrink-0">
        <WorldForgeLogo className="w-8 h-8 flex-shrink-0" />
        <span className="font-semibold text-sm tracking-tight truncate flex-1"
          onDoubleClick={() => setEditing({ type: "world", id: activeWorld.id, value: activeWorld.name })}
        >
          {editing?.type === "world" ? (
            <input value={editing.value} autoFocus className="bg-surface-800 text-ink text-sm font-semibold outline-none w-full px-1"
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") { const name = editing.value; renameWorld(activeWorld.id, name); invoke("rename_world", { worldPath: activeWorld.path, newName: name }).catch(() => {}); setEditing(null); }
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={() => { const name = editing.value; renameWorld(activeWorld.id, name); invoke("rename_world", { worldPath: activeWorld.path, newName: name }).catch(() => {}); setEditing(null); }}
            />
          ) : activeWorld.name}
        </span>
        <SidebarToggle />
      </div>

      {/* Story list + conversations */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-1">
          {activeWorld.stories.map((story) => (
            <StoryGroup
              key={story.id}
              story={story}
              isWorldActive={activeWorldId === activeWorld.id}
              activeConversationId={activeConversationId}
              onNewConversation={() => {
                const convId = createConversation(story.id);
                // Update story meta with new conversation
                const convs = story.conversations.map((c: { id: string; title: string }) => ({ id: c.id, title: c.title, created_at: new Date().toISOString() }));
                convs.push({ id: convId, title: t.sidebar.newConvTitle(convs.length + 1), created_at: new Date().toISOString() });
                invoke("save_story_meta", { worldPath: activeWorld.path, story: { id: story.id, title: story.title, status: story.status, conversations: convs, created_at: new Date().toISOString() } }).catch(() => {});
              }}
              onDeleteConversation={(convId) => {
                deleteConversation(story.id, convId);
                const convs = story.conversations.filter((c: { id: string }) => c.id !== convId).map((c: { id: string; title: string }) => ({ id: c.id, title: c.title, created_at: new Date().toISOString() }));
                invoke("save_story_meta", { worldPath: activeWorld.path, story: { id: story.id, title: story.title, status: story.status, conversations: convs, created_at: new Date().toISOString() } }).catch(() => {});
                // Clean up session and upload files on disk
                invoke("delete_session", { worldPath: activeWorld.path, sessionId: convId }).catch(() => {});
                invoke("delete_directory", { worldPath: activeWorld.path, dirName: `uploads/${convId}` }).catch(() => {});
              }}
              onRenameConversation={(convId, title) => {
                renameConversation(story.id, convId, title);
                const convs = story.conversations.map((c: { id: string; title: string }) => ({ id: c.id, title: c.id === convId ? title : c.title, created_at: new Date().toISOString() }));
                invoke("save_story_meta", { worldPath: activeWorld.path, story: { id: story.id, title: story.title, status: story.status, conversations: convs, created_at: new Date().toISOString() } }).catch(() => {});
              }}
              onRenameStory={(title) => {
                renameStory(activeWorld.id, story.id, title);
                const convs = story.conversations.map((c: { id: string; title: string }) => ({ id: c.id, title: c.title, created_at: new Date().toISOString() }));
                invoke("save_story_meta", { worldPath: activeWorld.path, story: { id: story.id, title, status: story.status, conversations: convs, created_at: new Date().toISOString() } }).catch(() => {});
              }}
              editing={editing}
              setEditing={setEditing}
              onSelectConversation={setActiveConversation}
              onDeleteStory={() => {
                deleteStory(activeWorld.id, story.id);
                invoke("delete_story_meta", { worldPath: activeWorld.path, storyId: story.id }).catch(() => {});
                // Clean up all associated files: sessions, uploads, and outline chapters
                for (const c of story.conversations) {
                  invoke("delete_session", { worldPath: activeWorld.path, sessionId: c.id }).catch(() => {});
                  invoke("delete_directory", { worldPath: activeWorld.path, dirName: `uploads/${c.id}` }).catch(() => {});
                }
                invoke("delete_directory", { worldPath: activeWorld.path, dirName: `outline/${story.id}` }).catch(() => {});
              }}
            />
          ))}

          {activeWorld.stories.length === 0 && (
            <p className="text-xs text-ink-muted text-center py-6 px-2">
              {t.sidebar.noStories}
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Bottom actions */}
      <div className="mx-3 h-px bg-surface-700" />
      <div className="p-2 flex-shrink-0 space-y-0.5">
        {creatingStory ? (
          <input
            autoFocus
            placeholder={t.sidebar.storyNamePlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                const sid = addStory(activeWorld.id, e.currentTarget.value.trim());
                invoke("save_story_meta", { worldPath: activeWorld.path, story: { id: sid, title: e.currentTarget.value.trim(), status: "drafting", conversations: [], created_at: new Date().toISOString() } }).catch(() => {});
                setCreatingStory(false);
              }
              if (e.key === "Escape") setCreatingStory(false);
            }}
            onBlur={() => setCreatingStory(false)}
            className="w-full h-7 text-[0.688rem] bg-surface-800 rounded px-2 text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => setCreatingStory(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-800 rounded-md transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5" />
            {t.sidebar.newStory}
          </button>
        )}
        <button
          onClick={() => (window as any).__worldforge?.openTimeline()}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-800 rounded-md transition-colors"
        >
          <Clock className="w-3.5 h-3.5" />
          {t.sidebar.timeline}
        </button>
        <button
          data-confirm
          onClick={() => {
            if (!confirmDeleteWorld) {
              setConfirmDeleteWorld(true);
              setTimeout(() => setConfirmDeleteWorld(false), 3000);
              return;
            }
            invoke("delete_world", { path: activeWorld.path }).then(() => {
              closeWorld(activeWorld.id);
            }).catch((e) => console.error("删除世界失败:", e));
            setConfirmDeleteWorld(false);
          }}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors",
            confirmDeleteWorld
              ? "text-error hover:bg-error/10"
              : "text-ink-muted hover:text-error hover:bg-surface-800"
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {confirmDeleteWorld ? t.sidebar.confirmDeleteWorld : t.sidebar.deleteWorld}
        </button>
        <button
          onClick={() => closeWorld(activeWorld.id)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink-muted hover:text-error hover:bg-surface-800 rounded-md transition-colors"
        >
          {t.sidebar.closeWorld}
        </button>
        <div className="pt-1.5 mt-1.5 border-t border-surface-700/60">
          <UserProfileFooter />
        </div>
      </div>
    </div>
  );
}

function UserProfileFooter() {
  const { t } = useT();
  const avatar = useStore((s) => s.avatar);
  const username = useStore((s) => s.username);
  const setAvatar = useStore((s) => s.setAvatar);
  const setUsername = useStore((s) => s.setUsername);

  useEffect(() => {
    invoke<string>("load_avatar").then(setAvatar).catch(() => {});
    invoke<string>("load_username").then((u) => { if (u) setUsername(u); }).catch(() => {});
  }, []);

  return (
    <button
      onClick={() => (window as any).__worldforge?.openSettings()}
      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-surface-800 transition-colors group"
      title={t.sidebar.settings}
    >
      <span className="w-9 h-9 rounded-full bg-surface-800 border border-edge flex items-center justify-center flex-shrink-0 overflow-hidden">
        {avatar ? (
          <img src={avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <WorldForgeLogo className="w-14 h-14 max-w-none translate-y-0.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-ink truncate">{username || t.sidebar.localUser}</span>
        <span className="block text-[0.625rem] text-ink-muted truncate">{t.sidebar.localProfile}</span>
      </span>
      <Settings className="w-3.5 h-3.5 text-ink-muted group-hover:text-ink transition-colors flex-shrink-0" />
    </button>
  );
}

// ── Story group with expandable conversation list ──

function StoryGroup({
  story,
  activeConversationId,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onRenameStory,
  onSelectConversation,
  onDeleteStory,
  editing,
  setEditing,
}: {
  story: ReturnType<typeof useStore.getState>["worlds"][0]["stories"][0];
  isWorldActive: boolean;
  activeConversationId: string | null;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onRenameStory: (title: string) => void;
  onSelectConversation: (id: string) => void;
  onDeleteStory: () => void;
  editing: { type: "world" | "story" | "conv"; id: string; value: string } | null;
  setEditing: React.Dispatch<React.SetStateAction<{ type: "world" | "story" | "conv"; id: string; value: string } | null>>;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteConv, setConfirmDeleteConv] = useState<string | null>(null);
  const isStreaming = useStore((s) => s.isStreaming);
  const streamingConversationId = useStore((s) => s.streamingConversationId);

  // Click-away resets confirm
  useEffect(() => {
    if (!confirmDelete && !confirmDeleteConv) return;
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-confirm]")) { setConfirmDelete(false); setConfirmDeleteConv(null); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [confirmDelete, confirmDeleteConv]);

  return (
    <div>
      {/* Story header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
          "text-ink-secondary hover:text-ink hover:bg-surface-850",
        )}
      >
        <button className="p-0.5 text-ink-muted">
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <MessageSquare className="w-3.5 h-3.5 text-ink-muted" />
        <span className="text-xs font-medium truncate flex-1"
          onDoubleClick={(e) => { e.stopPropagation(); setEditing({ type: "story", id: story.id, value: story.title }); }}
        >
          {editing?.type === "story" && editing.id === story.id ? (
            <input value={editing.value} autoFocus className="bg-surface-800 text-ink text-xs font-medium outline-none w-full px-1"
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { onRenameStory(editing.value); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
              onBlur={() => { onRenameStory(editing.value); setEditing(null); }}
            />
          ) : story.title}
        </span>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNewConversation();
            }}
            className="p-0.5 rounded hover:bg-surface-700 text-ink-muted hover:text-brand-400"
            title={t.sidebar.newConvTooltip}
          >
            <Plus className="w-3 h-3" />
          </button>
          {confirmDelete ? (
            <button data-confirm onClick={(e) => { e.stopPropagation(); onDeleteStory(); setConfirmDelete(false); }} className="text-[0.625rem] text-error hover:bg-surface-700 px-1 py-0.5 rounded">{t.status.confirm}</button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }} className="p-0.5 rounded hover:bg-surface-700 text-ink-muted hover:text-error" title={t.sidebar.deleteStory}>
              <Trash2 className="w-3 h-3" />
          </button>
          )}
        </div>
      </div>

      {/* Conversations */}
      {expanded && (
        <div className="ml-5 space-y-0.5">
          {story.conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={cn(
                "group flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors",
                conv.id === activeConversationId
                  ? "bg-surface-800 text-ink"
                  : "text-ink-secondary hover:text-ink hover:bg-surface-850",
              )}
            >
              {isStreaming && conv.id === streamingConversationId ? (
                <span className="w-3 h-3 flex-shrink-0 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse-soft" />
                </span>
              ) : (
                <MessageSquare className="w-3 h-3 text-ink-muted flex-shrink-0" />
              )}
              <span className="text-[0.688rem] truncate flex-1"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing({ type: "conv", id: conv.id, value: conv.title }); }}
              >
                {editing?.type === "conv" && editing.id === conv.id ? (
                  <input value={editing.value} autoFocus className="bg-surface-800 text-ink text-[0.688rem] outline-none w-full px-1"
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { onRenameConversation(conv.id, editing.value); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                    onBlur={() => { onRenameConversation(conv.id, editing.value); setEditing(null); }}
                  />
                ) : conv.title}
              </span>
              {confirmDeleteConv === conv.id ? (
                <button data-confirm onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); setConfirmDeleteConv(null); }} className="text-[0.625rem] text-error hover:bg-surface-700 px-1 py-0.5 rounded transition-all">
                  {t.status.confirm}
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteConv(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-700 text-ink-muted hover:text-error transition-all"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
          {story.conversations.length === 0 && (
            <p className="text-[0.625rem] text-ink-muted px-2 py-1">{t.sidebar.noConversations}</p>
          )}
        </div>
      )}
    </div>
  );
}

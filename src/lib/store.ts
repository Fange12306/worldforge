import { create } from "zustand";
import { invoke } from "./api";

// ── Types ──────────────────────────────────────────

export type World = {
  id: string;
  name: string;
  path: string;           // folder path on disk
  stories: Story[];
  createdAt: number;
};

export type Story = {
  id: string;
  worldId: string;
  title: string;
  timelineRange?: string;  // "341-360 AC"
  status: "planning" | "drafting" | "done";
  conversations: Conversation[];
  createdAt: number;
};

export type Conversation = {
  id: string;
  storyId: string;
  title: string;
  messages: Message[];
  totalTokens: number;
  createdAt: number;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
};

export type TimelineBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; call: ToolCall };

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  timeline?: TimelineBlock[];
  timestamp: number;
};

// ── ID generators ──────────────────────────────────

let _id = 0;
const nextId = (prefix: string) => `${prefix}_${++_id}`;

// ── Store ──────────────────────────────────────────

type AppStore = {
  // World management
  worlds: World[];
  activeWorldId: string | null;
  openWorld: (name: string, path: string) => string;
  renameWorld: (id: string, name: string) => void;
  closeWorld: (id: string) => void;
  setActiveWorld: (id: string) => void;

  // Story management
  addStory: (worldId: string, title: string, storyId?: string) => string;
  hydrateStories: (worldId: string, stories: Array<{ id: string; title: string; status: string; conversations: Array<{ id: string; title: string }> }>) => string | null;
  renameStory: (worldId: string, storyId: string, title: string) => void;
  deleteStory: (worldId: string, storyId: string) => void;
  renameConversation: (storyId: string, convId: string, title: string) => void;

  // Conversations
  activeConversationId: string | null;
  createConversation: (storyId: string) => string;
  deleteConversation: (storyId: string, convId: string) => void;
  setActiveConversation: (id: string) => void;

  // Messages
  addMessage: (storyId: string, msg: Omit<Message, "id" | "timestamp"> & { toolCalls?: ToolCall[] }) => void;
  updateMessage: (storyId: string, msgId: string, content: string) => void;

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  theme: "dark" | "light";
  toggleTheme: () => void;

  // LLM settings
  llmProvider: string;
  llmModels: { name: string }[];
  activeModel: string;
  setLlmProvider: (p: string) => void;
  setLlmModels: (m: { name: string }[]) => void;
  setActiveModel: (m: string) => void;

  // Token usage (per-conversation, from API usage fields)
  addTokens: (input: number, output: number) => void;

  // Streaming (one at a time, tied to a specific conversation)
  isStreaming: boolean;
  streamingConversationId: string | null;
  setStreaming: (v: boolean, convId?: string) => void;
  streamText: string;
  streamThinking: string;
  streamToolCalls: ToolCall[];
  isThinking: boolean;
  isToolRunning: boolean;
  appendStreamText: (text: string) => void;
  appendStreamThinking: (text: string) => void;
  addStreamToolCall: (tc: ToolCall) => void;
  updateStreamToolResult: (id: string, result: string) => void;
  setIsThinking: (v: boolean) => void;
  setIsToolRunning: (v: boolean) => void;
  clearStreamText: () => void;

  // ID counter sync — call after hydrating from disk to prevent ID reuse
  syncIdCounter: (existingIds: string[]) => void;
};

// ── Helpers ────────────────────────────────────────

function findStory(stories: Story[], convId: string): Story | undefined {
  return stories.find((s) => s.conversations.some((c) => c.id === convId));
}

function findConversation(stories: Story[], convId: string): Conversation | undefined {
  for (const s of stories) {
    const c = s.conversations.find((c) => c.id === convId);
    if (c) return c;
  }
  return undefined;
}

// ── Store ──────────────────────────────────────────

export const useStore = create<AppStore>((set, get) => ({
  worlds: [],
  activeWorldId: null,

  openWorld: (name, path) => {
    const id = nextId("world");
    const world: World = {
      id,
      name,
      path,
      stories: [],
      createdAt: Date.now(),
    };
    set((s) => ({
      worlds: [...s.worlds, world],
      activeWorldId: id,
    }));
    return id;
  },

  renameWorld: (id, name) =>
    set((s) => ({
      worlds: s.worlds.map((w) => (w.id === id ? { ...w, name } : w)),
    })),
  closeWorld: (id) =>
    set((s) => ({
      worlds: s.worlds.filter((w) => w.id !== id),
      activeWorldId: s.activeWorldId === id ? null : s.activeWorldId,
    })),

  setActiveWorld: (id) => set({ activeWorldId: id }),

  hydrateStories: (worldId, stories) => {
    let firstConvId: string | null = null;
    // Collect all existing IDs to advance the counter and prevent ID reuse
    const existingIds: string[] = [];
    for (const st of stories) {
      existingIds.push(st.id);
      for (const c of (st.conversations || [])) existingIds.push(c.id);
    }
    set((s) => ({
      worlds: s.worlds.map((w) =>
        w.id === worldId
          ? {
              ...w,
              stories: stories.map((st) => {
                const convs = (st.conversations || []).map((c) => ({
                  id: c.id,
                  storyId: st.id,
                  title: c.title,
                  messages: [],
                  totalTokens: 0,
                  createdAt: Date.now(),
                }));
                if (!firstConvId && convs.length > 0) firstConvId = convs[0].id;
                return {
                  id: st.id,
                  worldId,
                  title: st.title,
                  status: st.status as "planning" | "drafting" | "done",
                  conversations: convs,
                  createdAt: Date.now(),
                };
              }),
            }
          : w,
      ),
      activeConversationId: firstConvId,
    }));
    // Prevent ID counter reuse after hydration
    for (const id of existingIds) {
      const num = parseInt(id.replace(/^[a-z]+_/, ""), 10);
      if (!isNaN(num) && num > _id) _id = num;
    }
    return firstConvId;
  },

  syncIdCounter: (existingIds) => {
    for (const id of existingIds) {
      const num = parseInt(id.replace(/^[a-z]+_/, ""), 10);
      if (!isNaN(num) && num > _id) _id = num;
    }
  },

  addStory: (worldId, title, storyId) => {
    const id = storyId || nextId("story");
    set((s) => ({
      worlds: s.worlds.map((w) =>
        w.id === worldId
          ? {
              ...w,
              stories: [
                ...w.stories,
                {
                  id,
                  worldId,
                  title,
                  status: "drafting",
                  conversations: [],
                  createdAt: Date.now(),
                },
              ],
            }
          : w,
      ),
    }));
    return id;
  },

  renameStory: (worldId, storyId, title) =>
    set((s) => ({
      worlds: s.worlds.map((w) =>
        w.id === worldId
          ? { ...w, stories: w.stories.map((st) => (st.id === storyId ? { ...st, title } : st)) }
          : w,
      ),
    })),
  renameConversation: (storyId, convId, title) =>
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? { ...st, conversations: st.conversations.map((c) => (c.id === convId ? { ...c, title } : c)) }
            : st,
        ),
      })),
    })),

  deleteStory: (worldId, storyId) =>
    set((s) => ({
      worlds: s.worlds.map((w) =>
        w.id === worldId
          ? { ...w, stories: w.stories.filter((st) => st.id !== storyId) }
          : w,
      ),
      activeConversationId:
        findConversation(get().worlds.flatMap((w) => w.stories), get().activeConversationId ?? "")
          ? get().activeConversationId
          : null,
    })),

  activeConversationId: null,

  createConversation: (storyId) => {
    const id = nextId("conv");
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: [
                  ...st.conversations,
                  {
                    id,
                    storyId,
                    title: `对话 ${st.conversations.length + 1}`,
                    messages: [],
                    totalTokens: 0,
                    createdAt: Date.now(),
                  },
                ],
              }
            : st,
        ),
      })),
      activeConversationId: id,
    }));
    return id;
  },

  deleteConversation: (storyId, convId) =>
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: st.conversations.filter((c) => c.id !== convId),
              }
            : st,
        ),
      })),
      activeConversationId:
        s.activeConversationId === convId ? null : s.activeConversationId,
    })),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (storyId, msg) =>
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: st.conversations.map((c) =>
                  c.id === s.activeConversationId
                    ? {
                        ...c,
                        messages: [
                          ...c.messages,
                          { ...msg, id: nextId("msg"), timestamp: Date.now() },
                        ],
                      }
                    : c,
                ),
              }
            : st,
        ),
      })),
    })),

  updateMessage: (storyId, msgId, content) =>
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: st.conversations.map((c) =>
                  c.id === s.activeConversationId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === msgId ? { ...m, content } : m,
                        ),
                      }
                    : c,
                ),
              }
            : st,
        ),
      })),
    })),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  theme: (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark",
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("light", next === "light");
      return { theme: next };
    }),

  llmProvider: "",
  llmModels: [],
  activeModel: "",
  setLlmProvider: (p) => set({ llmProvider: p }),
  setLlmModels: (m) => set({ llmModels: m }),
  setActiveModel: (m) => set({ activeModel: m }),

  addTokens: (input, output) => {
    const state = get();
    const world = state.worlds.find((w) => w.id === state.activeWorldId);
    const cid = state.activeConversationId;
    const newTotal = (state.worlds
      .find((w) => w.id === state.activeWorldId)
      ?.stories.flatMap((s) => s.conversations)
      .find((c) => c.id === cid)?.totalTokens ?? 0) + input + output;
    // Persist to disk (fire-and-forget)
    if (world && cid) {
      invoke("save_session_tokens", { worldPath: world.path, sessionId: cid, totalTokens: newTotal }).catch(() => {});
    }
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) => ({
          ...st,
          conversations: st.conversations.map((c) =>
            c.id === s.activeConversationId
              ? { ...c, totalTokens: newTotal }
              : c,
          ),
        })),
      })),
    }));
  },

  isStreaming: false,
  streamingConversationId: null,
  setStreaming: (v, convId) => set({ isStreaming: v, streamingConversationId: v ? (convId ?? null) : null }),

  streamText: "",
  streamThinking: "",
  // RAF-batched streaming: accumulate deltas in buffer, flush once per frame.
  // Reduces Zustand updates from ~50-100/sec (raw text_delta rate) to ~60/sec.
  _buf: { text: "", thinking: "", raf: 0 },
  appendStreamText: (t) => {
    const b = (get() as any)._buf; b.text += t;
    if (!b.raf) b.raf = requestAnimationFrame(() => { b.raf = 0; const vt = b.text; b.text = ""; const vh = b.thinking; b.thinking = ""; set((s) => { const next: any = {}; if (vt) next.streamText = s.streamText + vt; if (vh) next.streamThinking = s.streamThinking + vh; return next; }); });
  },
  appendStreamThinking: (t) => {
    const b = (get() as any)._buf; b.thinking += t;
    if (!b.raf) b.raf = requestAnimationFrame(() => { b.raf = 0; const vt = b.text; b.text = ""; const vh = b.thinking; b.thinking = ""; set((s) => { const next: any = {}; if (vt) next.streamText = s.streamText + vt; if (vh) next.streamThinking = s.streamThinking + vh; return next; }); });
  },
  addStreamToolCall: (tc: ToolCall) =>
    set((s) => ({ streamToolCalls: [...s.streamToolCalls, tc] })),
  updateStreamToolResult: (id: string, result: string) =>
    set((s) => ({
      streamToolCalls: s.streamToolCalls.map((tc) => tc.id === id ? { ...tc, result } : tc),
    })),
  isThinking: false,
  isToolRunning: false,
  setIsThinking: (v) => set({ isThinking: v }),
  setIsToolRunning: (v) => set({ isToolRunning: v }),
  streamToolCalls: [],
  clearStreamText: () => set({ streamText: "", streamThinking: "", streamToolCalls: [], isThinking: false, isToolRunning: false }),
}));

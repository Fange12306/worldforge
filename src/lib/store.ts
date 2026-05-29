import { create } from "zustand";
import { invoke } from "./api";
import { getT } from "./i18n";
import type { ContextBreakdown } from "./context-window";
import { getContextWindowSize } from "./context-window";

export type UploadedFile = { name: string; storedName: string; content: string };

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
  contextUsed: number;
  contextBreakdown: ContextBreakdown | null;
  createdAt: number;
  // Context compression state
  compressedAt?: number;
  compressedSummary?: string;
  compressedTokenSavings?: number;
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

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  thinkingStyle: "deepseek" | "anthropic" | "none";
};

export type ModelConfig = {
  name: string;
  alias?: string;
  providerId: string;
  reasoningEffort?: "disabled" | "low" | "medium" | "high" | "max";
  contextWindow?: number;
  maxTokens?: number;
};

// ── ID generators ──────────────────────────────────

const nextId = () => crypto.randomUUID();

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

  // Drafts (unsent input, keyed by conversation ID — in-memory only)
  conversationDrafts: Record<string, string>;
  setConversationDraft: (convId: string, draft: string) => void;
  conversationFiles: Record<string, UploadedFile[]>;
  setConversationFiles: (convId: string, files: UploadedFile[]) => void;

  // Messages
  addMessage: (storyId: string, msg: Omit<Message, "id" | "timestamp"> & { toolCalls?: ToolCall[] }, convId?: string) => void;
  updateMessage: (storyId: string, msgId: string, content: string) => void;

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  fontSize: "sm" | "md" | "lg";
  setFontSize: (s: "sm" | "md" | "lg") => void;
  language: "zh" | "en";
  setLanguage: (lang: "zh" | "en") => void;
  avatar: string;
  setAvatar: (dataUrl: string) => void;
  username: string;
  setUsername: (name: string) => void;

  // LLM settings
  providers: ProviderConfig[];
  activeProviderId: string;
  llmProvider: string;          // deprecated — derived from activeProviderId
  llmModels: ModelConfig[];
  activeModel: string;
  setProviders: (p: ProviderConfig[]) => void;
  addProvider: (p: ProviderConfig) => void;
  removeProvider: (id: string) => void;
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void;
  setActiveProviderId: (id: string) => void;
  setLlmProvider: (p: string) => void;
  setLlmModels: (m: ModelConfig[]) => void;
  setActiveModel: (m: string) => void;

  // Token usage (per-conversation, from API usage fields)
  addTokens: (input: number, output: number, convId?: string) => void;

  // Context window tracking
  contextWindowSize: number;
  setContextWindow: (provider: string, model: string, modelContextWindow?: number) => void;
  updateContextUsage: (used: number, breakdown: ContextBreakdown, convId?: string) => void;

  // Context compression
  compressionThreshold: number;
  isCompressing: boolean;
  forceCompress: boolean;
  setCompressionThreshold: (threshold: number) => void;
  setCompressing: (v: boolean) => void;
  setForceCompress: (v: boolean) => void;
  markCompressed: (convId: string, summary: string, tokenSavings: number) => void;
  replaceMessages: (convId: string, msgs: Message[]) => void;

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
    const id = nextId();
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
    set((s) => {
      const world = s.worlds.find((w) => w.id === id);
      const drafts = { ...s.conversationDrafts };
      if (world) {
        for (const story of world.stories) {
          for (const conv of story.conversations) {
            delete drafts[conv.id];
          }
        }
      }
      return {
        worlds: s.worlds.filter((w) => w.id !== id),
        activeWorldId: s.activeWorldId === id ? null : s.activeWorldId,
        conversationDrafts: drafts,
      };
    }),

  setActiveWorld: (id) => set({ activeWorldId: id }),

  hydrateStories: (worldId, stories) => {
    let firstConvId: string | null = null;
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
                  contextUsed: 0,
                  contextBreakdown: null,
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
    return firstConvId;
  },

  syncIdCounter: (_existingIds) => {
    // No-op: crypto.randomUUID() prevents collisions naturally
  },

  addStory: (worldId, title, storyId) => {
    const id = storyId || nextId();
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
    const id = nextId();
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
                    title: getT(get().language).sidebar.newConvTitle(st.conversations.length + 1),
                    messages: [],
                    totalTokens: 0,
                    contextUsed: 0,
                    contextBreakdown: null,
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

  addMessage: (storyId, msg, convId?) =>
    set((s) => {
      const cid = convId ?? s.activeConversationId;
      return {
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: st.conversations.map((c) =>
                  c.id === cid
                    ? {
                        ...c,
                        messages: [
                          ...c.messages,
                          { ...msg, id: nextId(), timestamp: Date.now() },
                        ],
                      }
                    : c,
                ),
              }
            : st,
        ),
      })),
    };}),

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

  fontSize: (() => {
    if (typeof window === "undefined") return "md";
    return (localStorage.getItem("worldforge-font-size") as "sm" | "md" | "lg") || "md";
  })(),
  setFontSize: (s) => {
    localStorage.setItem("worldforge-font-size", s);
    const sizes = { sm: "14px", md: "16px", lg: "18px" };
    document.documentElement.style.fontSize = sizes[s];
    set({ fontSize: s });
  },

  language: "zh",
  setLanguage: (lang) => set({ language: lang }),
  avatar: "",
  setAvatar: (dataUrl) => set({ avatar: dataUrl }),
  username: "",
  setUsername: (name) => set({ username: name }),

  providers: [],
  activeProviderId: "",
  llmProvider: "",
  llmModels: [],
  activeModel: "",
  setProviders: (p) => set({ providers: p }),
  addProvider: (p) => set((s) => ({ providers: [...s.providers, p] })),
  removeProvider: (id) => set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })),
  updateProvider: (id, patch) => set((s) => ({
    providers: s.providers.map((p) => p.id === id ? { ...p, ...patch } : p),
  })),
  setActiveProviderId: (id) => set({ activeProviderId: id, llmProvider: id }),
  setLlmProvider: (p) => set({ llmProvider: p }),
  setLlmModels: (m) => set({ llmModels: m }),
  setActiveModel: (m) => set({ activeModel: m }),

  conversationDrafts: {},
  setConversationDraft: (convId, draft) =>
    set((s) => ({
      conversationDrafts: { ...s.conversationDrafts, [convId]: draft },
    })),
  conversationFiles: {},
  setConversationFiles: (convId, files) =>
    set((s) => ({
      conversationFiles: { ...s.conversationFiles, [convId]: files },
    })),

  // Context window tracking
  contextWindowSize: 128_000,
  setContextWindow: (provider, model, modelContextWindow?) =>
    set({ contextWindowSize: modelContextWindow || getContextWindowSize(provider, model) }),
  updateContextUsage: (used, breakdown, convId?) => {
    const state = get();
    const cid = convId ?? state.activeConversationId;
    const world = state.worlds.find((w) => w.id === state.activeWorldId);
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) => ({
          ...st,
          conversations: st.conversations.map((c) =>
            c.id === cid ? { ...c, contextUsed: used, contextBreakdown: breakdown } : c
          ),
        })),
      })),
    }));
    // Persist to disk
    if (world && cid) {
      invoke("save_session_state", {
        worldPath: world.path,
        sessionId: cid,
        stateJson: JSON.stringify({ contextUsed: used, contextBreakdown: breakdown }),
      }).catch(() => {});
    }
  },

  // Context compression
  compressionThreshold: 0.8,
  isCompressing: false,
  forceCompress: false,
  setCompressionThreshold: (threshold) => set({ compressionThreshold: threshold }),
  setCompressing: (v) => set({ isCompressing: v }),
  setForceCompress: (v) => set({ forceCompress: v }),
  markCompressed: (convId, summary, tokenSavings) => {
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) => ({
          ...st,
          conversations: st.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  compressedAt: Date.now(),
                  compressedSummary: summary,
                  compressedTokenSavings: tokenSavings,
                }
              : c
          ),
        })),
      })),
    }));
  },

  replaceMessages: (convId, msgs) => {
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) => ({
          ...st,
          conversations: st.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: msgs }
              : c
          ),
        })),
      })),
    }));
  },

  addTokens: (input, output, convId?) => {
    const state = get();
    const cid = convId ?? state.activeConversationId;
    const world = state.worlds.find((w) => w.id === state.activeWorldId);
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
            c.id === cid
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
  clearStreamText: () => {
    const b = (get() as any)._buf;
    if (b.raf) { cancelAnimationFrame(b.raf); b.raf = 0; }
    b.text = ""; b.thinking = "";
    set({ streamText: "", streamThinking: "", streamToolCalls: [], isThinking: false, isToolRunning: false });
  },
}));

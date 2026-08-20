import { create } from "zustand";
import { invoke } from "./api";
import { getT } from "./i18n";
import type { ContextBreakdown } from "./context-window";
import { getContextWindowSize } from "./context-window";
import { rewriteSessionMessages, messagesToSessionLines } from "./session-writer";

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
  /**
   * Id of the FIRST message in the keep zone (i.e., the first message that
   * survived the most recent compression). On the next send, all messages
   * in the store with an id BEFORE this one are replaced with a summary
   * message in the LLM-bound view, while the store itself keeps the full
   * original content (thinking, toolCalls) for UI replay. Stored as a
   * stable id rather than an index so it survives addMessage / pruning
   * that change array length.
   */
  compressedBeforeId?: string | null;
  // DeepSeek KV cache tracking (automatic disk cache)
  cacheHitTokens: number;
  cacheMissTokens: number;
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

/**
 * Wire protocol variant for chain-of-thought / reasoning control. Different
 * LLM providers expose their own non-standard fields on top of the OpenAI
 * `reasoning_effort` field, so we have to pick one to send.
 *
 *   - "openai":        send `reasoning_effort: <effort>` only.
 *                      Works for OpenAI o1/o3 and any other endpoint that
 *                      consumes the standard field.
 *   - "thinking-type":  send `thinking: {type: ...}` + `reasoning_effort: <effort>`.
 *                      Both DeepSeek V4 and MiniMax use the `thinking` object,
 *                      but the *value* differs:
 *                        - DeepSeek uses `enabled` / `disabled`
 *                        - MiniMax uses `adaptive` / `disabled`
 *                      The "thinking on" value is auto-detected from the baseUrl
 *                      and stored in `ProviderConfig.thinkingOnValue`; Rust sends
 *                      whatever the frontend tells it.
 *                      Required if you want to actually disable thinking on
 *                      providers that default-on.
 *   - "enable-thinking": send `enable_thinking: true|false` (DashScope / Aliyun
 *                      Bailian protocol). Used by Qwen, GLM, Kimi, and also
 *                      by MiniMax when accessed through DashScope.
 *                      Optional companion: `thinking_budget` (token cap).
 */
/**
 * Wire protocol variant for chain-of-thought / reasoning control. Different
 * OpenAI-compatible providers extend the spec in incompatible ways — we pick
 * one to send based on the provider's URL.
 *
 *   - "openai":           send `reasoning_effort: <effort>` only (the standard
 *                         OpenAI o1/o3 field). Default for unknown URLs.
 *   - "thinking-type":    send `thinking: {type: ...}` + `reasoning_effort`.
 *                         Used by DeepSeek V4 and MiniMax. The "type" value
 *                         differs by provider (`enabled` for DeepSeek,
 *                         `adaptive` for MiniMax) — see `thinkingOnValue`.
 *   - "enable-thinking":  send `enable_thinking: true|false` (DashScope /
 *                         Aliyun Bailian protocol). Used by Qwen, GLM, Kimi
 *                         when accessed through DashScope.
 */
export type ThinkingStyle = "openai" | "thinking-type" | "enable-thinking";

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  thinkingStyle: ThinkingStyle;
  /**
   * Wire value to use for `thinking.type` when the model has thinking ON.
   * Auto-detected from baseUrl; not user-editable. Only meaningful for
   * thinkingStyle = "deepseek-ext" — DeepSeek wants "enabled", MiniMax
   * wants "adaptive". Defaults to "enabled" when unknown.
   */
  thinkingOnValue?: "enabled" | "adaptive";
};

export type ModelConfig = {
  name: string;
  alias?: string;
  providerId: string;
  reasoningEffort?: "disabled" | "low" | "medium" | "high" | "max";
  /**
   * Hard "don't think" switch. Overrides reasoningEffort: when true, the wire
   * payload disables the provider's thinking mode regardless of effort.
   * - thinkingStyle = "openai"   → drop reasoning_effort (provider may still default-on)
   * - thinkingStyle = "deepseek" → send `thinking: {type: "disabled"}`
   * - thinkingStyle = "none"     → send nothing (no way to force-off; pick deepseek for that)
   */
  thinkingDisabled?: boolean;
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

  // Edit-retry rollback: snapshot of the full message list captured when the
  // user enters edit-retry. While set, the conversation is in "editing" state;
  // if the user navigates away without sending, restoreRetrySnapshotIfPending
  // undoes the truncation.
  retrySnapshot: { convId: string; messages: Message[] } | null;
  setRetrySnapshot: (convId: string, messages: Message[]) => void;
  clearRetrySnapshot: () => void;
  restoreRetrySnapshotIfPending: () => void;

  // Messages
  addMessage: (storyId: string, msg: Omit<Message, "id" | "timestamp"> & { toolCalls?: ToolCall[] }, convId?: string) => void;
  updateMessage: (storyId: string, msgId: string, content: string) => void;
  updateMessageToolResult: (storyId: string, convId: string, toolUseId: string, result: string) => void;
  /**
   * Replace the toolCalls array of an existing assistant message. Used by the
   * agent-loop's recovery path: when a max_tokens truncation leaves a turn
   * with broken / dangling tool_call_ids, the in-memory message gets cleaned
   * AND the store is updated so the next send (which rebuilds from the store)
   * doesn't re-emit the broken turn.
   */
  updateMessageToolCalls: (storyId: string, convId: string, msgId: string, toolCalls: ToolCall[]) => void;

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
  addCacheStats: (hitTokens: number, missTokens: number, convId?: string) => void;
  resetCacheStats: (convId?: string) => void;

  // Context window tracking
  contextWindowSize: number;
  setContextWindow: (provider: string, model: string, modelContextWindow?: number) => void;
  updateContextUsage: (used: number, breakdown: ContextBreakdown, convId?: string) => void;

  // Context compression
  compressionThreshold: number;
  isCompressing: boolean;
  forceCompress: boolean;
  pruneToolResults: boolean;
  pruneKeepTurns: number;
  /**
   * Max number of recovery attempts when a stream is cut by max_tokens.
   * Each retry adds a user prompt asking the model to continue, which
   * burns one round-trip — high values for models with small output
   * budgets, low values for models that get stuck repeating themselves.
   */
  maxRecoveryAttempts: number;
  setMaxRecoveryAttempts: (n: number) => void;
  setCompressionThreshold: (threshold: number) => void;
  setCompressing: (v: boolean) => void;
  setForceCompress: (v: boolean) => void;
  setPruneToolResults: (v: boolean) => void;
  setPruneKeepTurns: (v: number) => void;
  markCompressed: (convId: string, summary: string, tokenSavings: number, beforeId?: string | null) => void;
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

  // Mode: "ask" = permission prompts for writes, "edit" = auto-approve all writes
  mode: "ask" | "edit";
  setMode: (mode: "ask" | "edit") => void;
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
                  cacheHitTokens: 0,
                  cacheMissTokens: 0,
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

  mode: "ask",
  setMode: (mode) => set({ mode }),

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
                    cacheHitTokens: 0,
                    cacheMissTokens: 0,
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

  // Attach a tool result to the matching tool call inside a persisted message.
  // Used after a loop's message has been flushed but its tools are still
  // executing — the result streams into that message's toolCalls live.
  updateMessageToolResult: (storyId, convId, toolUseId, result) =>
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: st.conversations.map((c) =>
                  c.id === convId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.toolCalls?.some((tc) => tc.id === toolUseId)
                            ? {
                                ...m,
                                toolCalls: m.toolCalls.map((tc) =>
                                  tc.id === toolUseId ? { ...tc, result } : tc,
                                ),
                              }
                            : m,
                        ),
                      }
                    : c,
                ),
              }
            : st,
        ),
      })),
    })),

  // Replace the toolCalls array on a persisted assistant message. Used by
  // the agent-loop's recovery path so a max_tokens-truncated turn with
  // dangling tool_call_ids gets cleaned in the store (not just in-memory).
  // The next user send rebuilds from the store, so the cleaned version is
  // what the LLM sees — without it the broken turn is re-emitted verbatim.
  updateMessageToolCalls: (storyId, convId, msgId, toolCalls) =>
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) =>
          st.id === storyId
            ? {
                ...st,
                conversations: st.conversations.map((c) =>
                  c.id === convId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === msgId
                            ? { ...m, toolCalls: toolCalls.length > 0 ? toolCalls : undefined }
                            : m,
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

  // Edit-retry rollback state
  retrySnapshot: null,
  setRetrySnapshot: (convId, messages) =>
    set((s) => {
      // Only capture if no snapshot exists or it belongs to a different
      // conversation. Preserves the earliest full message list so a second
      // edit-retry doesn't overwrite the rollback target with truncated data.
      if (s.retrySnapshot && s.retrySnapshot.convId === convId) return s;
      return { retrySnapshot: { convId, messages } };
    }),
  clearRetrySnapshot: () => set({ retrySnapshot: null }),
  restoreRetrySnapshotIfPending: () => {
    const s = get();
    const snap = s.retrySnapshot;
    if (!snap) return;
    // Locate the conversation (convId is globally unique). If it no longer
    // exists (deleted / world closed), just drop the snapshot.
    const world = s.worlds.find((w) =>
      w.stories.some((st) => st.conversations.some((c) => c.id === snap.convId)),
    );
    if (!world) {
      set({ retrySnapshot: null });
      return;
    }
    // Restore messages into store (synchronous) + rewrite session file (async, best-effort).
    s.replaceMessages(snap.convId, snap.messages);
    const drafts = { ...s.conversationDrafts };
    delete drafts[snap.convId];
    set({ retrySnapshot: null, conversationDrafts: drafts });
    rewriteSessionMessages(world.path, snap.convId, messagesToSessionLines(snap.messages)).catch(() => {});
  },

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
  pruneToolResults: false,
  pruneKeepTurns: 3,
  // Max recovery attempts on max_tokens truncation. Default 3, matches the
  // pre-config hardcode; can be tuned per deployment.
  maxRecoveryAttempts: 3,
  setCompressionThreshold: (threshold) => set({ compressionThreshold: threshold }),
  setCompressing: (v) => set({ isCompressing: v }),
  setForceCompress: (v) => set({ forceCompress: v }),
  setPruneToolResults: (v) => set({ pruneToolResults: v }),
  setPruneKeepTurns: (v) => set({ pruneKeepTurns: v }),
  setMaxRecoveryAttempts: (n) => set({ maxRecoveryAttempts: Math.max(0, Math.floor(n)) }),
  markCompressed: (convId, summary, tokenSavings, beforeId) => {
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
                  compressedBeforeId: beforeId ?? null,
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

  addCacheStats: (hitTokens, missTokens, convId?) => {
    const state = get();
    const cid = convId ?? state.activeConversationId;
    const world = state.worlds.find((w) => w.id === state.activeWorldId);
    // Read current values from state for accumulation
    const currentConv = state.worlds
      .find((w) => w.id === state.activeWorldId)
      ?.stories.flatMap((s) => s.conversations)
      .find((c) => c.id === cid);
    const curHit = currentConv?.cacheHitTokens ?? 0;
    const curMiss = currentConv?.cacheMissTokens ?? 0;
    const newHit = curHit + hitTokens;
    const newMiss = curMiss + missTokens;
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) => ({
          ...st,
          conversations: st.conversations.map((c) =>
            c.id === cid
              ? { ...c, cacheHitTokens: newHit, cacheMissTokens: newMiss }
              : c,
          ),
        })),
      })),
    }));
    // Persist to disk (fire-and-forget)
    if (world && cid) {
      invoke("save_session_cache_stats", { worldPath: world.path, sessionId: cid, hitTokens: newHit, missTokens: newMiss }).catch(() => {});
    }
  },

  resetCacheStats: (convId?) => {
    const state = get();
    const cid = convId ?? state.activeConversationId;
    const world = state.worlds.find((w) => w.id === state.activeWorldId);
    set((s) => ({
      worlds: s.worlds.map((w) => ({
        ...w,
        stories: w.stories.map((st) => ({
          ...st,
          conversations: st.conversations.map((c) =>
            c.id === cid
              ? { ...c, cacheHitTokens: 0, cacheMissTokens: 0 }
              : c,
          ),
        })),
      })),
    }));
    if (world && cid) {
      invoke("save_session_cache_stats", { worldPath: world.path, sessionId: cid, hitTokens: 0, missTokens: 0 }).catch(() => {});
    }
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

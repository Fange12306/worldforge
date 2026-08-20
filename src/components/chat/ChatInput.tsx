import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { useStore, type Message, type ToolCall, type UploadedFile } from "@/lib/store";
import { invoke } from "@/lib/api";
import { runAgentLoop, resetPermissions, beginStreamSession, abortActiveStream, isSessionAborted, type AgentMessage } from "@/lib/agent-loop";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { buildModelMessages, applyCompressionToLLMView } from "@/lib/model-context";
import { pruneToolOutputs } from "@/lib/prune-tool-outputs";
import { appendSessionMessage, rewriteSessionMessages, messagesToSessionLines } from "@/lib/session-writer";
import { ArrowUp, Square, X, Paperclip, Loader2 } from "lucide-react";
import { InlinePermission } from "./PermissionDialog";
import { AskUserQuestions } from "./AskUserQuestions";
import { ContextRing } from "./ContextRing";
import type { PermissionChoice, UserQuestion, AskUserResult } from "@/lib/agent-loop";
import type { Entry } from "@/lib/types";
import { useT, getT } from "@/lib/i18n";

export function ChatInput({ storyId }: { storyId: string }) {
  const { t } = useT();
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [permission, setPermission] = useState<null | { toolName: string; details: string; callback: (c: PermissionChoice) => void }>(null);
  const permissionRef = useRef<null | { callback: (c: PermissionChoice) => void }>(null);
  const [askUser, setAskUser] = useState<null | {
    convId: string;
    questions: UserQuestion[];
    callback: (answers: AskUserResult[]) => void;
  }>(null);
  const askUserRef = useRef<null | {
    convId: string;
    questions: UserQuestion[];
    callback: (answers: AskUserResult[]) => void;
  }>(null);
  const [newEntryForm, setNewEntryForm] = useState(false);
  const [newEntryName, setNewEntryName] = useState("");
  const [newEntryType, setNewEntryType] = useState("character");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Per-loop accumulation: each agent loop (one API call) becomes its own
  // assistant message, so the partial content is tracked per loop, not merged
  // across the whole turn.
  const loopTextRef = useRef("");
  const loopThinkingRef = useRef("");
  const loopToolCallsRef = useRef<ToolCall[]>([]);
  const handleSendRef = useRef<() => Promise<void>>(async () => {});

  // Listen for permission requests
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const p = { toolName: d.toolName, details: d.details, callback: d.callback };
      permissionRef.current = p;
      setPermission(p);
    };
    window.addEventListener("worldforge-permission", handler);
    return () => window.removeEventListener("worldforge-permission", handler);
  }, []);

  // Listen for clarification questions (AskUserQuestion tool). The agent loop
  // blocks until the callback is invoked with the user's answers.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const next = {
        convId: useStore.getState().streamingConversationId || "",
        questions: d.questions as UserQuestion[],
        callback: d.callback as (answers: AskUserResult[]) => void,
      };
      // Defensive: if a previous question set is somehow still pending,
      // resolve it as all-skipped so the agent loop never deadlocks.
      const prev = askUserRef.current;
      if (prev && prev !== next) {
        prev.callback(prev.questions.map(() => ({ answer: "", custom: false, skipped: true })));
      }
      askUserRef.current = next;
      setAskUser(next);
    };
    window.addEventListener("worldforge-ask-user", handler);
    return () => window.removeEventListener("worldforge-ask-user", handler);
  }, []);

  // If ChatInput unmounts (settings/detail view replaces the chat) while the
  // agent loop is still waiting on user input, resolve it so the background
  // loop can unwind instead of deadlocking: pending questions → all-skipped,
  // pending permission prompt → deny.
  useEffect(() => {
    return () => {
      const cur = askUserRef.current;
      if (cur) {
        cur.callback(cur.questions.map(() => ({ answer: "", custom: false, skipped: true })));
        askUserRef.current = null;
      }
      const perm = permissionRef.current;
      if (perm) {
        perm.callback("deny");
        permissionRef.current = null;
      }
    };
  }, []);

  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const llmProvider = useStore((s) => s.llmProvider);
  const llmModels = useStore((s) => s.llmModels);
  const providers = useStore((s) => s.providers);
  const activeModel = useStore((s) => s.activeModel);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const addMessage = useStore((s) => s.addMessage);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const isStreaming = useStore((s) => s.isStreaming);
  const streamingConversationId = useStore((s) => s.streamingConversationId);
  const setStreaming = useStore((s) => s.setStreaming);
  const appendStreamText = useStore((s) => s.appendStreamText);
  const appendStreamThinking = useStore((s) => s.appendStreamThinking);
  const addStreamToolCall = useStore((s) => s.addStreamToolCall);
  const updateStreamToolResult = useStore((s) => s.updateStreamToolResult);
  const setIsThinking = useStore((s) => s.setIsThinking);
  const setIsToolRunning = useStore((s) => s.setIsToolRunning);
  const updateMessageToolResult = useStore((s) => s.updateMessageToolResult);
  const clearStreamText = useStore((s) => s.clearStreamText);
  const conversationFiles = useStore((s) => s.conversationFiles);
  const setConversationFiles = useStore((s) => s.setConversationFiles);
  const files = conversationFiles[activeConversationId || ""] || [];
  const setFiles = (f: UploadedFile[] | ((prev: UploadedFile[]) => UploadedFile[])) => {
    if (!activeConversationId) return;
    const prev = conversationFiles[activeConversationId] || [];
    const next = typeof f === "function" ? f(prev) : f;
    setConversationFiles(activeConversationId, next);
  };
  const conversationDrafts = useStore((s) => s.conversationDrafts);
  const setConversationDraft = useStore((s) => s.setConversationDraft);

  const input = conversationDrafts[activeConversationId || ""] || "";
  const isStreamingHere = isStreaming && activeConversationId === streamingConversationId;
  const isStreamingElsewhere = isStreaming && activeConversationId !== streamingConversationId;
  const setInput = (value: string) => {
    if (activeConversationId) setConversationDraft(activeConversationId, value);
  };

  // Reset textarea height when input changes (conversation switch, retry, clear)
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [input]);

  // Retry / edit-retry: replace the whole last turn. Tool results are stored
  // as hidden system messages, so removing only the assistant response leaves
  // stale context in the next request. We truncate to before the last user
  // message, then either resend it immediately (retry) or put it back in the
  // input for editing (edit-retry).
  const truncateForRetry = useCallback(async (fallbackContent: string, captureSnapshot = false) => {
    const w = useStore.getState().worlds.find((x) => x.id === activeWorldId);
    const s = w?.stories.find((x) => x.id === storyId);
    const c = s?.conversations.find((x) => x.id === activeConversationId);
    if (!w || !c) return false;

    const msgs = [...c.messages];
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const retryContent = lastUserIdx >= 0 ? msgs[lastUserIdx].content : fallbackContent;
    if (!retryContent) return false;

    // Edit-retry captures a rollback snapshot of the full message list before
    // truncation, so navigating away without sending can restore the original
    // conversation. Plain retry (auto-send) does not enter this editing state.
    if (captureSnapshot) {
      useStore.getState().setRetrySnapshot(activeConversationId!, msgs);
    }

    const nextMessages = lastUserIdx >= 0 ? msgs.slice(0, lastUserIdx) : msgs;
    useStore.setState((prev) => ({
      worlds: prev.worlds.map((ww) => ww.id === activeWorldId ? {
        ...ww,
        stories: ww.stories.map((ss) => ss.id === storyId ? {
          ...ss,
          conversations: ss.conversations.map((cc) => cc.id === activeConversationId ? {
            ...cc,
            messages: nextMessages,
          } : cc),
        } : ss),
      } : ww),
    }));
    try {
      await rewriteSessionMessages(w.path, c.id, messagesToSessionLines(nextMessages));
    } catch {}

    clearStreamText();
    setConversationDraft(activeConversationId!, retryContent);
    return true;
  }, [activeWorldId, storyId, activeConversationId, clearStreamText, setConversationDraft]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const fallbackContent = (e as CustomEvent).detail.content as string;
      if (isStreaming) return;
      const ok = await truncateForRetry(fallbackContent, false);
      if (!ok) return;
      handleSendRef.current();
    };
    window.addEventListener("worldforge-retry", handler);
    return () => window.removeEventListener("worldforge-retry", handler);
  }, [isStreaming, truncateForRetry]);

  // Edit-retry: truncate + put the original text back into the input, but do
  // NOT auto-send — the user edits it first, then sends manually. Captures a
  // rollback snapshot so navigating away without sending restores the original
  // conversation.
  useEffect(() => {
    const handler = async (e: Event) => {
      const fallbackContent = (e as CustomEvent).detail.content as string;
      if (isStreaming) return;
      await truncateForRetry(fallbackContent, true);
      // Focus the input so the user can start editing immediately.
      textareaRef.current?.focus();
    };
    window.addEventListener("worldforge-edit-retry", handler);
    return () => window.removeEventListener("worldforge-edit-retry", handler);
  }, [isStreaming, truncateForRetry, textareaRef]);

  // Rollback guard: if the user entered edit-retry but navigates away without
  // sending, restore the pre-edit conversation. This covers both switching to
  // a different conversation (snapshot.convId !== activeConversationId) and
  // ChatInput unmounting (settings/detail view replacing ChatLayout).
  useEffect(() => {
    const snap = useStore.getState().retrySnapshot;
    if (snap && snap.convId !== activeConversationId) {
      useStore.getState().restoreRetrySnapshotIfPending();
    }
    return () => useStore.getState().restoreRetrySnapshotIfPending();
  }, [activeConversationId]);

  // Listen for command palette selections
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail.text as string;
      const el = textareaRef.current;
      if (!el) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeSetter?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (text === "/new-entry" || text === "/stats" || text === "/outline" || text === "/new-conv") {
        setTimeout(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), 50);
      }
    };
    window.addEventListener("worldforge-command", handler);
    return () => window.removeEventListener("worldforge-command", handler);
  }, []);

  const world = worlds.find((w) => w.id === activeWorldId);
  const story = world?.stories.find((s) => s.id === storyId);

  const handleFilePick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", async () => {
      const selected = input.files;
      if (!selected || selected.length === 0) return;
      const picked = Array.from(selected);
      setPendingUploads(picked.map((f) => f.name));
      setUploadErrors([]);
      const newFiles: UploadedFile[] = [];
      const errors: string[] = [];
      for (const f of picked) {
        try {
          if (f.name.toLowerCase().endsWith(".pdf")) {
            // PDF: extract text via Rust backend
            const buf = await f.arrayBuffer();
            const text = await invoke<string>("pdf_to_text", { bytes: Array.from(new Uint8Array(buf)) });
            if (text) newFiles.push({ name: f.name, storedName: `${f.name}.txt`, content: text });
            else errors.push(`${f.name}: 未提取到文本`);
          } else {
            const text = await f.text();
            if (text) newFiles.push({ name: f.name, storedName: f.name, content: text });
            else errors.push(`${f.name}: 文件为空`);
          }
        } catch (e) {
          errors.push(`${f.name}: ${String(e)}`);
        }
      }
      if (newFiles.length > 0) setFiles((prev) => [...prev, ...newFiles]);
      setUploadErrors(errors);
      setPendingUploads([]);
    }, { once: true });
    input.click();
  };

  const handleSend = async () => {
    // Read directly from store so retry handler sees the updated draft immediately
    const text = (useStore.getState().conversationDrafts[activeConversationId!] || input).trim();
    if ((!text && files.length === 0) || isStreaming || !world || !story) return;
    const convId = activeConversationId!; // Lock to this conversation for the entire send

    // Sending commits the edit — clear the rollback snapshot so navigating away
    // later does not restore the pre-edit conversation.
    useStore.getState().clearRetrySnapshot();

    // ── Handle slash commands ──
    const persistCmd = (cmd: string, result: string) => {
      addMessage(storyId, { role: "user", content: cmd }, convId);
      addMessage(storyId, { role: "assistant", content: result }, convId);
      appendSessionMessage(world.path, convId, { type: "user", content: cmd, timestamp: new Date().toISOString() }).catch(() => {});
      appendSessionMessage(world.path, convId, { type: "assistant", content: result, timestamp: new Date().toISOString() }).catch(() => {});
    };
    if (text.startsWith("/stats")) {
      let stats = `${t.chat.statsTitle}:\n`;
      try {
        const entries = await invoke<Entry[]>("list_entries", { worldPath: world.path });
        const types: Record<string, number> = {};
        for (const e of entries) types[e.type] = (types[e.type] || 0) + 1;
        stats += `${t.chat.statsTotal(entries.length)}\n`;
        stats += Object.entries(types).map(([type, c]) => `${type}: ${c}`).join("\n");
      } catch { stats = t.chat.statsFailed; }
      persistCmd(text, stats);
      setInput(""); return;
    }
    if (text.startsWith("/desc ")) {
      const name = text.slice(6).trim();
      try {
        const entries = await invoke<Entry[]>("list_entries", { worldPath: world.path });
        const matched = entries.find((x) => x.name.includes(name) || x.id.includes(name));
        if (!matched) { persistCmd(text, t.chat.entryNotFound(name)); setInput(""); return; }
        const e = await invoke<Entry>("read_entry", { worldPath: world.path, entryId: matched.id });
        const lines = [`**${e.name}** [${e.type}]`];
        if (e.properties && Object.keys(e.properties).length > 0) {
          for (const [k, v] of Object.entries(e.properties)) lines.push(`- ${k}: ${v}`);
        }
        if (e.body) {
          const body = e.body.length > 300 ? e.body.slice(0, 300) + "..." : e.body;
          lines.push("");
          lines.push(body);
        }
        if (e.relationships?.length) {
          lines.push("");
          lines.push(t.chat.relations + ": " + e.relationships.map((r) => `${r.relation} → ${r.targetId}`).join(", "));
        }
        persistCmd(text, lines.join("\n"));
      } catch { persistCmd(text, t.chat.queryFailed); }
      setInput(""); return;
    }
    if (text.startsWith("/outline")) {
      try {
        const chapters = await invoke<Array<{ order: number; title: string; status: string; summary: string; has_body: boolean }>>("read_outline", { worldPath: world.path, storyId });
        if (chapters.length === 0) { persistCmd(text, t.chat.outlineEmpty); setInput(""); return; }
        const done = chapters.filter((c) => c.status === "done" || c.has_body).length;
        const lines = [`**${t.chat.outlineOverview}** — ${t.chat.chaptersDone(done, chapters.length)}`, ""];
        for (const ch of chapters) {
          const icon = ch.status === "done" ? "✓" : ch.status === "drafting" ? "✎" : "○";
          const info = ch.has_body ? `${ch.summary || t.chat.noSummary}` : t.chat.outlineOnly;
          lines.push(`${icon} Ch${ch.order} **${ch.title}** — ${info}`);
        }
        persistCmd(text, lines.join("\n"));
      } catch { persistCmd(text, t.chat.outlineReadFailed); }
      setInput(""); return;
    }
    if (text.startsWith("/new-conv")) {
      if (!world || !story) return;
      const convId = useStore.getState().createConversation(storyId);
      // Persist story meta with new conversation
      const convs = story.conversations.map((c: { id: string; title: string }) => ({ id: c.id, title: c.title, created_at: new Date().toISOString() }));
      convs.push({ id: convId, title: t.sidebar.newConvTitle(convs.length + 1), created_at: new Date().toISOString() });
      invoke("save_story_meta", { worldPath: world.path, story: { id: story.id, title: story.title, status: story.status, conversations: convs, created_at: new Date().toISOString() } }).catch(() => {});
      useStore.getState().setActiveConversation(convId);
      setInput(""); return;
    }
    if (text.startsWith("/new-entry")) {
      setNewEntryForm(true);
      setInput(""); return;
    }
    if (text.startsWith("/write") || text.startsWith("/brainstorm") || text.startsWith("/rewrite")) {
      // Pass through to Agent — handled by LLM with tools
    }

    if (!llmProvider || !activeModel) {
      addMessage(storyId, { role: "assistant", content: t.chat.configureLlm }, convId);
      return;
    }
    setInput("");
    const currentFiles = [...files];
    setFiles([]);

    // ── Step 1: Build clean user message (chips in UI, refs in store/JSONL) ──
    let userContent = text;
    if (currentFiles.length > 0) {
      const fileRefs = currentFiles.map((f) => `[文件: ${f.name}]`).join(" ");
      userContent = text ? `${fileRefs}\n${text}` : fileRefs;
      // Persist files to disk (per-conversation)
      for (const f of currentFiles) {
        try {
          await invoke("write_file", { worldPath: world.path, fileName: f.storedName, content: f.content, conversationId: convId });
        } catch {}
      }
    }
    addMessage(storyId, { role: "user", content: userContent }, convId);
    // Persist user message to session JSONL
    appendSessionMessage(world.path, convId, { type: "user", content: userContent, timestamp: new Date().toISOString() }).catch(() => {});

    let entries: Entry[] = [];
    try { entries = await invoke<Entry[]>("list_entries", { worldPath: world.path }); } catch {}

    const customPrompt = await invoke<string>("load_custom_prompt").catch(() => "");
    const worldPrompt = await invoke<string>("load_world_prompt", { worldPath: world.path }).catch(() => "");
    const lang = useStore.getState().language;
    const systemPrompt = buildSystemPrompt(world.name, story.title, entries, undefined, customPrompt, worldPrompt, lang);
    const latestConv = useStore.getState().worlds
      .find((w) => w.id === activeWorldId)
      ?.stories.find((s) => s.id === storyId)
      ?.conversations.find((c) => c.id === activeConversationId);
    // Apply compression to the LLM-bound view BEFORE buildModelMessages so
    // the model never re-sees messages that were already collapsed into the
    // summary on a previous turn. The store itself is untouched: the user can
    // still scroll up through the original thinking / tool calls. The
    // boundary id is a stable Message id set by the most recent in-loop
    // compression (see agent-loop.ts). If the boundary is missing (e.g.,
    // messages were edited / deleted), we fall back to the full history
    // rather than risk dropping live context.
    const viewForLLM = applyCompressionToLLMView(latestConv?.messages ?? [], latestConv);
    const history: AgentMessage[] = buildModelMessages(viewForLLM);
    // Prune old tool results if enabled (reduces context usage between user turns)
    const { pruneToolResults, pruneKeepTurns } = useStore.getState();
    const prunedHistory = pruneToolResults ? pruneToolOutputs(history, pruneKeepTurns) : history;

    // ── Step 2: Inject file references into LLM context only (UI stays clean) ──
    if (currentFiles.length > 0) {
      const fileBlocks = currentFiles.map((f) =>
        `[上传文件: ${f.name}]\n路径: uploads/${convId}/${f.storedName}\n字符数: ${f.content.length}\n如需阅读内容，使用 FileRead(path="uploads/${convId}/${f.storedName}", offset=0, limit=20000) 分页读取。不要假设文件内容已自动进入上下文。`,
      );
      // Inject before the last user message in history
      const lastUser = history.filter(m => m.role === "user").pop();
      if (lastUser) {
        lastUser.content = fileBlocks.join("\n\n") + "\n\n" + lastUser.content;
      }
    }

    setStreaming(true, convId);
    clearStreamText();
    const session = beginStreamSession();
    resetPermissions(convId);
    loopTextRef.current = "";
    loopThinkingRef.current = "";
    loopToolCallsRef.current = [];

    // Persist the current loop's assistant message and reset live-stream state.
    //
    // The agent loop fires onLoopEnd only AFTER all tool results are in, so
    // by the time this runs `s.streamToolCalls` has the tool calls WITH their
    // results. The refs (`loopToolCallsRef.current`) are only useful for the
    // very first paint where streaming starts before any state is committed;
    // they are empty of `result`. Prefer the live store.
    const flushLoop = (opts?: { stopped?: boolean }) => {
      const s = useStore.getState();
      const text = opts?.stopped ? s.streamText : s.streamText || loopTextRef.current;
      const thinking = (opts?.stopped ? s.streamThinking : s.streamThinking || loopThinkingRef.current).trim() || undefined;
      // Prefer the live store — it has the results. Refs are a fallback for the
      // stop path or for the unusual case where the ref was populated but the
      // store lag hasn't caught up.
      const liveTc = s.streamToolCalls;
      const refTc = loopToolCallsRef.current;
      const tc = liveTc.length > 0 ? liveTc : (refTc.length > 0 ? refTc : []);
      const content = opts?.stopped ? `${text} ${t.chat.stopped}`.trim() : text;
      if (content.trim() || thinking || tc.length > 0) {
        addMessage(storyId, {
          role: "assistant",
          content,
          thinking,
          toolCalls: tc.length > 0 ? [...tc] : undefined,
        }, convId);
        // Persist the toolCalls inline on the jsonl assistant line so reload
        // can reconstruct them without depending on the interleaved
        // `type: tool_use` lines (which are written immediately on onToolUse
        // and may end up reordered relative to the assistant).
        appendSessionMessage(world.path, convId, {
          type: "assistant",
          content,
          thinking: thinking || null,
          toolCalls: tc.length > 0 ? tc.map((c) => ({ id: c.id, name: c.name, input: c.input, result: c.result })) : undefined,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
      loopTextRef.current = "";
      loopThinkingRef.current = "";
      loopToolCallsRef.current = [];
      clearStreamText();
    };

    try {
      const currentModelConfig = llmModels.find((m) => m.name === activeModel);
      // `thinkingDisabled` is the explicit "off" switch and wins over
      // `reasoningEffort`. Collapse the two into a single effective value the
      // backend can act on (the openai / deepseek / none dispatch in api_proxy
      // only looks at reasoning_effort to decide what to send).
      const rawEffort = currentModelConfig?.reasoningEffort;
      const effectiveEffort = currentModelConfig?.thinkingDisabled ? "disabled" : rawEffort;
      const maxTokens = currentModelConfig?.maxTokens;
      const currentProvider = providers.find((p) => p.id === currentModelConfig?.providerId);
      const thinkingStyle = currentProvider?.thinkingStyle;
      const baseUrl = currentProvider?.baseUrl;
      const thinkingOnValue = currentProvider?.thinkingOnValue;

      await runAgentLoop(world.path, systemPrompt, prunedHistory, {
        onTextDelta: (t) => { if (isSessionAborted(session)) return; appendStreamText(t); loopTextRef.current += t;
          setIsThinking(false); setIsToolRunning(false);
        },
        onThinkingDelta: (t) => { if (isSessionAborted(session)) return; loopThinkingRef.current += t; appendStreamThinking(t);
          setIsThinking(true); setIsToolRunning(false);
        },
        onThinkingDone: () => {},
        onToolUse: (id, name, input) => {
          if (isSessionAborted(session)) return;
          const tc: ToolCall = { id, name, input: input || {}, result: "" };
          loopToolCallsRef.current = [...loopToolCallsRef.current, tc];
          addStreamToolCall(tc);
          appendSessionMessage(world.path, convId, { type: "tool_use", id, tool: name, input: input || {}, timestamp: new Date().toISOString() }).catch(() => {});
          setIsThinking(false); setIsToolRunning(true);
        },
        onToolResult: (result, toolName) => {
          if (isSessionAborted(session)) return;
          // Stream the result into the matching tool call. Three writes, all
          // keyed by toolUseId:
          //   1. streamToolCalls  — live UI bubble (read by flushLoop on the
          //                          moved onLoopEnd so the persisted message
          //                          has results on the first write)
          //   2. Message.toolCalls — in-store copy for buildModelMessages next turn
          //   3. jsonl tool_result — additive, deduped on reload
          updateStreamToolResult(result.toolUseId, result.content);
          updateMessageToolResult(storyId, convId, result.toolUseId, result.content);
          appendSessionMessage(world.path, convId, { type: "tool_result", tool: toolName || result.toolName || "", tool_use_id: result.toolUseId, output: result.content, timestamp: new Date().toISOString() }).catch(() => {});
          if (toolName === "OutlineWrite" || toolName === "EntryWrite" || toolName === "Relation") {
            window.dispatchEvent(new CustomEvent("worldforge-data-changed"));
          }
        },
        // Loop boundary: stream + all tool results for this loop are in —
        // persist the message with its full toolCall results and reset the
        // live-stream state for the next loop. Fires AFTER tool execution
        // (not before), so the first write to the store has the final shape.
        onLoopEnd: () => {
          if (isSessionAborted(session)) return;
          flushLoop();
        },
        onComplete: () => {
          if (isSessionAborted(session)) return; // Already saved by stop button
          flushLoop(); // safety net — the final loop was already flushed at onLoopEnd
          setStreaming(false);
          clearStreamText();
        },
        onError: (error) => {
          // A stop already saved the partial turn — never clobber it with an
          // error message after the fact.
          if (isSessionAborted(session)) return;
          flushLoop();
          setStreaming(false);
          const msg = error.includes("发送请求") || error.includes("error sending request") || error.includes("连接")
            ? t.chat.networkError
            : error.includes("API Key") || error.includes("未配置")
              ? t.chat.apiKeyError
              : `Error: ${error}`;
          addMessage(storyId, { role: "assistant", content: msg }, convId);
          if (world && convId) {
            appendSessionMessage(world.path, convId, { type: "assistant", content: msg, thinking: null, timestamp: new Date().toISOString() }).catch(() => {});
          }
          clearStreamText();
        },
        // Recovery-path cleanup: the agent loop dropped a broken tool_call
        // from a max_tokens-truncated turn (see agent-loop.ts). Mirror the
        // change in the store so the next user send — which rebuilds the
        // LLM view from the store via buildModelMessages — doesn't
        // re-emit the dangling tool_call_id. Match by content + the set
        // of dropped tool_call_ids (the latter distinguishes two assistant
        // turns that happen to have the same text).
        onAssistantMessageAdjusted: (match, updated) => {
          if (isSessionAborted(session)) return;
          const latestConv = useStore.getState().worlds
            .find((w) => w.id === activeWorldId)
            ?.stories.find((s) => s.id === storyId)
            ?.conversations.find((c) => c.id === convId);
          if (!latestConv) return;
          const targetIds = new Set(match.toolCallIds);
          const matchIds = [...targetIds].sort().join(",");
          // Walk from the most recent assistant turn backwards — the
          // recovery adjustment always targets the just-flushed turn.
          for (let i = latestConv.messages.length - 1; i >= 0; i--) {
            const m = latestConv.messages[i];
            if (m.role !== "assistant") continue;
            if (m.content !== match.content) continue;
            const mIds = (m.toolCalls ?? []).map((tc) => tc.id).sort().join(",");
            if (mIds !== matchIds) continue;
            useStore.getState().updateMessageToolCalls(storyId, convId, m.id, updated.toolCalls);
            // Also rewrite the jsonl assistant line so a future reload
            // doesn't reconstruct the broken toolCalls from the on-disk
            // tool_use / tool_result pair lines. (load_session also
            // filters dangling tool_use defensively, so this is belt-
            // and-suspenders.)
            if (world) {
              const newLines = messagesToSessionLines(latestConv.messages.map((mm) =>
                mm.id === m.id ? { ...mm, toolCalls: updated.toolCalls.length > 0 ? updated.toolCalls : undefined } : mm,
              ));
              rewriteSessionMessages(world.path, convId, newLines).catch(() => {});
            }
            break;
          }
        },
      }, llmProvider, activeModel, storyId, effectiveEffort, convId, maxTokens, session, thinkingStyle, thinkingOnValue, baseUrl);
    } catch (e: any) {
      setStreaming(false);
      if (!isSessionAborted(session)) addMessage(storyId, { role: "assistant", content: `Error: ${e}` }, convId);
      clearStreamText();
    }
  };
  handleSendRef.current = handleSend;

  // Called when the clarification panel finishes (all questions answered or
  // skipped/cancelled). Hands the answers back to the blocked agent loop.
  const handleAskUserDone = (answers: AskUserResult[]) => {
    const cur = askUserRef.current;
    if (cur) {
      cur.callback(answers);
      askUserRef.current = null;
    }
    setAskUser(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const canSend = (input.trim().length > 0 || files.length > 0) && !isStreaming;

  return (
    <div className="flex-shrink-0 px-4 py-2.5">
      <div className="max-w-3xl mx-auto">
        {/* Inline permission above input */}
        {permission && (
          <InlinePermission
            toolName={permission.toolName}
            details={permission.details}
            onChoose={(c) => { permission.callback(c); permissionRef.current = null; setPermission(null); }}
            onDismiss={() => { permission.callback("deny"); permissionRef.current = null; setPermission(null); }}
          />
        )}
        {/* New entry form */}
        {newEntryForm && (
          <div className="mb-2 bg-surface-800 rounded-2xl px-4 py-3 space-y-2 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="text-[0.688rem] text-ink-muted">{t.chat.newEntry}</span>
              <button onClick={() => { setNewEntryForm(false); setNewEntryName(""); }} className="ml-auto p-0.5 rounded text-ink-muted hover:text-ink"><X className="w-3 h-3" /></button>
            </div>
            <input
              value={newEntryName}
              onChange={(e) => setNewEntryName(e.target.value)}
              placeholder={t.chat.newEntryName}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("nf-type")?.focus(); }}
              className="w-full h-8 text-sm bg-surface-700 rounded-lg px-3 text-ink outline-none placeholder:text-ink-muted"
            />
            <div className="flex gap-2">
              <select
                id="nf-type"
                value={newEntryType}
                onChange={(e) => setNewEntryType(e.target.value)}
                className="flex-1 h-8 text-[0.688rem] bg-surface-700 rounded-lg px-3 text-ink outline-none"
              >
                {Object.entries(t.entryTypes).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  if (!newEntryName.trim()) return;
                  const typeLabel = t.entryTypes[newEntryType as keyof typeof t.entryTypes] || newEntryType;
                  try {
                    const e = await invoke<Entry>("create_entry", { worldPath: world!.path, name: newEntryName.trim(), entryType: newEntryType });
                    addMessage(storyId, { role: "user", content: `/new-entry ${newEntryName} (${typeLabel})` }, activeConversationId!);
                    addMessage(storyId, { role: "assistant", content: `${t.chat.entryCreated(e.name)} [${e.type}]` }, activeConversationId!);
                    appendSessionMessage(world!.path, activeConversationId!, { type: "user", content: `/new-entry ${newEntryName}`, timestamp: new Date().toISOString() }).catch(() => {});
                    appendSessionMessage(world!.path, activeConversationId!, { type: "assistant", content: `${t.chat.entryCreated(e.name)} [${e.type}]`, timestamp: new Date().toISOString() }).catch(() => {});
                  } catch (err: any) {
                    addMessage(storyId, { role: "assistant", content: t.chat.createFailed(err) });
                  }
                  setNewEntryForm(false);
                  setNewEntryName("");
                }}
                disabled={!newEntryName.trim()}
                className="px-4 h-8 text-[0.688rem] rounded-lg bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                {t.chat.newEntryCreate}
              </button>
            </div>
          </div>
        )}
        {/* File chips */}
        {(files.length > 0 || pendingUploads.length > 0 || uploadErrors.length > 0) && (
          <div className="flex flex-wrap gap-1 mb-2">
            {pendingUploads.map((name, i) => (
              <span key={`pending-${i}`} className="flex items-center gap-1 px-2 py-0.5 text-[0.688rem] bg-surface-700 text-ink-muted rounded-full">
                <Loader2 className="w-3 h-3 animate-spin" />
                {name}
              </span>
            ))}
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-0.5 text-[0.688rem] bg-surface-700 text-ink-secondary rounded-full">
                <Paperclip className="w-3 h-3" />
                {f.name}
                <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="ml-0.5 hover:text-error">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {uploadErrors.map((error, i) => (
              <span key={`error-${i}`} className="flex items-center gap-1 px-2 py-0.5 text-[0.688rem] bg-error/10 text-error rounded-full" title={error}>
                <X className="w-3 h-3" />
                {error}
              </span>
            ))}
          </div>
        )}
        {/* Clarification questions — pops up from the input box, one at a time */}
        {askUser && isStreamingHere && askUser.convId === activeConversationId && (
          <AskUserQuestions
            questions={askUser.questions}
            onSubmit={handleAskUserDone}
          />
        )}
        <div className="bg-surface-800 rounded-2xl px-4 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = textareaRef.current;
              if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
            }}
            onKeyDown={handleKeyDown}
            placeholder={t.chat.placeholder}
            rows={1}
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted resize-none outline-none max-h-[200px] leading-6"
          />
          <div className="flex items-center gap-1 mt-0.5">
            <button onClick={handleFilePick} className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-700 transition-colors" title={t.chat.uploadFile}>
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <div className="flex-1" />
            <ContextRing />
            {llmModels.length >= 1 && (
              <select value={mode} onChange={(e) => setMode(e.target.value as "ask" | "edit")}
                className="text-[0.688rem] bg-transparent text-ink-muted py-0 appearance-none outline-none text-center cursor-pointer"
              >
                <option value="ask">{t.chat.modeAsk}</option>
                <option value="edit">{t.chat.modeEdit}</option>
              </select>
            )}
            {llmModels.length >= 1 && (
              <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)}
                className="text-[0.688rem] bg-transparent text-ink-muted py-0 appearance-none outline-none cursor-pointer text-center truncate max-w-[220px]"
              >
                {llmModels
                  .filter((m) => m.providerId && m.providerId === llmProvider)
                  .map((m) => <option key={m.name} value={m.name}>{m.alias || m.name}</option>)}
              </select>
            )}
            {isStreamingHere ? (
              <button onClick={() => {
                  abortActiveStream();
                  const scid = useStore.getState().streamingConversationId;
                  if (scid) invoke("cancel_stream", { conversationId: scid }).catch(() => {});
                  if (scid !== activeConversationId) return;
                  // Persist the current (incomplete) loop with the "已取消"
                  // suffix. Completed loops were already flushed at their own
                  // onLoopEnd. The store's live stream state is the fallback
                  // when the refs are empty (ChatInput remounted mid-turn).
                  const s = useStore.getState();
                  const text = loopTextRef.current || s.streamText;
                  const thinking = (loopThinkingRef.current || s.streamThinking).trim() || undefined;
                  const allTc = loopToolCallsRef.current.length > 0 ? loopToolCallsRef.current : s.streamToolCalls;
                  // Critical: drop any tool_call whose result is empty.
                  // Abort can land between onToolUse and onToolResult, leaving
                  // a toolCall with `result: ""` (the default set when the
                  // tool_use event first arrived). Persisting it would
                  // (a) emit a `role: "tool", content: ""` on the next send,
                  // and (b) put a dangling tool_use line in the jsonl that
                  // looks like a real tool call. Both are exactly the
                  // "我编辑一下 XX:" bug — the model has no good way to
                  // handle an empty tool result and tends to just announce
                  // intent in text instead of re-issuing the call. Only
                  // completed tool calls (non-empty result) are kept.
                  const completedTc = allTc.filter(
                    (c) => typeof c.result === "string" && c.result.length > 0,
                  );
                  const finalContent = `${text} ${t.chat.stopped}`.trim();
                  if (finalContent.trim() || thinking || completedTc.length > 0) {
                    if (scid) addMessage(storyId, {
                      role: "assistant",
                      content: finalContent,
                      thinking,
                      toolCalls: completedTc.length > 0 ? [...completedTc] : undefined,
                    }, scid);
                    if (world && scid) appendSessionMessage(world.path, scid, { type: "assistant", content: finalContent, thinking: thinking || null, timestamp: new Date().toISOString() }).catch(() => {});
                  }
                  // Auto-deny any pending permission prompt so a blocked agent
                  // loop can unwind instead of hanging after the stop.
                  if (permissionRef.current) {
                    permissionRef.current.callback("deny");
                    permissionRef.current = null;
                    setPermission(null);
                  }
                  loopTextRef.current = "";
                  loopThinkingRef.current = "";
                  loopToolCallsRef.current = [];
                  setStreaming(false);
                  clearStreamText();
                }}
                className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-lg bg-surface-700 text-ink-muted hover:text-error hover:bg-surface-600 transition-colors">
                <Square className="w-3 h-3" fill="currentColor" />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!canSend}
                title={isStreamingElsewhere ? t.chat.anotherStreaming : undefined}
                className={`flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${canSend ? "text-ink-secondary hover:text-ink hover:bg-surface-700" : "text-ink-muted"}`}>
                {isStreamingElsewhere ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

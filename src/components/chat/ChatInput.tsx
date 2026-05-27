import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { useStore, type Message, type ToolCall, type TimelineBlock } from "@/lib/store";
import { invoke } from "@/lib/api";
import { runAgentLoop, resetPermissions, type AgentMessage } from "@/lib/agent-loop";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { buildModelMessages } from "@/lib/model-context";
import { appendSessionMessage, rewriteSessionMessages } from "@/lib/session-writer";
import { ArrowUp, Square, X, Paperclip, Loader2 } from "lucide-react";
import { InlinePermission } from "./PermissionDialog";
import { ContextRing } from "./ContextRing";
import type { PermissionChoice } from "@/lib/agent-loop";
import type { Entry } from "@/lib/types";
import { useT, getT } from "@/lib/i18n";

type UploadedFile = { name: string; storedName: string; content: string };

function toSessionMessages(messages: Message[]) {
  return messages.map((message) => {
    const timestamp = new Date(message.timestamp || Date.now()).toISOString();
    if (message.role === "assistant") {
      return {
        type: "assistant",
        content: message.content,
        thinking: message.thinking || null,
        timestamp,
      };
    }
    if (message.role === "system") {
      return {
        type: "system",
        content: message.content,
        timestamp,
      };
    }
    return {
      type: "user",
      content: message.content,
      timestamp,
    };
  });
}

export function ChatInput({ storyId }: { storyId: string }) {
  const { t } = useT();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [permission, setPermission] = useState<null | { toolName: string; details: string; callback: (c: PermissionChoice) => void }>(null);
  const [newEntryForm, setNewEntryForm] = useState(false);
  const [newEntryName, setNewEntryName] = useState("");
  const [newEntryType, setNewEntryType] = useState("character");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef(false);
  const streamStateRef = useRef({ text: "", thinking: "", toolCalls: [] as ToolCall[] });
  const turnTextRef = useRef("");
  const turnThinkingRef = useRef("");
  const turnToolCallsRef = useRef<ToolCall[]>([]);
  const handleSendRef = useRef<() => Promise<void>>(async () => {});

  // Listen for permission requests
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setPermission({ toolName: d.toolName, details: d.details, callback: d.callback });
    };
    window.addEventListener("worldforge-permission", handler);
    return () => window.removeEventListener("worldforge-permission", handler);
  }, []);

  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const llmProvider = useStore((s) => s.llmProvider);
  const llmModels = useStore((s) => s.llmModels);
  const activeModel = useStore((s) => s.activeModel);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const addMessage = useStore((s) => s.addMessage);
  const isStreaming = useStore((s) => s.isStreaming);
  const streamingConversationId = useStore((s) => s.streamingConversationId);
  const setStreaming = useStore((s) => s.setStreaming);
  const appendStreamText = useStore((s) => s.appendStreamText);
  const appendStreamThinking = useStore((s) => s.appendStreamThinking);
  const addStreamToolCall = useStore((s) => s.addStreamToolCall);
  const setIsThinking = useStore((s) => s.setIsThinking);
  const setIsToolRunning = useStore((s) => s.setIsToolRunning);
  const updateStreamToolResult = useStore((s) => s.updateStreamToolResult);
  const clearStreamText = useStore((s) => s.clearStreamText);
  const conversationDrafts = useStore((s) => s.conversationDrafts);
  const setConversationDraft = useStore((s) => s.setConversationDraft);

  const input = conversationDrafts[activeConversationId || ""] || "";
  const isStreamingHere = isStreaming && activeConversationId === streamingConversationId;
  const isStreamingElsewhere = isStreaming && activeConversationId !== streamingConversationId;
  const setInput = (value: string) => {
    if (activeConversationId) setConversationDraft(activeConversationId, value);
  };

  // Retry: replace the whole last turn. Tool results are stored as hidden
  // system messages, so removing only the assistant response leaves stale
  // context in the next request.
  useEffect(() => {
    const handler = async (e: Event) => {
      const fallbackContent = (e as CustomEvent).detail.content as string;
      if (isStreaming) return;
      const w = useStore.getState().worlds.find((x) => x.id === activeWorldId);
      const s = w?.stories.find((x) => x.id === storyId);
      const c = s?.conversations.find((x) => x.id === activeConversationId);
      if (!w || !c) return;

      const msgs = [...c.messages];
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        if (msgs[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      const retryContent = lastUserIdx >= 0 ? msgs[lastUserIdx].content : fallbackContent;
      if (!retryContent) return;

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
        await rewriteSessionMessages(w.path, c.id, toSessionMessages(nextMessages));
      } catch {}

      clearStreamText();
      setConversationDraft(activeConversationId!, retryContent);
      handleSendRef.current();
    };
    window.addEventListener("worldforge-retry", handler);
    return () => window.removeEventListener("worldforge-retry", handler);
  }, [isStreaming, activeWorldId, storyId, activeConversationId, clearStreamText, setConversationDraft]);

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
    const history: AgentMessage[] = buildModelMessages(latestConv?.messages ?? []);

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
    abortRef.current = false;
    resetPermissions(convId);
    let finalContent = "";
    let thinkingContent = "";
    turnTextRef.current = "";
    turnThinkingRef.current = "";
    turnToolCallsRef.current = [];
    const toolCalls: ToolCall[] = [];
    const timeline: TimelineBlock[] = [];
    let prevBlock: TimelineBlock | null = null;
    streamStateRef.current = { text: "", thinking: "", toolCalls: [] };

    const flushTurnText = () => {
      const text = turnTextRef.current;
      const thinking = turnThinkingRef.current.trim() || undefined;
      const tc = turnToolCallsRef.current;
      if (text.trim() || thinking) {
        addMessage(storyId, {
          role: "assistant",
          content: text,
          thinking,
          toolCalls: tc.length > 0 ? [...tc] : undefined,
        }, convId);
        appendSessionMessage(world.path, convId, { type: "assistant", content: text, thinking: thinking || null, timestamp: new Date().toISOString() }).catch(() => {});
      }
      turnTextRef.current = "";
      turnThinkingRef.current = "";
      turnToolCallsRef.current = [];
    };

    try {
      const currentModelConfig = llmModels.find((m) => m.name === activeModel);
      const reasoningEffort = currentModelConfig?.reasoningEffort;
      const maxTokens = currentModelConfig?.maxTokens;

      await runAgentLoop(world.path, systemPrompt, history, {
        onTextDelta: (t) => { if (abortRef.current) return; appendStreamText(t); finalContent += t; turnTextRef.current += t; streamStateRef.current.text = finalContent;
          setIsThinking(false); setIsToolRunning(false);
          if (prevBlock?.type === "text") { prevBlock.text += t; }
          else { const b: TimelineBlock = { type: "text", text: t }; timeline.push(b); prevBlock = b; }
        },
        onThinkingDelta: (t) => { if (abortRef.current) return; thinkingContent += t; turnThinkingRef.current += t; appendStreamThinking(t); streamStateRef.current.thinking = thinkingContent;
          setIsThinking(true); setIsToolRunning(false);
          if (prevBlock?.type === "thinking") { prevBlock.text += t; }
          else { const b: TimelineBlock = { type: "thinking", text: t }; timeline.push(b); prevBlock = b; }
        },
        onThinkingDone: () => {},
        onToolUse: (id, name, input) => {
          if (abortRef.current) return;
          const tc: ToolCall = { id, name, input: input || {}, result: "" };
          toolCalls.push(tc);
          turnToolCallsRef.current = [...turnToolCallsRef.current, tc];
          streamStateRef.current.toolCalls = [...toolCalls];
          addStreamToolCall(tc);
          appendSessionMessage(world.path, convId, { type: "tool_use", tool: name, input: input || {}, timestamp: new Date().toISOString() }).catch(() => {});
          setIsThinking(false); setIsToolRunning(true);
          const b: TimelineBlock = { type: "tool", call: tc }; timeline.push(b); prevBlock = b;
        },
        onToolResult: (result, toolName) => {
          if (abortRef.current) return;
          let tc = toolCalls.find((c) => c.id === result.toolUseId);
          if (!tc && toolName) {
            const matching = toolCalls.filter((c) => c.name === toolName && !c.result);
            tc = matching[matching.length - 1];
          }
          if (tc) tc.result = result.content;
          flushTurnText();
          updateStreamToolResult(result.toolUseId, result.content);
          appendSessionMessage(world.path, convId, { type: "tool_result", tool: toolName || result.toolName || "", output: result.content, timestamp: new Date().toISOString() }).catch(() => {});
          // Persist tool result in conversation so next API call includes full history
          addMessage(storyId, { role: "system", content: `[工具结果: ${toolName || result.toolName || "tool"}]\n${result.content}` }, convId);
          // Bump refreshKey when world data changes
          if (toolName === "OutlineWrite" || toolName === "EntryWrite" || toolName === "Relation") {
            window.dispatchEvent(new CustomEvent("worldforge-data-changed"));
          }
        },
        onComplete: (text, thinking) => {
          if (abortRef.current) return; // Already saved by stop button
          flushTurnText();
          setStreaming(false);
          clearStreamText();
        },
        onError: (error) => {
          setStreaming(false);
          flushTurnText();
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
      }, llmProvider, activeModel, storyId, reasoningEffort, convId, maxTokens, abortRef);
    } catch (e: any) {
      setStreaming(false);
      if (!abortRef.current) addMessage(storyId, { role: "assistant", content: `Error: ${e}` }, convId);
      clearStreamText();
    }
  };
  handleSendRef.current = handleSend;

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
            onChoose={(c) => { permission.callback(c); setPermission(null); }}
            onDismiss={() => { permission.callback("deny"); setPermission(null); }}
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
              <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)}
                className="text-[0.688rem] bg-transparent text-ink-muted py-0 appearance-none outline-none cursor-pointer truncate max-w-[220px]"
              >
                {llmModels.map((m) => <option key={m.name} value={m.name}>{m.alias || m.name}</option>)}
              </select>
            )}
            {isStreamingHere ? (
              <button onClick={() => {
                  abortRef.current = true;
                  const scid = useStore.getState().streamingConversationId;
                  if (scid !== activeConversationId) return;
                  const thinking = turnThinkingRef.current.trim() || undefined;
                  const tc = turnToolCallsRef.current;
                  if (scid) addMessage(storyId, {
                    role: "assistant",
                    content: turnTextRef.current + ` ${t.chat.stopped}`,
                    thinking,
                    toolCalls: tc.length > 0 ? [...tc] : undefined,
                  }, scid);
                  if (world && scid) appendSessionMessage(world.path, scid, { type: "assistant", content: turnTextRef.current + ` ${t.chat.stopped}`, thinking: thinking || null, timestamp: new Date().toISOString() }).catch(() => {});
                  turnTextRef.current = "";
                  turnThinkingRef.current = "";
                  turnToolCallsRef.current = [];
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

import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { useStore, type ToolCall, type TimelineBlock } from "@/lib/store";
import { invoke } from "@/lib/api";
import { runAgentLoop, resetPermissions, type AgentMessage } from "@/lib/agent-loop";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { ArrowUp, Square, X, Paperclip, Loader2 } from "lucide-react";
import { InlinePermission } from "./PermissionDialog";
import { ContextRing } from "./ContextRing";
import type { PermissionChoice } from "@/lib/agent-loop";
import type { Entry } from "@/lib/types";

export function ChatInput({ storyId }: { storyId: string }) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [permission, setPermission] = useState<null | { toolName: string; details: string; callback: (c: PermissionChoice) => void }>(null);
  const [newEntryForm, setNewEntryForm] = useState(false);
  const [newEntryName, setNewEntryName] = useState("");
  const [newEntryType, setNewEntryType] = useState("character");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef(false);
  const streamStateRef = useRef({ text: "", thinking: "", toolCalls: [] as ToolCall[] });

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
  const setStreaming = useStore((s) => s.setStreaming);
  const appendStreamText = useStore((s) => s.appendStreamText);
  const appendStreamThinking = useStore((s) => s.appendStreamThinking);
  const addStreamToolCall = useStore((s) => s.addStreamToolCall);
  const setIsThinking = useStore((s) => s.setIsThinking);
  const setIsToolRunning = useStore((s) => s.setIsToolRunning);
  const updateStreamToolResult = useStore((s) => s.updateStreamToolResult);
  const clearStreamText = useStore((s) => s.clearStreamText);

  // Retry: remove last assistant message, then re-send user message
  useEffect(() => {
    const handler = (e: Event) => {
      const content = (e as CustomEvent).detail.content as string;
      if (!content || isStreaming) return;
      // Remove the last assistant message so retry has clean history
      const w = useStore.getState().worlds.find((x) => x.id === activeWorldId);
      const s = w?.stories.find((x) => x.id === storyId);
      const c = s?.conversations.find((x) => x.id === activeConversationId);
      if (c) {
        const msgs = [...c.messages];
        // Remove last assistant message (the cancelled/failed one)
        const lastIdx = msgs.map((m, i) => ({ m, i })).filter((x) => x.m.role === "assistant").pop()?.i;
        if (lastIdx !== undefined) {
          msgs.splice(lastIdx, 1);
          // Update store directly
          useStore.setState((prev) => ({
            worlds: prev.worlds.map((ww) => ww.id === activeWorldId ? {
              ...ww, stories: ww.stories.map((ss) => ss.id === storyId ? {
                ...ss, conversations: ss.conversations.map((cc) => cc.id === activeConversationId ? {
                  ...cc, messages: msgs,
                } : cc),
              } : ss),
            } : ww),
          }));
        }
      }
      const el = textareaRef.current;
      if (!el) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeSetter?.call(el, content);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      setTimeout(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), 50);
    };
    window.addEventListener("worldforge-retry", handler);
    return () => window.removeEventListener("worldforge-retry", handler);
  }, [isStreaming, activeWorldId, storyId, activeConversationId]);

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
      const newFiles: { name: string; content: string }[] = [];
      for (let i = 0; i < selected.length; i++) {
        const f = selected[i];
        try { const text = await f.text(); if (text) newFiles.push({ name: f.name, content: text }); } catch {}
      }
      if (newFiles.length > 0) setFiles((prev) => [...prev, ...newFiles]);
    }, { once: true });
    input.click();
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || isStreaming || !world || !story) return;

    // ── Handle slash commands ──
    const persistCmd = (cmd: string, result: string) => {
      addMessage(storyId, { role: "user", content: cmd });
      addMessage(storyId, { role: "assistant", content: result });
      invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "user", content: cmd, timestamp: new Date().toISOString() } }).catch(() => {});
      invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "assistant", content: result, timestamp: new Date().toISOString() } }).catch(() => {});
    };
    if (text.startsWith("/stats")) {
      let stats = `词条统计:\n`;
      try {
        const entries = await invoke<Entry[]>("list_entries", { worldPath: world.path });
        const types: Record<string, number> = {};
        for (const e of entries) types[e.type] = (types[e.type] || 0) + 1;
        stats += `总计 ${entries.length} 条\n`;
        stats += Object.entries(types).map(([t, c]) => `${t}: ${c}`).join("\n");
      } catch { stats = "无法获取词条统计"; }
      persistCmd(text, stats);
      setInput(""); return;
    }
    if (text.startsWith("/desc ")) {
      const name = text.slice(6).trim();
      try {
        const entries = await invoke<Entry[]>("list_entries", { worldPath: world.path });
        const matched = entries.find((x) => x.name.includes(name) || x.id.includes(name));
        if (!matched) { persistCmd(text, `未找到词条: ${name}`); setInput(""); return; }
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
          lines.push("关联: " + e.relationships.map((r) => `${r.relation} → ${r.targetId}`).join(", "));
        }
        persistCmd(text, lines.join("\n"));
      } catch { persistCmd(text, "查询失败"); }
      setInput(""); return;
    }
    if (text.startsWith("/outline")) {
      try {
        const chapters = await invoke<Array<{ order: number; title: string; status: string; summary: string; has_body: boolean }>>("read_outline", { worldPath: world.path, storyId });
        if (chapters.length === 0) { persistCmd(text, "暂无大纲。"); setInput(""); return; }
        const done = chapters.filter((c) => c.status === "done" || c.has_body).length;
        const lines = [`**大纲概览** — ${done}/${chapters.length} 章已完成`, ""];
        for (const ch of chapters) {
          const icon = ch.status === "done" ? "✓" : ch.status === "drafting" ? "✎" : "○";
          const info = ch.has_body ? `${ch.summary || "(无摘要)"}` : "(仅大纲)";
          lines.push(`${icon} Ch${ch.order} **${ch.title}** — ${info}`);
        }
        persistCmd(text, lines.join("\n"));
      } catch { persistCmd(text, "读取大纲失败"); }
      setInput(""); return;
    }
    if (text.startsWith("/new-conv")) {
      if (!world || !story) return;
      const convId = useStore.getState().createConversation(storyId);
      // Persist story meta with new conversation
      const convs = story.conversations.map((c: { id: string; title: string }) => ({ id: c.id, title: c.title, created_at: new Date().toISOString() }));
      convs.push({ id: convId, title: `对话 ${convs.length + 1}`, created_at: new Date().toISOString() });
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
      addMessage(storyId, { role: "assistant", content: "请先在设置中配置 LLM。" });
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
          await invoke("write_file", { worldPath: world.path, fileName: f.name, content: f.content, conversationId: activeConversationId });
        } catch {}
      }
    }
    addMessage(storyId, { role: "user", content: userContent });
    // Persist user message to session JSONL
    invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "user", content: userContent, timestamp: new Date().toISOString() } }).catch(() => {});

    let entries: Entry[] = [];
    try { entries = await invoke<Entry[]>("list_entries", { worldPath: world.path }); } catch {}

    const systemPrompt = buildSystemPrompt(world.name, story.title, entries);
    const latestConv = useStore.getState().worlds
      .find((w) => w.id === activeWorldId)
      ?.stories.find((s) => s.id === storyId)
      ?.conversations.find((c) => c.id === activeConversationId);
    const history: AgentMessage[] = (latestConv?.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // ── Step 2: Inject file content into LLM context only (UI stays clean) ──
    if (currentFiles.length > 0) {
      const MAX_FILE_CHARS = 8000;
      const fileBlocks = currentFiles.map((f) => {
        const truncated = f.content.length > MAX_FILE_CHARS
          ? f.content.slice(0, MAX_FILE_CHARS) + `\n...[截断, 共 ${f.content.length} 字符]`
          : f.content;
        return `[上传文件: ${f.name}]\n---\n${truncated}\n---`;
      });
      // Inject before the last user message in history
      const lastUser = history.filter(m => m.role === "user").pop();
      if (lastUser) {
        lastUser.content = fileBlocks.join("\n\n") + "\n\n" + lastUser.content;
      }
    }

    setStreaming(true, activeConversationId || undefined);
    clearStreamText();
    abortRef.current = false;
    resetPermissions(activeConversationId || undefined);
    let finalContent = "";
    let thinkingContent = "";
    const toolCalls: ToolCall[] = [];
    const timeline: TimelineBlock[] = [];
    let prevBlock: TimelineBlock | null = null;
    streamStateRef.current = { text: "", thinking: "", toolCalls: [] };

    try {
      const currentModelConfig = llmModels.find((m) => m.name === activeModel);
      const reasoningEffort = currentModelConfig?.reasoningEffort;

      await runAgentLoop(world.path, systemPrompt, history, {
        onTextDelta: (t) => { if (abortRef.current) return; appendStreamText(t); finalContent += t; streamStateRef.current.text = finalContent;
          setIsThinking(false); setIsToolRunning(false);
          if (prevBlock?.type === "text") { prevBlock.text += t; }
          else { const b: TimelineBlock = { type: "text", text: t }; timeline.push(b); prevBlock = b; }
        },
        onThinkingDelta: (t) => { if (abortRef.current) return; thinkingContent += t; appendStreamThinking(t); streamStateRef.current.thinking = thinkingContent;
          setIsThinking(true); setIsToolRunning(false);
          if (prevBlock?.type === "thinking") { prevBlock.text += t; }
          else { const b: TimelineBlock = { type: "thinking", text: t }; timeline.push(b); prevBlock = b; }
        },
        onThinkingDone: () => {},
        onToolUse: (id, name, input) => {
          if (abortRef.current) return;
          const tc: ToolCall = { id, name, input: input || {}, result: "" };
          toolCalls.push(tc);
          streamStateRef.current.toolCalls = [...toolCalls];
          addStreamToolCall(tc);
          invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "tool_use", tool: name, input: input || {}, timestamp: new Date().toISOString() } }).catch(() => {});
          setIsThinking(false); setIsToolRunning(true);
          const b: TimelineBlock = { type: "tool", call: tc }; timeline.push(b); prevBlock = b;
        },
        onToolResult: (result, toolName) => {
          let tc = toolCalls.find((c) => c.id === result.toolUseId);
          if (!tc && toolName) {
            const matching = toolCalls.filter((c) => c.name === toolName && !c.result);
            tc = matching[matching.length - 1];
          }
          if (tc) tc.result = result.content;
          updateStreamToolResult(result.toolUseId, result.content);
          invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "tool_result", tool: toolName || result.toolName || "", output: result.content, timestamp: new Date().toISOString() } }).catch(() => {});
          // Bump refreshKey when world data changes
          if (toolName === "OutlineWrite" || toolName === "EntryWrite" || toolName === "Relation") {
            window.dispatchEvent(new CustomEvent("worldforge-data-changed"));
          }
        },
        onComplete: (text, thinking) => {
          if (abortRef.current) return; // Already saved by stop button
          addMessage(storyId, {
            role: "assistant", content: finalContent,
            thinking: thinking || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            timeline: timeline.length > 0 ? timeline : undefined,
          });
          // Persist assistant message to session JSONL (with thinking)
          invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "assistant", content: finalContent, thinking: thinkingContent || null, timestamp: new Date().toISOString() } }).catch(() => {});
          setStreaming(false);
          clearStreamText();
        },
        onError: (error) => {
          setStreaming(false);
          const msg = error.includes("发送请求") || error.includes("error sending request") || error.includes("连接")
            ? "网络连接失败，请检查网络后重试。"
            : error.includes("API Key") || error.includes("未配置")
              ? "API Key 未配置或无效，请在设置中检查。"
              : `Error: ${error}`;
          const interruptedContent = finalContent
            ? `${finalContent}\n\n[中断: ${msg}]`
            : msg;
          addMessage(storyId, { role: "assistant", content: interruptedContent });
          if (world && activeConversationId) {
            invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "assistant", content: interruptedContent, thinking: thinkingContent || null, timestamp: new Date().toISOString() } }).catch(() => {});
          }
          clearStreamText();
        },
      }, llmProvider, activeModel, storyId, reasoningEffort);
    } catch (e: any) {
      setStreaming(false);
      if (!abortRef.current) addMessage(storyId, { role: "assistant", content: `Error: ${e}` });
      clearStreamText();
    }
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
            onChoose={(c) => { permission.callback(c); setPermission(null); }}
            onDismiss={() => { permission.callback("deny"); setPermission(null); }}
          />
        )}
        {/* New entry form */}
        {newEntryForm && (
          <div className="mb-2 bg-surface-800 rounded-2xl px-4 py-3 space-y-2 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted">新建词条</span>
              <button onClick={() => { setNewEntryForm(false); setNewEntryName(""); }} className="ml-auto p-0.5 rounded text-ink-muted hover:text-ink"><X className="w-3 h-3" /></button>
            </div>
            <input
              value={newEntryName}
              onChange={(e) => setNewEntryName(e.target.value)}
              placeholder="名称"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("nf-type")?.focus(); }}
              className="w-full h-8 text-sm bg-surface-700 rounded-lg px-3 text-ink outline-none placeholder:text-ink-muted"
            />
            <div className="flex gap-2">
              <select
                id="nf-type"
                value={newEntryType}
                onChange={(e) => setNewEntryType(e.target.value)}
                className="flex-1 h-8 text-[11px] bg-surface-700 rounded-lg px-3 text-ink outline-none"
              >
                {Object.entries({ character: "人物", location: "地点", organization: "组织", event: "事件", system: "体系", artifact: "物品", era: "纪元", concept: "概念" }).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  if (!newEntryName.trim()) return;
                  const typeLabel = { character: "人物", location: "地点", organization: "组织", event: "事件", system: "体系", artifact: "物品", era: "纪元", concept: "概念" }[newEntryType] || newEntryType;
                  try {
                    const e = await invoke<Entry>("create_entry", { worldPath: world!.path, name: newEntryName.trim(), entryType: newEntryType });
                    addMessage(storyId, { role: "user", content: `/new-entry ${newEntryName} (${typeLabel})` });
                    addMessage(storyId, { role: "assistant", content: `词条已创建: **${e.name}** [${e.type}]` });
                    invoke("append_session_message", { worldPath: world!.path, sessionId: activeConversationId, message: { type: "user", content: `/new-entry ${newEntryName}`, timestamp: new Date().toISOString() } }).catch(() => {});
                    invoke("append_session_message", { worldPath: world!.path, sessionId: activeConversationId, message: { type: "assistant", content: `词条已创建: **${e.name}** [${e.type}]`, timestamp: new Date().toISOString() } }).catch(() => {});
                  } catch (err: any) {
                    addMessage(storyId, { role: "assistant", content: `创建失败: ${err}` });
                  }
                  setNewEntryForm(false);
                  setNewEntryName("");
                }}
                disabled={!newEntryName.trim()}
                className="px-4 h-8 text-[11px] rounded-lg bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                创建
              </button>
            </div>
          </div>
        )}
        {/* File chips */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-surface-700 text-ink-secondary rounded-full">
                <Paperclip className="w-3 h-3" />
                {f.name}
                <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="ml-0.5 hover:text-error">
                  <X className="w-3 h-3" />
                </button>
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
            placeholder="输入创作想法或设定问题..."
            rows={1}
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted resize-none outline-none max-h-[200px] leading-6"
          />
          <div className="flex items-center gap-1 mt-0.5">
            <button onClick={handleFilePick} className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-700 transition-colors" title="上传文件">
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <div className="flex-1" />
            <ContextRing />
            {llmModels.length > 1 && (
              <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)}
                className="text-[11px] bg-transparent text-ink-muted py-0 appearance-none outline-none cursor-pointer truncate max-w-[220px]"
              >
                {llmModels.map((m) => <option key={m.name} value={m.name}>{m.alias || m.name}</option>)}
              </select>
            )}
            {isStreaming ? (
              <button onClick={() => {
                  abortRef.current = true;
                  const state = streamStateRef.current;
                  const msgContent = state.text + " [已取消]";
                  addMessage(storyId, {
                    role: "assistant",
                    content: msgContent,
                    thinking: state.thinking || undefined,
                    toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
                  });
                  if (world && activeConversationId) invoke("append_session_message", { worldPath: world.path, sessionId: activeConversationId, message: { type: "assistant", content: msgContent, thinking: state.thinking || null, timestamp: new Date().toISOString() } }).catch(() => {});
                  setStreaming(false);
                  clearStreamText();
                }}
                className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-lg bg-surface-700 text-ink-muted hover:text-error hover:bg-surface-600 transition-colors">
                <Square className="w-3 h-3" fill="currentColor" />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!canSend}
                className={`flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${canSend ? "text-ink-secondary hover:text-ink hover:bg-surface-700" : "text-ink-muted"}`}>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

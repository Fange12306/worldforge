import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { invoke } from "@/lib/api";
import { ChatWindow } from "./ChatWindow";
import { ChatInput } from "./ChatInput";
import { Sprout } from "lucide-react";

export function ChatLayout() {
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);

  const activeWorld = worlds.find((w) => w.id === activeWorldId);

  // Load persisted token count + context state when switching conversations
  useEffect(() => {
    if (!activeWorld || !activeConversationId) return;
    invoke<number>("load_session_tokens", { worldPath: activeWorld.path, sessionId: activeConversationId })
      .then((tokens) => {
        if (tokens > 0) {
          useStore.setState((prev) => ({
            worlds: prev.worlds.map((w) => w.id === activeWorldId ? {
              ...w, stories: w.stories.map((s) => ({
                ...s, conversations: s.conversations.map((c) => c.id === activeConversationId ? { ...c, totalTokens: tokens } : c),
              })),
            } : w),
          }));
        }
      }).catch(() => {});
    invoke<string>("load_session_state", { worldPath: activeWorld.path, sessionId: activeConversationId })
      .then((json) => {
        const data = JSON.parse(json);
        if (data.contextUsed > 0) {
          useStore.setState((prev) => ({
            worlds: prev.worlds.map((w) => w.id === activeWorldId ? {
              ...w, stories: w.stories.map((s) => ({
                ...s, conversations: s.conversations.map((c) => c.id === activeConversationId ? {
                  ...c,
                  contextUsed: data.contextUsed ?? 0,
                  contextBreakdown: data.contextBreakdown ?? null,
                } : c),
              })),
            } : w),
          }));
        }
      }).catch(() => {});
  }, [activeWorldId, activeConversationId]);

  // Lazy-load messages from session JSONL when switching to a conversation with no messages
  useEffect(() => {
    if (!activeWorld || !activeConversationId) return;
    const conv = activeWorld.stories
      .flatMap((s) => s.conversations)
      .find((c) => c.id === activeConversationId);
    if (!conv || conv.messages.length > 0) return; // already loaded
    invoke<Array<{ type: string; content: string; thinking?: string; tool?: string; input?: unknown; output?: string }>>("load_session", { worldPath: activeWorld.path, sessionId: activeConversationId })
      .then((msgs) => {
        // Reconstruct messages with thinking and tool calls
        type StoreMessage = { id: string; role: "user" | "assistant"; content: string; thinking?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown>; result: string }>; timestamp: number };
        const convMsgs: StoreMessage[] = [];
        let pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; result: string }> = [];
        for (const m of msgs) {
          if (m.type === "user") {
            convMsgs.push({ id: `msg_${convMsgs.length}`, role: "user", content: m.content, timestamp: Date.now() });
          } else if (m.type === "assistant") {
            convMsgs.push({ id: `msg_${convMsgs.length}`, role: "assistant", content: m.content, thinking: m.thinking, toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined, timestamp: Date.now() });
            pendingToolCalls = [];
          } else if (m.type === "tool_use") {
            pendingToolCalls.push({ id: `tc_${pendingToolCalls.length}`, name: m.tool || "", input: (m.input as Record<string, unknown>) || {}, result: "" });
          } else if (m.type === "tool_result") {
            const last = pendingToolCalls[pendingToolCalls.length - 1];
            if (last) last.result = (m.output as string) || "";
          }
        }
        if (convMsgs.length > 0) {
          useStore.setState((prev) => ({
            worlds: prev.worlds.map((w) => w.id === activeWorldId ? {
              ...w, stories: w.stories.map((s) => ({
                ...s, conversations: s.conversations.map((c) => c.id === activeConversationId ? { ...c, messages: convMsgs } : c),
              })),
            } : w),
          }));
        }
      }).catch(() => {});
  }, [activeWorldId, activeConversationId]);

  // No world open
  if (!activeWorld) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-ink-muted gap-4">
        <Sprout className="w-12 h-12 opacity-30" />
        <p className="text-sm">打开一个架空世界开始创作</p>
        <p className="text-xs opacity-50">
          在左侧栏选择或创建一个世界
        </p>
      </div>
    );
  }

  // Find active conversation's parent story
  const activeStory = activeWorld.stories.find((s) =>
    s.conversations.some((c) => c.id === activeConversationId),
  );
  const activeConv = activeStory?.conversations.find(
    (c) => c.id === activeConversationId,
  );

  // World open but no conversation active
  if (!activeConv || !activeStory) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-ink-muted gap-3">
        <p className="text-sm">选择一个故事下的对话</p>
        <p className="text-xs opacity-50">
          在左侧栏展开故事，点击 + 新建对话
        </p>
      </div>
    );
  }

  return (
    <>
      <ChatWindow
        storyId={activeStory.id}
        messages={activeConv.messages}
      />
      <ChatInput storyId={activeStory.id} />
    </>
  );
}

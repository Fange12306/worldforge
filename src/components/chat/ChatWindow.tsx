import { useEffect, useRef, useMemo } from "react";
import { useStore, type Message } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { groupSearchReadMessages, type DisplayItem } from "@/lib/collapse-tools";
import { MessageBubble } from "./MessageBubble";
import { CollapsedGroupMessage } from "./CollapsedGroupMessage";
import { CompressedContextBanner } from "./CompressedContextBanner";

function mergeAdjacentAssistantMessages(messages: Message[]): Message[] {
  const merged: Message[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last?.role === "assistant" && msg.role === "assistant") {
      last.content = [last.content, msg.content].filter(Boolean).join("\n\n");
      last.thinking = [last.thinking, msg.thinking].filter(Boolean).join("\n\n") || undefined;
      last.toolCalls = [...(last.toolCalls || []), ...(msg.toolCalls || [])];
      last.timestamp = msg.timestamp;
      continue;
    }
    merged.push({ ...msg, toolCalls: msg.toolCalls ? [...msg.toolCalls] : undefined });
  }
  return merged;
}

function hideCurrentTurnAssistantFragments(messages: Message[], isStreamingHere: boolean): Message[] {
  if (!isStreamingHere) return messages;
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return messages;
  return messages.filter((m, index) => index <= lastUserIndex || m.role !== "assistant");
}

export function ChatWindow({ messages }: { storyId: string; messages: Message[] }) {
  const { t } = useT();
  const isStreaming = useStore((s) => s.isStreaming);
  const isCompressing = useStore((s) => s.isCompressing);
  const streamingConversationId = useStore((s) => s.streamingConversationId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const isStreamingHere = isStreaming && activeConversationId === streamingConversationId;
  const streamText = useStore((s) => s.streamText);
  const streamToolCalls = useStore((s) => s.streamToolCalls);
  const streamThinking = useStore((s) => s.streamThinking);
  const isThinking = useStore((s) => s.isThinking);
  const isToolRunning = useStore((s) => s.isToolRunning);
  const theme = useStore((s) => s.theme);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Memoize: only recompute when messages change, not on every stream tick
  const displayItems: DisplayItem[] = useMemo(
    () => groupSearchReadMessages(
      mergeAdjacentAssistantMessages(
        hideCurrentTurnAssistantFragments(messages, isStreamingHere).filter((m) => m.role !== "system")
      )
    ),
    [messages, isStreamingHere]
  );

  // Find last user message once (O(n)), not per-message (O(n²))
  const lastUserMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  // Auto-scroll with rAF-based polling instead of MutationObserver.
  // MutationObserver with characterData fires on every text insertion (~50/sec),
  // which causes layout thrashing (read scrollHeight → write scrollTop loop).
  useEffect(() => {
    if (!isStreamingHere) return;
    const el = scrollerRef.current;
    if (!el) return;
    let rafId: number;
    const poll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (dist < 80) el.scrollTop = el.scrollHeight;
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [isStreamingHere]);

  useEffect(() => {
    if (isStreamingHere) return;
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreamingHere && (
          <div className="flex flex-col items-center justify-center text-ink-muted gap-4 min-h-[200px]">
            <svg className="w-10 h-10 text-ink-muted opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              <path d="M12 6v13" />
            </svg>
            <p className="text-sm">{t.chat.emptyState}</p>
          </div>
        )}
        {displayItems.map((item) => {
          if ("_type" in item && item._type === "collapsed_group") {
            return <CollapsedGroupMessage key={item.messages[0].id} group={item} />;
          }
          const msg = item as Message;
          // Detect compressed context messages
          if (msg.content.startsWith("[上下文压缩]")) {
            const summaryMatch = msg.content.match(/<summary>([\s\S]*)<\/summary>/);
            const summary = summaryMatch ? summaryMatch[1].trim() : msg.content;
            return <CompressedContextBanner key={msg.id} summary={summary} />;
          }
          const isLastUser = msg.role === "user" && msg.id === lastUserMsgId;
          return <MessageBubble key={msg.id} message={msg} isLastUser={isLastUser} theme={theme} />;
        })}
        {isStreamingHere && (
          <MessageBubble
            message={{ id: "stream", role: "assistant", content: streamText, toolCalls: streamToolCalls, timestamp: 0 }}
            isStreaming theme={theme} streamThinking={streamThinking}
            isThinking={isThinking} isToolRunning={isToolRunning} globalStreaming
          />
        )}
      </div>
    </div>
  );
}

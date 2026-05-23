import { useEffect, useRef, useMemo } from "react";
import { useStore, type Message } from "@/lib/store";
import { groupSearchReadMessages, type DisplayItem } from "@/lib/collapse-tools";
import { MessageBubble } from "./MessageBubble";
import { CollapsedGroupMessage } from "./CollapsedGroupMessage";

export function ChatWindow({ messages }: { storyId: string; messages: Message[] }) {
  const isStreaming = useStore((s) => s.isStreaming);
  const streamText = useStore((s) => s.streamText);
  const streamToolCalls = useStore((s) => s.streamToolCalls);
  const streamThinking = useStore((s) => s.streamThinking);
  const isThinking = useStore((s) => s.isThinking);
  const isToolRunning = useStore((s) => s.isToolRunning);
  const theme = useStore((s) => s.theme);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Memoize: only recompute when messages change, not on every stream tick
  const displayItems: DisplayItem[] = useMemo(
    () => groupSearchReadMessages(messages),
    [messages]
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
    if (!isStreaming) return;
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
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming) return;
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center text-ink-muted gap-4 min-h-[200px]">
            <svg className="w-10 h-10 text-ink-muted opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              <path d="M12 6v13" />
            </svg>
            <p className="text-sm">选择或创建一个对话开始创作</p>
          </div>
        )}
        {displayItems.map((item) => {
          if ("_type" in item && item._type === "collapsed_group") {
            return <CollapsedGroupMessage key={item.messages[0].id} group={item} />;
          }
          const msg = item as Message;
          const isLastUser = msg.role === "user" && msg.id === lastUserMsgId;
          return <MessageBubble key={msg.id} message={msg} isLastUser={isLastUser} theme={theme} />;
        })}
        {isStreaming && (
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

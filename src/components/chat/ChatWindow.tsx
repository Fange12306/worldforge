import { useEffect, useRef, useMemo } from "react";
import { useStore, type Message } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { MessageBubble } from "./MessageBubble";
import { CompressedContextBanner } from "./CompressedContextBanner";

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

  // Each agent loop is persisted as its own assistant message. Messages are
  // rendered 1:1 — never collapsed — so the layout seen while streaming is
  // exactly what remains after the turn finishes (no regroup, no icon swaps).
  // System messages (tool results etc.) are never shown directly.
  const displayItems: Message[] = useMemo(
    () => messages.filter((m) => m.role !== "system"),
    [messages]
  );

  // One avatar per turn: the first loop of a run shows the assistant avatar,
  // continuation loops keep the column aligned without it. The copy button is
  // only rendered on the LAST loop of a run (and copies the whole run's text).
  const renderItems = useMemo(() => {
    const items: Array<{ msg: Message; showAvatar: boolean; isTurnLast: boolean; copyText: string }> = [];
    let i = 0;
    while (i < displayItems.length) {
      if (displayItems[i].role === "assistant") {
        // Collect the consecutive assistant run (one turn's loops).
        const run: Message[] = [];
        while (i < displayItems.length && displayItems[i].role === "assistant") {
          run.push(displayItems[i]);
          i++;
        }
        const copyText = run.map((m) => m.content).filter(Boolean).join("\n\n");
        run.forEach((msg, idx) => items.push({
          msg,
          showAvatar: idx === 0,
          isTurnLast: idx === run.length - 1,
          copyText,
        }));
      } else {
        // User messages, compression separators, banners — never assistant runs.
        items.push({ msg: displayItems[i], showAvatar: false, isTurnLast: false, copyText: "" });
        i++;
      }
    }
    return items;
  }, [displayItems]);

  const liveShowsAvatar = useMemo(() => {
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const m = displayItems[i];
      if (m.role === "assistant") return false;
      if (m.role === "user") return true;
    }
    return true;
  }, [displayItems]);

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
        {renderItems.map(({ msg, showAvatar, isTurnLast, copyText }) => {
          // Detect compression separator
          if (msg.content.includes("之前的对话已被压缩")) {
            return (
              <div key={msg.id} className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-surface-700" />
                <span className="text-[0.688rem] text-ink-muted flex-shrink-0">之前的对话已被压缩</span>
                <div className="flex-1 h-px bg-surface-700" />
              </div>
            );
          }
          // Detect compressed context messages
          if (msg.content.startsWith("[上下文压缩]")) {
            const summaryMatch = msg.content.match(/<summary>([\s\S]*)<\/summary>/);
            const summary = summaryMatch ? summaryMatch[1].trim() : msg.content;
            return <CompressedContextBanner key={msg.id} summary={summary} />;
          }
          const isLastUser = msg.role === "user" && msg.id === lastUserMsgId;
          return <MessageBubble key={msg.id} message={msg} isLastUser={isLastUser} theme={theme} globalStreaming={isStreamingHere} showAvatar={showAvatar} isTurnLast={isTurnLast} copyText={copyText} />;
        })}
        {isStreamingHere && (
          <MessageBubble
            message={{ id: "stream", role: "assistant", content: streamText, toolCalls: streamToolCalls, timestamp: 0 }}
            isStreaming theme={theme} streamThinking={streamThinking}
            isThinking={isThinking} isToolRunning={isToolRunning} globalStreaming
            showAvatar={liveShowsAvatar}
          />
        )}
      </div>
    </div>
  );
}

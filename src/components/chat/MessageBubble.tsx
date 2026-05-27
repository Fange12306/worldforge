import { memo, useState } from "react";
import { useStore, type Message } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { User, FileText, Copy, Check, RefreshCw } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";
import { WorldForgeLogo } from "@/components/brand/WorldForgeLogo";

type BubbleProps = {
  message: Message;
  isStreaming?: boolean;
  isLastUser?: boolean;
  theme: "dark" | "light";
  streamThinking?: string;
  isThinking?: boolean;
  isToolRunning?: boolean;
  globalStreaming?: boolean;
};

export const MessageBubble = memo(function MessageBubble(props: BubbleProps) {
  const { t } = useT();
  const { message, isStreaming, isLastUser, theme, streamThinking = "", isThinking = false, isToolRunning = false, globalStreaming = false } = props;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const thinking = message.thinking || (isStreaming ? streamThinking : "");

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleRetry = () => {
    setRetrying(true);
    window.dispatchEvent(new CustomEvent("worldforge-retry", { detail: { content: message.content } }));
    setTimeout(() => setRetrying(false), 1000);
  };

  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      <div className={cn("flex-shrink-0 w-7 h-7 flex items-center justify-center",
        isUser && "rounded-lg bg-surface-700 text-ink-secondary")}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <WorldForgeLogo className="w-6 h-6" />}
      </div>
      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col")}>
        {isUser ? (
          <>
            <div className="max-w-[85%] rounded-2xl bg-surface-800 px-4 py-2.5 self-end">
              <UserContent content={message.content} />
            </div>
            {!globalStreaming && message.content && (
              <div className="flex items-center gap-2 mt-1.5 self-end">
                <button onClick={handleCopy} className="text-[0.625rem] text-ink-muted/50 hover:text-ink-muted transition-colors">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
                {isLastUser && (
                  <button onClick={handleRetry} className="text-[0.625rem] text-ink-muted/50 hover:text-ink-muted transition-colors">
                    <RefreshCw className={cn("w-3 h-3", retrying && "animate-spin")} />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="max-w-[85%] space-y-1">
            {/* Waiting state: avatar is up but no thinking/text yet */}
            {isStreaming && !thinking && !message.content && !(message.toolCalls?.length) && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse" />
                {t.chat.waitingReply}
              </span>
            )}
            {thinking && <ThinkingBlock text={thinking} expanded={thinkingExpanded} active={isStreaming && isThinking} onToggle={() => setThinkingExpanded(!thinkingExpanded)} />}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <ToolCallsSummary calls={message.toolCalls} expanded={toolsExpanded} active={isStreaming && isToolRunning} onToggle={() => setToolsExpanded(!toolsExpanded)} />
            )}
            {isAssistant && message.content && (
              <div className={`prose prose-sm max-w-none ${theme === "dark" ? "prose-invert" : ""}`}>
                <MarkdownContent content={message.content} isStreaming={isStreaming} />
              </div>
            )}
            {!globalStreaming && isAssistant && message.content && (
              <button onClick={handleCopy} className="text-[0.625rem] text-ink-muted/50 hover:text-ink-muted transition-colors mt-1.5">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function UserContent({ content }: { content: string }) {
  const cleaned = content.replace(/\[文件:\s*[^\]]+\]\s*/g, "").trim();
  const files = content.match(/\[文件:\s*([^\]]+)\]/g)?.map((x) => x.replace(/\[文件:\s*/, "").replace(/\]$/, "")) || [];
  return (
    <div>
      {cleaned && <p className="text-sm whitespace-pre-wrap break-words text-ink">{cleaned}</p>}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {files.map((f, i) => <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.688rem] bg-surface-700/50 text-ink-secondary rounded-full"><FileText className="w-3 h-3" /> {f}</span>)}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ text, expanded, active, onToggle }: { text: string; expanded: boolean; active?: boolean; onToggle: () => void }) {
  return (
    <div>
      <button onClick={onToggle} className="text-[0.688rem] text-ink-muted hover:text-ink-secondary transition-colors">
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full bg-current mr-1", active ? "pulse-dot" : "")} />Thinking
      </button>
      {expanded && <p className="text-[0.688rem] text-ink-muted whitespace-pre-wrap font-sans leading-relaxed pl-2 mt-0.5">{text}</p>}
    </div>
  );
}

function ToolCallsSummary({ calls, expanded, active, onToggle }: { calls: NonNullable<Message["toolCalls"]>; expanded: boolean; active?: boolean; onToggle: () => void }) {
  // Count unique tool TYPES (not invocations) per user's request
  const uniqueTypes = new Set(calls.map((c) => c.name));

  return (
    <div>
      <button onClick={onToggle} className="text-[0.688rem] text-ink-muted hover:text-ink-secondary transition-colors text-left">
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 align-middle", active ? "pulse-dot" : "")} />
        {uniqueTypes.size === 1
          ? `${calls.length} ${calls[0].name}`
          : `${uniqueTypes.size} tools used`}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 pl-2 border-l border-surface-700/50">
          {calls.map((c, i) => {
            const input = c.input as Record<string, unknown> | undefined;
            const hint = input?.query || input?.entry_id || input?.chapter_id || input?.id || input?.order || input?.pattern || input?.path || input?.name || input?.url || input?.file_name || "";
            const resultPreview = c.result
              ? c.result.slice(0, 100).replace(/\n/g, " ").trim()
              : "";
            return (
              <div key={i} className="text-[0.688rem] text-ink-muted/70 flex gap-1.5 items-start">
                <span className="flex-shrink-0 font-medium text-ink-muted/50">{c.name}</span>
                {hint && <span className="truncate">{String(hint)}</span>}
                {resultPreview && <span className="text-ink-muted/40 hidden sm:inline">→ {resultPreview}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

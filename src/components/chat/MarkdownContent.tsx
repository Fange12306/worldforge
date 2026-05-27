import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export const MarkdownContent = memo(function MarkdownContent({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <div className={cn("text-sm leading-relaxed", isStreaming && "streaming-cursor")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Override default elements with Tailwind styles
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{children}</strong>
          ),
          code: ({ children, className }) => {
            const isInline = !className;
            return isInline ? (
              <code className="px-1 py-0.5 rounded bg-surface-800 text-xs font-mono text-brand-600 dark:text-brand-300">
                {children}
              </code>
            ) : (
              <code className="block p-3 rounded-lg bg-surface-900 border border-edge text-xs font-mono overflow-x-auto">
                {children}
              </code>
            );
          },
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-ink-secondary">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-surface-600 pl-3 my-1.5 text-[0.8125rem] text-ink-muted not-italic">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => (
            <h1 className="text-base font-semibold mt-4 mb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-medium mt-3 mb-1">{children}</h3>
          ),
          hr: () => <hr className="my-3 border-edge" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

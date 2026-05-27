import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useT } from "@/lib/i18n";

type Props = {
  summary: string;
};

export function CompressedContextBanner({ summary }: Props) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 mx-auto max-w-[680px]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-edge/50 bg-surface-900/50 text-xs text-ink-muted hover:text-ink hover:bg-surface-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <FileText className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 text-left">{t.chat.compression.banner}</span>
      </button>
      {expanded && (
        <div className="mt-1 px-3 py-2 rounded-lg border border-edge/30 bg-surface-950/50">
          <p className="text-[0.625rem] text-ink-muted mb-1.5 font-medium">
            {t.chat.compression.summaryLabel}
          </p>
          <pre className="text-[0.688rem] text-ink-secondary whitespace-pre-wrap font-sans leading-relaxed">
            {summary}
          </pre>
        </div>
      )}
    </div>
  );
}

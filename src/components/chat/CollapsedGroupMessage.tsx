import { useState } from "react";
import type { CollapsedGroup } from "@/lib/collapse-tools";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsedGroupMessage({ group }: { group: CollapsedGroup }) {
  const [expanded, setExpanded] = useState(false);

  // Build per-tool detail lines with richer previews
  const details = group.toolCalls.map((tc) => {
    const input = tc.input as Record<string, unknown> | undefined;
    const resultPreview = tc.result
      ? tc.result.slice(0, 100).replace(/\n/g, " ").trim()
      : "";

    // Tool-specific hint extraction
    let hint = "";
    if (input) {
      if (tc.name === "EntrySearch" || tc.name === "GrepEntries") hint = (input.query as string) || "";
      else if (tc.name === "EntryRead" || tc.name === "QueryRelations") hint = (input.entry_id || input.id || input.entity_id || "") as string;
      else if (tc.name === "TraverseGraph") hint = `${input.entity_id || ""} (${input.max_depth || 1}跳)`;
      else if (tc.name === "ConsistencyCheck") hint = `${(input.passage as string || "").slice(0, 30)}…`;
      else if (tc.name === "UseSkill") hint = (input.name as string) || "列出技能";
      else hint = (input.query || input.chapter_id || input.id || input.order || input.pattern || input.path || input.subdir || "") as string;
    }

    const label = hint ? `${tc.name} ${String(hint)}` : tc.name;
    return { label, resultPreview, name: tc.name };
  });

  const totalCount = group.toolCalls.length;
  const totalMessages = group.messages.length;
  const uniqueTypes = new Set(group.toolCalls.map((tc) => tc.name));

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-surface-700/50 text-ink-muted">
        <BookOpen className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] text-ink-muted hover:text-ink-secondary transition-colors group"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span className="text-ink-muted/70 group-hover:text-ink-muted transition-colors">
            {uniqueTypes.size} tools used
          </span>
          <span className="text-ink-muted/40">
            ({totalCount} 次调用 / {totalMessages} 轮)
          </span>
        </button>
        {expanded && (
          <div className="mt-1.5 space-y-0.5 pl-5">
            {details.map((d, i) => (
              <div key={i} className="text-[11px] text-ink-muted flex items-start gap-1.5">
                <span className={cn(
                  "flex-shrink-0 mt-0.5 w-1 h-1 rounded-full",
                  d.name === "EntrySearch" || d.name === "GrepEntries"
                    ? "bg-amber-500/60"
                    : d.name === "TraverseGraph" || d.name === "QueryRelations"
                    ? "bg-purple-500/60"
                    : d.name === "ConsistencyCheck"
                    ? "bg-rose-500/60"
                    : d.name === "UseSkill"
                    ? "bg-emerald-500/60"
                    : "bg-blue-500/60"
                )} />
                <span className="text-ink-muted/70 truncate">{d.label}</span>
                {d.resultPreview && (
                  <span className="text-ink-muted/40 truncate hidden sm:inline">
                    → {d.resultPreview}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

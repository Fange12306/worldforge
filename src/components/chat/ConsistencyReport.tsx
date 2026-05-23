import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle, XCircle, Eye, X, ChevronDown, ChevronUp } from "lucide-react";

export interface ViolationData {
  level: "hard" | "soft";
  rule: string;
  passage: string;
  suggestion: string;
}

interface ReportState {
  violations: ViolationData[];
  passage: string;
  checked: "hard" | "soft" | null; // highest severity
}

/**
 * ConsistencyReport — a floating card stack that appears when the
 * ConsistencyCheck tool finds violations in the Agent loop.
 *
 * Red cards = hard constraints (must fix)
 * Amber cards = soft constraints (should fix)
 * Each card can be dismissed individually or all at once.
 */
export function ConsistencyReport() {
  const [report, setReport] = useState<ReportState | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        violations: ViolationData[];
        passage: string;
      };
      setReport({
        violations: detail.violations,
        passage: detail.passage,
        checked: detail.violations.some((v) => v.level === "hard")
          ? "hard"
          : detail.violations.some((v) => v.level === "soft")
          ? "soft"
          : null,
      });
      setDismissedIds(new Set());
      setExpanded(true);
    };
    window.addEventListener("worldforge-consistency", handler);
    return () => window.removeEventListener("worldforge-consistency", handler);
  }, []);

  const dismiss = useCallback((idx: number) => {
    setDismissedIds((prev) => new Set([...prev, idx]));
  }, []);

  const dismissAll = useCallback(() => {
    setReport(null);
  }, []);

  if (!report) return null;

  const visible = report.violations.filter((_, i) => !dismissedIds.has(i));
  if (visible.length === 0) {
    // All dismissed — show a collapsed "all clear" bar
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={dismissAll}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-800 border border-edge text-xs text-ink-muted hover:text-ink-secondary transition-colors shadow-lg"
        >
          <CheckCircle className="w-4 h-4 text-success" />
          已处理 {report.violations.length} 处冲突
          <X className="w-3 h-3 ml-1" />
        </button>
      </div>
    );
  }

  const hardCount = visible.filter((v) => v.level === "hard").length;
  const softCount = visible.filter((v) => v.level === "soft").length;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 max-h-[70vh] flex flex-col rounded-2xl bg-surface-900 border border-edge shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {report.checked === "hard" ? (
            <XCircle className="w-4 h-4 text-error" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-warning" />
          )}
          <span className="text-xs font-medium text-ink">
            一致性报告
          </span>
          <span className="text-[10px] text-ink-muted">
            {hardCount > 0 && <span className="text-error">{hardCount}硬</span>}
            {hardCount > 0 && softCount > 0 && <span> </span>}
            {softCount > 0 && <span className="text-warning">{softCount}软</span>}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={dismissAll}
            className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Violation cards */}
      {expanded && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <p className="text-[10px] text-ink-muted/50 px-1">
            关键字预匹配结果，请确认内容是否一致
          </p>
          {visible.map((v, i) => {
            const isHard = v.level === "hard";
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xl border p-3 space-y-1.5 transition-colors",
                  isHard
                    ? "bg-error/5 border-error/30"
                    : "bg-warning/5 border-warning/30"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isHard ? (
                      <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                    )}
                    <span className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider",
                      isHard ? "text-error" : "text-warning"
                    )}>
                      {isHard ? "硬约束" : "软约束"}
                    </span>
                  </div>
                  <button
                    onClick={() => dismiss(i)}
                    className="p-0.5 rounded text-ink-muted/30 hover:text-ink-muted transition-colors flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Rule */}
                <p className="text-xs text-ink font-medium leading-relaxed">
                  {v.rule}
                </p>

                {/* Passage excerpt */}
                <div className="bg-surface-950/50 rounded-lg px-2 py-1.5">
                  <p className="text-[11px] text-ink-muted font-mono leading-relaxed">
                    {v.passage}
                  </p>
                </div>

                {/* Suggestion */}
                {v.suggestion && (
                  <p className="text-[11px] text-ink-secondary leading-relaxed">
                    {v.suggestion}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

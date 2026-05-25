import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { ContextBreakdown } from "@/lib/context-window";

const RING_SIZE = 16;
const RADIUS = 6;
const STROKE = 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ringColor(pct: number): string {
  if (pct < 50) return "var(--color-success)";
  if (pct < 75) return "var(--color-warning)";
  if (pct < 90) return "#f97316"; // orange-500
  return "var(--color-error)";
}

function BreakdownRow({ label, tokens, pct, indent }: { label: string; tokens: number; pct: number; indent?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-[11px] ${indent ? "pl-4" : ""}`}>
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink-secondary tabular-nums">
        {fmtTokens(tokens)} <span className="text-ink-muted">({pct.toFixed(1)}%)</span>
      </span>
    </div>
  );
}

export function ContextRing() {
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const activeConv = activeWorld?.stories
    .flatMap((s) => s.conversations)
    .find((c) => c.id === activeConversationId);
  const contextUsed = activeConv?.contextUsed ?? 0;
  const contextBreakdown = activeConv?.contextBreakdown ?? null;
  const contextWindowSize = useStore((s) => s.contextWindowSize);
  const llmProvider = useStore((s) => s.llmProvider);
  const activeModel = useStore((s) => s.activeModel);
  const llmModels = useStore((s) => s.llmModels);
  const setContextWindow = useStore((s) => s.setContextWindow);

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (llmProvider && activeModel) {
      const modelCfg = llmModels.find((m) => m.name === activeModel);
      setContextWindow(llmProvider, activeModel, modelCfg?.contextWindow);
    }
  }, [llmProvider, activeModel, llmModels, setContextWindow]);

  // Dismiss on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pct = contextWindowSize > 0 ? (contextUsed / contextWindowSize) * 100 : 0;
  const filled = CIRCUMFERENCE * Math.max(0, Math.min(pct / 100, 1));
  const freeSpace = Math.max(0, contextWindowSize - contextUsed);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-0.5 rounded hover:bg-surface-700 transition-colors"
        title={`上下文: ${fmtTokens(contextUsed)} / ${fmtTokens(contextWindowSize)} (${pct.toFixed(0)}%)`}
      >
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="block">
          {/* Background ring */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={STROKE}
          />
          {/* Filled arc */}
          {contextUsed > 0 && (
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={ringColor(pct)}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-surface-850 border border-edge rounded-xl shadow-xl z-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">上下文窗口</span>
            <span className="text-[11px] tabular-nums" style={{ color: ringColor(pct) }}>
              {fmtTokens(contextUsed)} / {fmtTokens(contextWindowSize)} ({pct.toFixed(0)}%)
            </span>
          </div>
          <div className="h-px bg-edge" />
          {contextBreakdown ? (
            <>
              <BreakdownRow label="Messages" tokens={contextBreakdown.messages} pct={(contextBreakdown.messages / contextUsed) * 100} />
              <BreakdownRow label="System tools" tokens={contextBreakdown.systemTools} pct={(contextBreakdown.systemTools / contextUsed) * 100} />
              <BreakdownRow label="System prompt" tokens={contextBreakdown.systemPrompt} pct={(contextBreakdown.systemPrompt / contextUsed) * 100} />
              {contextBreakdown.skills > 0 && (
                <BreakdownRow label="Skills" tokens={contextBreakdown.skills} pct={(contextBreakdown.skills / contextUsed) * 100} />
              )}
              <div className="h-px bg-edge" />
              <BreakdownRow label="Free space" tokens={freeSpace} pct={(freeSpace / contextWindowSize) * 100} />
            </>
          ) : (
            <p className="text-[11px] text-ink-muted">发送第一条消息后显示详情</p>
          )}
        </div>
      )}
    </div>
  );
}

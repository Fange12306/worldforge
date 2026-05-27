import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/store";
import { useT } from "@/lib/i18n";
import type { ContextBreakdown } from "@/lib/context-window";
import { buildModelMessages } from "@/lib/model-context";
import { compressMessages, RECENT_TURNS_TO_KEEP } from "@/lib/context-compression";
import { estimateTokens } from "@/lib/context-window";
import { rewriteSessionMessages, messagesToSessionLines } from "@/lib/session-writer";
import { buildSystemPrompt } from "@/lib/system-prompt";

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
    <div className={`flex items-center justify-between text-[0.688rem] ${indent ? "pl-4" : ""}`}>
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink-secondary tabular-nums">
        {fmtTokens(tokens)} <span className="text-ink-muted">({pct.toFixed(1)}%)</span>
      </span>
    </div>
  );
}

export function ContextRing() {
  const { t } = useT();
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const activeConv = activeWorld?.stories
    .flatMap((s) => s.conversations)
    .find((c) => c.id === activeConversationId);
  const turnCount = (activeConv?.messages ?? []).filter((m) => m.role === "user").length;
  const canCompress = turnCount >= 8;
  const contextUsed = activeConv?.contextUsed ?? 0;
  const contextBreakdown = activeConv?.contextBreakdown ?? null;
  const contextWindowSize = useStore((s) => s.contextWindowSize);
  const llmProvider = useStore((s) => s.llmProvider);
  const activeModel = useStore((s) => s.activeModel);
  const llmModels = useStore((s) => s.llmModels);
  const setContextWindow = useStore((s) => s.setContextWindow);
  const isCompressing = useStore((s) => s.isCompressing);
  const setCompressing = useStore((s) => s.setCompressing);
  const markCompressed = useStore((s) => s.markCompressed);
  const replaceMessages = useStore((s) => s.replaceMessages);
  const compressedSummary = activeConv?.compressedSummary;

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
        title={t.chat.contextTooltip(fmtTokens(contextUsed), fmtTokens(contextWindowSize), pct.toFixed(0))}
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
            <span className="text-xs font-semibold text-ink">{t.model.contextWindow}</span>
            <span className="text-[0.688rem] tabular-nums" style={{ color: ringColor(pct) }}>
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
            <p className="text-[0.688rem] text-ink-muted">{t.chat.contextEmpty}</p>
          )}
          {compressedSummary && (
            <>
              <div className="h-px bg-edge" />
              <p className="text-[0.625rem] text-ink-muted">{t.chat.compression.banner}</p>
            </>
          )}
          <div className="h-px bg-edge" />
          <button
            onClick={async () => {
              setOpen(false);
              if (!activeConv || !llmProvider || !activeModel) return;
              const convId = activeConversationId;
              if (!convId) return;
              setCompressing(true);
              try {
                const agentMsgs = buildModelMessages(activeConv.messages);
                const estTokens = estimateTokens(agentMsgs.map((m) => m.content).join("\n"));
                const result = await compressMessages(
                  agentMsgs,
                  contextWindowSize,
                  Math.max(estTokens, contextUsed),
                  { threshold: 0, keepTurns: RECENT_TURNS_TO_KEEP },
                  llmProvider,
                  activeModel,
                );
                if (result.compressed) {
                  const now = Date.now();
                  const SEP = "之前的对话已被压缩";
                  const keepStart = result.originalRange?.[1] ?? 0;
                  const snapshot = activeConv.messages;
                  // Compressed zone: strip thinking/toolCalls, remove old separators
                  const compressedZone: Message[] = snapshot.slice(0, keepStart)
                    .filter((m) => m.content !== SEP)
                    .map((m) => ({ ...m, thinking: undefined, toolCalls: undefined }));
                  // Separator between compressed zone and kept zone
                  const separator: Message = {
                    id: `compressed-sep-${now}`,
                    role: "user",
                    content: SEP,
                    timestamp: now,
                  };
                  // Kept zone: preserve full metadata, remove old separators
                  const keptMsgs: Message[] = snapshot.slice(keepStart)
                    .filter((m) => m.content !== SEP)
                    .map((m, i) => ({ ...m, id: `kept-${now}-${i}` }));
                  replaceMessages(convId, [...compressedZone, separator, ...keptMsgs]);
                  if (activeWorld) {
                    rewriteSessionMessages(
                      activeWorld.path,
                      convId,
                      [...messagesToSessionLines(compressedZone), ...messagesToSessionLines([separator]), ...messagesToSessionLines(keptMsgs)],
                    ).catch(() => {});
                  }
                  markCompressed(convId, result.summary, result.tokenSavings);
                  const story = activeWorld?.stories.find((s) => s.conversations.some((c) => c.id === convId));
                  const systemPrompt = buildSystemPrompt(activeWorld?.name || "", story?.title || "", [], undefined, "", "", useStore.getState().language);
                  const messagesTokens = estimateTokens(result.messages.map((m) => m.content).join("\n"));
                  const systemPromptTokens = estimateTokens(systemPrompt);
                  const used = messagesTokens + systemPromptTokens;
                  useStore.getState().updateContextUsage(used, {
                    messages: messagesTokens,
                    systemTools: 0,
                    mcpTools: 0,
                    systemPrompt: systemPromptTokens,
                    skills: 0,
                    total: used,
                  }, convId);
                  window.dispatchEvent(
                    new CustomEvent("worldforge-compressed", {
                      detail: { summary: result.summary, tokenSavings: result.tokenSavings },
                    }),
                  );
                }
              } catch (e) {
                console.error("[compression] Manual compress failed:", e);
              } finally {
                setCompressing(false);
              }
            }}
            disabled={isCompressing || !activeConv || !llmProvider || !canCompress}
            className="w-full py-1.5 text-[0.688rem] text-ink-secondary hover:text-ink hover:bg-surface-800 rounded transition-colors disabled:opacity-50"
          >
            {isCompressing ? t.chat.compressing : canCompress ? t.chat.compressNow : "暂不可压缩"}
          </button>
        </div>
      )}
    </div>
  );
}

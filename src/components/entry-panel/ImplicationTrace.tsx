import { useState, useEffect, useMemo } from "react";
import { invoke } from "@/lib/api";
import { ChevronDown, ChevronRight, Share2, Clock } from "lucide-react";
import type { TimelinePeriod } from "@/lib/types";

interface ImplicationProps {
  worldPath: string;
  entryId: string;
  entryName: string;
  timelineSummary?: TimelinePeriod[];
  onNavigate?: (entityType: string, entityId: string) => void;
}

/**
 * ImplicationTrace — 按时间线排序展示词条关联。
 *
 * 优先使用 entry 的 timeline_summary（每个 period 带 state/location/relationships），
 * 然后用 relations/index.json 的图遍历补充分支关联。
 */
export function ImplicationTrace({ worldPath, entryId, entryName, timelineSummary, onNavigate }: ImplicationProps) {
  const [graphRelatives, setGraphRelatives] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(true);
  const [graphExpanded, setGraphExpanded] = useState(true);
  const [allTls, setAllTls] = useState<any[]>([]);
  const [activeGraphTlId, setActiveGraphTlId] = useState("");
  const [entryNames, setEntryNames] = useState<Map<string, string>>(new Map());

  // 加载词条名称映射
  useEffect(() => {
    if (!worldPath) return;
    invoke<any[]>("list_entries", { worldPath })
      .then((entries) => {
        const map = new Map<string, string>();
        if (Array.isArray(entries)) {
          for (const e of entries) map.set(e.id, e.name);
        }
        setEntryNames(map);
      })
      .catch(() => {});
  }, [worldPath]);

  // 加载时间线列表
  useEffect(() => {
    if (!worldPath) return;
    invoke<any[]>("list_timelines", { worldPath })
      .then((tls) => {
        setAllTls(Array.isArray(tls) ? tls : []);
        if (!activeGraphTlId && tls && tls.length > 0) {
          const def = tls.find((t: any) => t.is_default) || tls[0];
          if (def) setActiveGraphTlId(def.id);
        }
      })
      .catch(() => {});
  }, [worldPath]);

  // 从图数据库加载关联。传 timelineId 时只返回跨时间轴边 + 该时间轴的事件边
  useEffect(() => {
    if (!worldPath) return;
    let cancelled = false;
    setLoading(true);
    const params: Record<string, unknown> = { worldPath, entityType: "entry", entityId: entryId, maxDepth: 1 };
    if (activeGraphTlId) params.timelineId = activeGraphTlId;
    invoke<any[]>("traverse_graph", params)
      .then((results) => {
        if (!cancelled) { setGraphRelatives(Array.isArray(results) ? results : []); setLoading(false); }
      })
      .catch(() => { if (!cancelled) { setGraphRelatives([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [worldPath, entryId, activeGraphTlId]);

  const hasTimeline = timelineSummary && timelineSummary.length > 0;
  // Filter graph results: only show entries (exclude events, timelines, outline)
  const graphEntries = useMemo(() => graphRelatives.filter((r: any) => r.entity.type === "entry"), [graphRelatives]);
  const hasGraph = graphEntries.length > 0;

  // 增量 diff：每段只展示相对于上一段的变化
  const diffs = useMemo(() => {
    if (!timelineSummary) return [];
    return timelineSummary.map((tp, i) => {
      const prev = i > 0 ? timelineSummary[i - 1] : undefined;
      return { ...tp, _diff: computeDiff(tp, prev) };
    });
  }, [timelineSummary]);

  if (!hasTimeline && !hasGraph) return null;

  return (
    <div className="mt-3 pt-3 border-t border-surface-700/50">
      {/* ── 时间线排序的关联 ── */}
      {hasTimeline && (
        <div className="mb-2">
          <button
            onClick={() => setTimelineExpanded(!timelineExpanded)}
            className="flex items-center gap-1.5 px-1 py-1 w-full text-left"
          >
            {timelineExpanded ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
            <Clock className="w-3 h-3 text-ink-muted" />
            <span className="text-[11px] text-ink-muted font-medium">时间线关联</span>
            <span className="text-[10px] text-ink-muted/50">{timelineSummary.length} 个时期</span>
          </button>
          {timelineExpanded && (
            <div className="mt-1 space-y-2">
              {diffs.map((tp, i) => {
                const { added, removed } = tp._diff;
                const initial = i === 0;
                const hasChanges = added.length > 0 || removed.length > 0;
                return (
                <div key={i} className="pl-4 border-l-2 border-surface-700/50 ml-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-mono text-ink-muted bg-surface-800 px-1 py-0.5 rounded">
                      {fmtPeriod(tp.period)}
                    </span>
                    {tp.state && <span className="text-[11px] text-ink-secondary font-medium">{tp.state}</span>}
                    {tp.location && <span className="text-[10px] text-ink-muted/50">@{tp.location}</span>}
                    {!initial && !hasChanges && (
                      <span className="text-[9px] text-ink-muted/30 ml-1">— 无变化</span>
                    )}
                  </div>
                  {/* 阶段简述 */}
                  {tp.summary && (
                    <p className="text-[11px] text-ink-muted/70 italic leading-relaxed ml-1 mb-1.5">
                      {tp.summary}
                    </p>
                  )}
                  {/* 初始段：展示所有关系 */}
                  {initial && tp.relationships && tp.relationships.length > 0 && (
                    <div className="flex flex-wrap gap-1 ml-1">
                      {tp.relationships.map((r, j) => (
                        <RelBadge key={j} r={r} onNavigate={onNavigate} entryNames={entryNames} />
                      ))}
                    </div>
                  )}
                  {/* 后续段：仅展示变化 */}
                  {!initial && hasChanges && (
                    <div className="flex flex-wrap gap-1 ml-1">
                      {added.map((r, j) => (
                        <RelBadge key={`add-${j}`} r={r} onNavigate={onNavigate} added entryNames={entryNames} />
                      ))}
                      {removed.map((r, j) => (
                        <RelBadge key={`rem-${j}`} r={r} onNavigate={onNavigate} removed entryNames={entryNames} />
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 全量图关联（折叠）── */}
      {hasGraph && (
        <div>
          <button
            onClick={() => setGraphExpanded(!graphExpanded)}
            className="flex items-center gap-1.5 px-1 py-1 w-full text-left"
          >
            {graphExpanded ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
            <Share2 className="w-3 h-3 text-ink-muted" />
            <span className="text-[11px] text-ink-muted font-medium">全量关联</span>
            <span className="text-[10px] text-ink-muted/50">{graphEntries.length} 个关联词条</span>
            {allTls.length > 1 && (
              <select className="text-[10px] bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 ml-auto"
                value={activeGraphTlId}
                onChange={e => { e.stopPropagation(); setActiveGraphTlId(e.target.value); }}
                onClick={e => e.stopPropagation()}>
                {allTls.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </button>
          {graphExpanded && (
            <div className="mt-1 space-y-1">
              {groupBy(graphEntries, "via_description").map(([relation, entities]) => (
                <div key={relation} className="pl-4">
                  <p className="text-[10px] text-ink-muted/50 uppercase tracking-wider mb-0.5">{relation}</p>
                  <div className="flex flex-wrap gap-1">
                    {entities.map((r: any, i: number) => (
                      <button
                        key={`${r.entity.id}-${i}`}
                        onClick={() => onNavigate?.("entry", r.entity.id)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-surface-800/50 text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                      >
                        {r.entity.name || entryNames.get(r.entity.id) || `${r.entity.entity_type}:${r.entity.id.slice(0, 8)}`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fmtPeriod(p: [number | null, number | null]): string {
  const start = p[0] ?? "∞";
  const end = p[1] ?? "∞";
  return `${start}→${end}`;
}

function groupBy<T>(arr: T[], key: keyof T | ((item: T) => string)): [string, T[]][] {
  const map: Record<string, T[]> = {};
  for (const item of arr) {
    const k = typeof key === "function" ? key(item) : String(item[key]);
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return Object.entries(map);
}

/** 计算当前 period 相比上一段的增量变化 */
function computeDiff(
  current: TimelinePeriod,
  previous?: TimelinePeriod,
): { added: { target: string; description: string }[]; removed: { target: string; description: string }[] } {
  const currRels = current.relationships ?? [];
  const prevRels = previous?.relationships ?? [];

  // 当前段没有显式记录关系变更（如自动生成的大纲引用），不推导出任何增删
  if (currRels.length === 0) {
    return { added: [], removed: [] };
  }

  const prevMap = new Map(prevRels.map(r => [r.target, r.description]));
  const currMap = new Map(currRels.map(r => [r.target, r.description]));

  const added = currRels.filter(
    r => prevMap.get(r.target) !== r.description,
  );
  const removed = prevRels.filter(
    r => currMap.get(r.target) !== r.description,
  );

  return { added, removed };
}

/** 单个关系徽标 */
function RelBadge({
  r,
  onNavigate,
  added,
  removed,
  entryNames,
}: {
  r: { target: string; description: string };
  onNavigate?: (entityType: string, entityId: string) => void;
  added?: boolean;
  removed?: boolean;
  entryNames: Map<string, string>;
}) {
  let badgeCls = "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors bg-surface-800/50 text-ink-muted hover:text-ink hover:bg-surface-800";
  let prefix = "";
  if (added) {
    badgeCls = "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/40";
    prefix = "+";
  } else if (removed) {
    badgeCls = "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400/70 hover:bg-red-200 dark:hover:bg-red-800/40 line-through";
    prefix = "−";
  }
  return (
    <button
      onClick={() => onNavigate?.("entry", r.target)}
      className={badgeCls}
    >
      {prefix && <span>{prefix}</span>}
      {r.description}
      <span className="text-ink-muted/50">→</span>
      {entryNames.get(r.target) || r.target.slice(0, 8)}
    </button>
  );
}

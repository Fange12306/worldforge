import { useState, useEffect, useMemo } from "react";
import { invoke } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { TraversalResult } from "@/lib/types";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";
import { formatFullTime } from "@/lib/time-format";
import type { TU } from "@/lib/time-format";

interface ImplicationProps {
  worldPath: string;
  entryId: string;
  entryName: string;
  timelineSummary?: any[];
  onNavigate?: (entityType: string, entityId: string) => void;
}

/**
 * ImplicationTrace — 展示词条的静态关联图（relations/index.json）。
 * 时间线事件中的关系变化由 EntryTimelineEvents 独立展示。
 */
export function ImplicationTrace({ worldPath, entryId, entryName, onNavigate }: ImplicationProps) {
  const { t, language } = useT();
  const [graphRelatives, setGraphRelatives] = useState<TraversalResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(true);
  const [allTls, setAllTls] = useState<any[]>([]);
  const [activeGraphTlId, setActiveGraphTlId] = useState("");
  const [entryNames, setEntryNames] = useState<Map<string, string>>(new Map());
  const [filterTimePoint, setFilterTimePoint] = useState("");
  const [timePoints, setTimePoints] = useState<string[]>([]);

  useEffect(() => {
    if (!worldPath) { setTimePoints([]); return; }
    invoke<string[]>("list_distinct_time_points", { worldPath })
      .then((pts) => {
        const tps = Array.isArray(pts) ? pts : [];
        setTimePoints(tps);
        if (tps.length > 0) setFilterTimePoint(tps[tps.length - 1]);
      })
      .catch((e) => console.error("[ImplicationTrace] list_distinct_time_points failed", e));
  }, [worldPath]);

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

  useEffect(() => {
    if (!worldPath) return;
    let cancelled = false;
    setLoading(true);
    const params: Record<string, unknown> = { worldPath, entityType: "entry", entityId: entryId, maxDepth: 1 };
    if (activeGraphTlId) params.timelineId = activeGraphTlId;
    if (filterTimePoint.trim()) params.timePoint = filterTimePoint.trim();
    invoke<TraversalResult[]>("traverse_graph", params)
      .then((results) => {
        if (!cancelled) { setGraphRelatives(Array.isArray(results) ? results : []); setLoading(false); }
      })
      .catch((e) => { console.error("[ImplicationTrace] traverse_graph failed", e); if (!cancelled) { setGraphRelatives([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [worldPath, entryId, activeGraphTlId, filterTimePoint]);

  const graphEntries = useMemo(() => graphRelatives.filter((r) => r.entity.type === "entry"), [graphRelatives]);
  const units = useMemo(() => {
    const tl = allTls.find((t: any) => t.id === activeGraphTlId);
    return (tl?.time_format?.units as TU[]) || [];
  }, [allTls, activeGraphTlId]);

  return (
    <div className="mt-3 pt-3 border-t border-surface-700/50">
      <button
        onClick={() => setGraphExpanded(!graphExpanded)}
        className="flex items-center gap-1.5 px-1 py-1 w-full text-left"
      >
        {graphExpanded ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
        <Share2 className="w-3 h-3 text-ink-muted" />
        <span className="text-[0.688rem] text-ink-muted font-medium">{t.entry.relationGraph}</span>
        <span className="text-[0.625rem] text-ink-muted/50">{t.entry.relationGraphCount(graphEntries.length)}</span>
        {allTls.length > 1 && (
          <select className="text-[0.625rem] bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 ml-auto"
            value={activeGraphTlId}
            onChange={e => { e.stopPropagation(); setActiveGraphTlId(e.target.value); }}
            onClick={e => e.stopPropagation()}>
            {allTls.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </button>
      {graphExpanded && (
        <div className="mt-1 space-y-1">
          {timePoints.length > 0 && (
          <div className="flex items-center gap-1 px-4 mb-1">
            <span className="text-[0.56rem] text-ink-muted/40">🕐</span>
            <select value={filterTimePoint} onChange={e => { e.stopPropagation(); setFilterTimePoint(e.target.value); }} onClick={e => e.stopPropagation()} className="text-[0.625rem] bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 text-ink-muted min-w-[15rem]">
              {timePoints.map(tp => <option key={tp} value={tp}>{units.length > 0 ? formatFullTime(tp, units, null, language) : tp}</option>)}
            </select>
            {filterTimePoint && <button onClick={e => { e.stopPropagation(); setFilterTimePoint(""); }} className="text-[0.56rem] text-ink-muted/30 hover:text-ink-muted">✕</button>}
          </div>
          )}
          {graphEntries.length === 0 ? (
            <div className="px-4 py-2 text-[0.625rem] text-ink-muted/40 italic">{t.entry.graphNoRelations}</div>
          ) : groupBy(graphEntries, "via_description").map(([relation, entities]) => (
            <div key={relation} className="pl-4">
              <p className="text-[0.625rem] text-ink-muted/50 uppercase tracking-wider mb-0.5">{relation}</p>
              <div className="flex flex-wrap gap-1">
                {entities.map((r, i) => (
                  <button
                    key={`${r.entity.id}-${i}`}
                    onClick={() => onNavigate?.("entry", r.entity.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[0.625rem] rounded bg-surface-800/50 text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                  >
                    {r.entity.name || entryNames.get(r.entity.id) || `…${r.entity.id.slice(0, 8)}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          </div>
      )}
    </div>
  );
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

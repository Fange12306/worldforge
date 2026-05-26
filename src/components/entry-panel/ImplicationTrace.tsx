import { useState, useEffect, useMemo } from "react";
import { invoke } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";

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
  const { t } = useT();
  const [graphRelatives, setGraphRelatives] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(true);
  const [allTls, setAllTls] = useState<any[]>([]);
  const [activeGraphTlId, setActiveGraphTlId] = useState("");
  const [entryNames, setEntryNames] = useState<Map<string, string>>(new Map());

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
    invoke<any[]>("traverse_graph", params)
      .then((results) => {
        if (!cancelled) { setGraphRelatives(Array.isArray(results) ? results : []); setLoading(false); }
      })
      .catch(() => { if (!cancelled) { setGraphRelatives([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [worldPath, entryId, activeGraphTlId]);

  const graphEntries = useMemo(() => graphRelatives.filter((r: any) => r.entity.type === "entry"), [graphRelatives]);
  if (graphEntries.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-surface-700/50">
      <button
        onClick={() => setGraphExpanded(!graphExpanded)}
        className="flex items-center gap-1.5 px-1 py-1 w-full text-left"
      >
        {graphExpanded ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
        <Share2 className="w-3 h-3 text-ink-muted" />
        <span className="text-[11px] text-ink-muted font-medium">{t.entry.relationGraph}</span>
        <span className="text-[10px] text-ink-muted/50">{t.entry.relationGraphCount(graphEntries.length)}</span>
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
                    {r.entity.name || entryNames.get(r.entity.id) || r.entity.id.slice(0, 8)}
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

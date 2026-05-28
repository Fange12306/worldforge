/**
 * EntryTimelineEvents — shows timeline events for a single entry.
 * Nested tree: 纪元 → 年 (collapsible) → events with time label.
 * Same time format as TimelinePanel.
 */
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@/lib/api";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  type TU,
  segs,
  formatEraLabel,
  formatYearLabel,
  formatLeafLabel,
} from "@/lib/time-format";

const a = (x: any) => x || [];

interface Props { worldPath: string; entryId: string; onNavigateToTimeline?: (eventId: string, timelineId: string) => void; onNavigateEntry?: (entryId: string) => void; initialActiveTlId?: string; }
interface SimpleEvent { id: string; timeline_id: string; time_point: string; precision?: number; summary: string;
  linked_entries: { entry_id: string; perspective_summary?: string }[];
  relationship_changes: { entry_a: string; entry_b: string; change_type: string; relation: string }[];
}

// ── Tree ──
type Node = { key: string; depth: number; label: string; evs: SimpleEvent[] };
function buildTree(events: SimpleEvent[], u: TU[], lang: "zh" | "en"): { key: string; depth: number; label: string; children: Node[] }[] {
  const ei = u.findIndex(x => x.key === "era");
  const yi = u.findIndex(x => x.key === "year");
  const root: any[] = [];
  // Group by time_point to merge same-time events
  const byTime = new Map<string, SimpleEvent[]>();
  for (const ev of events) {
    const l = byTime.get(ev.time_point) || [];
    l.push(ev); byTime.set(ev.time_point, l);
  }
  for (const [tp, evs] of byTime) {
    const s = segs(tp);
    let cur = root;
    if (ei >= 0) {
      const v = s[ei + 1] || 0; const k = `e:${v}`;
      let n = cur.find((x: any) => x.key === k);
      if (!n) { n = { key: k, depth: 0, label: formatEraLabel(v, lang), children: [] }; cur.push(n); }
      cur = n.children;
    }
    if (yi >= 0) {
      const v = s[yi + 1] || 0; const k = `${(cur as any)?.key || ""}/y:${v}`;
      let n = cur.find((x: any) => x.key === k);
      if (!n) { n = { key: k, depth: 1, label: formatYearLabel(v, lang), children: [] }; cur.push(n); }
      cur = n.children;
    }
    cur.push({ key: tp, depth: 2, label: formatLeafLabel(tp, u, evs[0]?.precision, lang), evs });
  }
  return root;
}

// ── Component ──
export function EntryTimelineEvents({ worldPath, entryId, onNavigateToTimeline, onNavigateEntry, initialActiveTlId }: Props) {
  const { t, language } = useT();
  const [allTls, setAllTls] = useState<any[]>([]);
  const [activeTlId, setActiveTlId] = useState("");
  const [allEvents, setAllEvents] = useState<SimpleEvent[]>([]);
  const [units, setUnits] = useState<TU[]>([]);
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState("");
  const [openEras, setOpenEras] = useState<Set<string>>(new Set());
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const tls: any[] = await invoke("list_timelines", { worldPath }) || [];
        if (ok) {
          setAllTls(tls);
          const defaultTl = tls.find((t:any) => t.is_default) || tls[0];
          if (defaultTl) {
            const preferId = initialActiveTlId && tls.find((t: any) => t.id === initialActiveTlId) ? initialActiveTlId : defaultTl.id;
            setActiveTlId(preferId);
            const preferTl = tls.find((t: any) => t.id === preferId);
            const fmt = preferTl?.time_format || defaultTl.time_format;
            if (fmt) setUnits(fmt.units || []);
          }
        }
        const all: SimpleEvent[] = [];
        for (const tl of tls) {
          try { const evts = await invoke("list_events", { worldPath, timelineId: tl.id, entryId }) || []; if (ok) all.push(...(evts as SimpleEvent[])); } catch (_) {}
        }
        if (ok) { setAllEvents(all.sort((a, b) => (a.time_point || "").localeCompare(b.time_point || ""))); }
      } catch (e) { if (ok) setErr(String(e)); }
    })();
    return () => { ok = false; };
  }, [worldPath, entryId]);

  // Switch time format when active timeline changes
  useEffect(() => {
    const tl = allTls.find((t: any) => t.id === activeTlId);
    if (tl?.time_format) setUnits(tl.time_format.units || []);
  }, [activeTlId, allTls]);

  const events = useMemo(() =>
    allEvents.filter(e => e.timeline_id === activeTlId),
    [allEvents, activeTlId]
  );

  const tree = useMemo(() => (units.length > 0 && events) ? buildTree(events, units, language) : [], [events, units, language]);

  const [expandTick, setExpandTick] = useState(0);
  useEffect(() => { setExpandTick(t => t + 1); }, [activeTlId]);
  useEffect(() => {
    if (tree.length > 0) {
      const eras = new Set<string>();
      const years = new Set<string>();
      for (const era of tree) {
        eras.add(era.key);
        for (const year of era.children) years.add(year.key);
      }
      setOpenEras(eras);
      setOpenYears(years);
    }
  }, [tree, expandTick]);

  if (err) return null;
  if (!events || allEvents.length === 0) return null;

  const toggleEra = (k: string) => setOpenEras(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleYear = (k: string) => setOpenYears(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="mt-3 pt-3 border-t border-surface-700/50">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 px-1 py-1 w-full text-left">
        {open ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
        <span className="text-[0.625rem] text-ink-muted/50">🕐</span>
        <span className="text-[0.688rem] text-ink-muted font-medium">{t.entry.timelineEvents}</span>
        <span className="text-[0.625rem] text-ink-muted/50">{events.length}{t.entry.events}</span>
        {allTls.length > 1 && (
          <select className="text-[0.625rem] bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 ml-auto"
            value={activeTlId} onChange={e => setActiveTlId(e.target.value)}
            onClick={e => e.stopPropagation()}>
            {allTls.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </button>
      {open && events.length === 0 && (
        <div className="ml-1 pl-5 py-1 text-[0.625rem] text-ink-muted/50 italic">{t.entry.noTimelineEvents}</div>
      )}
      {open && events.length > 0 && (
        <div className="mt-1 ml-1">
          {tree.map(era => {
            const eraOpen = openEras.has(era.key);
            return (<div key={era.key}>
              <button onClick={() => toggleEra(era.key)} className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-surface-800/20">
                {eraOpen ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
                <span className="text-[0.688rem] font-medium text-ink-muted">{era.label}</span>
                <span className="text-[0.625rem] text-ink-muted/30">({era.children.reduce((s: number, y: any) => s + (y.children?.length || 0), 0)}{t.entry.events})</span>
              </button>
              {eraOpen && <div className="ml-4 border-l-2 border-surface-700/30 pl-3">
                {era.children.map((year: any) => {
                  const yOpen = openYears.has(year.key);
                  return (<div key={year.key}>
                    <button onClick={() => toggleYear(year.key)} className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-surface-800/20">
                      {yOpen ? <ChevronDown className="w-3 h-3 text-ink-muted" /> : <ChevronRight className="w-3 h-3 text-ink-muted" />}
                      <span className="text-[0.688rem] text-ink-muted/70">{year.label}</span>
                      <span className="text-[0.625rem] text-ink-muted/30">({year.children?.length || 0}{t.entry.events})</span>
                    </button>
                    {yOpen && <div className="ml-4 border-l-2 border-amber-500/20 pl-3 space-y-3 pt-0.5">
                      {(year.children || []).map((n: any) => {
                        const evs: SimpleEvent[] = n.evs;
                        return (<div key={n.key} className="flex items-start gap-2">
                          <div className="w-[5px] h-[5px] rounded-full bg-amber-500/40 mt-1.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-[0.625rem] font-mono text-ink-muted/50">{n.label}</span>
                            {evs.map((ev: SimpleEvent) => {
                              const rcs = a(ev.relationship_changes).filter((r: any) => r.entry_a === entryId || r.entry_b === entryId);
                              const le = a(ev.linked_entries).find((l: any) => l.entry_id === entryId);
                              return (
                                <div key={ev.id} className="mt-1 ml-2 pl-2 border-l border-surface-700/30">
                                  <button onClick={() => onNavigateToTimeline?.(ev.id, ev.timeline_id)}
                                    className="text-[0.688rem] text-left text-amber-500 hover:text-amber-400 transition-colors cursor-pointer leading-snug">
                                    {le?.perspective_summary || ev.summary || ""}
                                  </button>
                                  {rcs.length > 0 && (<div className="mt-0.5 flex flex-wrap gap-1">
                                    {rcs.map((r: any, j: number) => (
                                      <button key={j} onClick={(e) => { e.stopPropagation(); onNavigateEntry?.(r.entry_a === entryId ? r.entry_b : r.entry_a); }} title={r.description || ""} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[0.56rem] rounded-full cursor-pointer transition-colors ${
                                        r.change_type === "add" ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20" : "bg-red-500/10 text-red-500 hover:bg-red-500/20 line-through"}`}>
                                        {r.change_type === "add" ? "+" : "−"} {entryNames.get(r.entry_a === entryId ? r.entry_b : r.entry_a) || (r.entry_a === entryId ? r.entry_b : r.entry_a).slice(0, 8)}: {r.relation}
                                      </button>
                                    ))}</div>)}
                                </div>
                              );
                            })}
                          </div>
                        </div>);
                      })}</div>}
                  </div>);
                })}</div>}
            </div>);
          })}
        </div>
      )}
    </div>
  );
}

/**
 * EntryTimelineEvents — shows timeline events for a single entry.
 * Nested tree: 纪元 → 年 (collapsible) → events with time label.
 * Same time format as TimelinePanel.
 */
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@/lib/api";

const a = (x: any) => x || [];

interface Props { worldPath: string; entryId: string; onNavigateToTimeline?: (eventId: string) => void; }
interface SimpleEvent { id: string; time_point: string; precision?: number; summary: string;
  linked_entries: { entry_id: string; perspective_summary?: string }[];
  relationship_changes: { entry_a: string; entry_b: string; change_type: string; relation: string }[];
}
interface TU { key: string; name: string; digits: number; }

// ── Time formatters ──
function segs(tp: string): number[] { return tp.split("-").map(s => parseInt(s, 10) || 0); }

function leafLabel(tp: string, u: TU[], precision?: number | null): string {
  const s = segs(tp);
  const maxIdx = precision != null ? precision : u.length - 1;
  const mi = u.findIndex(x => x.key === "month");
  const di = u.findIndex(x => x.key === "day");
  let r = "";
  if (mi >= 0 && mi <= maxIdx) { const v = s[mi + 1] || 0; r += `${v}${u[mi].name}`; }
  if (di >= 0 && di <= maxIdx) { const v = s[di + 1] || 0; r += `${v}${u[di].name}`; }
  if (!r) return tp;
  const startIdx = Math.max(di, mi) + 1;
  const tparts: string[] = [];
  for (let i = startIdx; i < u.length && i <= maxIdx; i++) tparts.push(String(s[i + 1] || 0).padStart(u[i].digits, "0"));
  if (tparts.length > 0 && !tparts.every(t => !t || parseInt(t, 10) === 0)) r += tparts.join(":");
  return r;
}

// ── Tree ──
type Node = { key: string; depth: number; label: string; evs: SimpleEvent[] };
function buildTree(events: SimpleEvent[], u: TU[]): { key: string; depth: number; label: string; children: Node[] }[] {
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
      if (!n) { n = { key: k, depth: 0, label: `${v}${u[ei].name}`, children: [] }; cur.push(n); }
      cur = n.children;
    }
    if (yi >= 0) {
      const v = s[yi + 1] || 0; const k = `${(cur as any)?.key || ""}/y:${v}`;
      let n = cur.find((x: any) => x.key === k);
      if (!n) { n = { key: k, depth: 1, label: `${v}${u[yi].name}`, children: [] }; cur.push(n); }
      cur = n.children;
    }
    cur.push({ key: tp, depth: 2, label: leafLabel(tp, u, evs[0]?.precision), evs });
  }
  return root;
}

// ── Component ──
export function EntryTimelineEvents({ worldPath, entryId, onNavigateToTimeline }: Props) {
  const [events, setEvents] = useState<SimpleEvent[] | null>(null);
  const [units, setUnits] = useState<TU[]>([]);
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState("");
  const [openEras, setOpenEras] = useState<Set<string>>(new Set());
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const tls: any[] = await invoke("list_timelines", { worldPath }) || [];
        if (tls.length > 0) {
          const fmt = tls[0].time_format || tls[tls.length - 1]?.time_format;
          if (fmt) setUnits(fmt.units || []);
        }
        const all: SimpleEvent[] = [];
        for (const tl of tls) {
          try { const evts = await invoke("list_events", { worldPath, timelineId: tl.id, entryId }) || []; if (ok) all.push(...(evts as SimpleEvent[])); } catch (_) {}
        }
        if (ok) { setEvents(all.sort((a, b) => (a.time_point || "").localeCompare(b.time_point || ""))); }
      } catch (e) { if (ok) setErr(String(e)); }
    })();
    return () => { ok = false; };
  }, [worldPath, entryId]);

  const tree = useMemo(() => (units.length > 0 && events) ? buildTree(events, units) : [], [events, units]);

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
  }, [tree.length]);

  if (err || !events || events.length === 0) return null;

  const toggleEra = (k: string) => setOpenEras(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleYear = (k: string) => setOpenYears(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="mt-3 pt-3 border-t border-surface-700/50">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 px-1 py-1 w-full text-left">
        <span className="text-[10px] text-ink-muted/50 w-3">{open ? "▾" : "▸"}</span>
        <span className="text-[10px] text-ink-muted/50">🕐</span>
        <span className="text-[11px] text-ink-muted font-medium">时间线事件</span>
        <span className="text-[10px] text-ink-muted/50">{events.length} 个</span>
      </button>
      {open && (
        <div className="mt-1 ml-1">
          {tree.map(era => {
            const eraOpen = openEras.has(era.key);
            return (<div key={era.key}>
              <button onClick={() => toggleEra(era.key)} className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-surface-800/20">
                <span className="text-[10px] text-ink-muted/50 w-3">{eraOpen ? "▾" : "▸"}</span>
                <span className="text-[11px] font-medium text-ink-muted">{era.label}</span>
                <span className="text-[10px] text-ink-muted/30">({era.children.reduce((s: number, y: any) => s + (y.children?.length || 0), 0)} 事件)</span>
              </button>
              {eraOpen && <div className="ml-4 border-l-2 border-surface-700/30 pl-3">
                {era.children.map((year: any) => {
                  const yOpen = openYears.has(year.key);
                  return (<div key={year.key}>
                    <button onClick={() => toggleYear(year.key)} className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-surface-800/20">
                      <span className="text-[10px] text-ink-muted/50 w-3">{yOpen ? "▾" : "▸"}</span>
                      <span className="text-[11px] text-ink-muted/70">{year.label}</span>
                      <span className="text-[10px] text-ink-muted/30">({year.children?.length || 0}事件)</span>
                    </button>
                    {yOpen && <div className="ml-4 border-l-2 border-amber-500/20 pl-3 space-y-3 pt-0.5">
                      {(year.children || []).map((n: any) => {
                        const evs: SimpleEvent[] = n.evs;
                        return (<div key={n.key} className="flex items-start gap-2">
                          <div className="w-[5px] h-[5px] rounded-full bg-amber-500/40 mt-1.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-mono text-ink-muted/50">{n.label}</span>
                            {evs.map((ev: SimpleEvent) => {
                              const rcs = a(ev.relationship_changes).filter((r: any) => r.entry_a === entryId || r.entry_b === entryId);
                              const le = a(ev.linked_entries).find((l: any) => l.entry_id === entryId);
                              return (
                                <div key={ev.id} className="mt-1 ml-2 pl-2 border-l border-surface-700/30">
                                  <button onClick={() => onNavigateToTimeline?.(ev.id)}
                                    className="text-[11px] text-left text-amber-500 hover:text-amber-400 transition-colors cursor-pointer leading-snug">
                                    {le?.perspective_summary || ev.summary || ""}
                                  </button>
                                  {rcs.length > 0 && (<div className="mt-0.5 flex flex-wrap gap-1">
                                    {rcs.map((r: any, j: number) => (
                                      <span key={j} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded-full ${
                                        r.change_type === "add" ? "bg-emerald-500/10 text-emerald-500" : r.change_type === "delete" ? "bg-red-500/10 text-red-500 line-through" : "bg-amber-500/10 text-amber-500"}`}>
                                        {r.change_type === "add" ? "+" : r.change_type === "delete" ? "−" : "~"} {r.entry_a === entryId ? r.entry_b : r.entry_a}: {r.relation}
                                      </span>
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

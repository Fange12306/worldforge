/**
 * TimelinePanel — Phase 5
 * Tree: 纪元 → 年 (collapsible) → events with flat label "5月30日19:00:00"
 * Popover via portal. All array access null-safe.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "../../lib/api";
import { useT } from "../../lib/i18n";
import type { WorldEvent, Timeline } from "../../lib/types";

// ── Safe access ──
const a = (x: any) => x || [];

// ── Time helpers ──
interface TU { key: string; name: string; digits: number; }
function getUnits(tl: Timeline | null): TU[] {
  return tl?.time_format?.units?.map((u: any) => ({ key: u.key, name: u.name, digits: u.digits })) || [];
}
function segs(tp: string): number[] { return tp.split("-").map(s => parseInt(s, 10) || 0); }

/** Leaf label truncated to precision: 3月15日08:30:00 or 3月15日 (no parens, time colons) */
function leafLabel(tp: string, tl: Timeline | null, precision?: number | null): string {
  const s = segs(tp); const u = getUnits(tl);
  const maxIdx = precision != null ? precision : u.length - 1;
  // Tree already shows era + year — leaf label only covers month onward
  const mi = u.findIndex(x => x.key === "month");
  const di = u.findIndex(x => x.key === "day");
  const parts: string[] = [];
  if (mi >= 0 && mi <= maxIdx) { const v = s[mi + 1] || 0; if (v > 0) parts.push(`${v}${u[mi].name}`); }
  if (di >= 0 && di <= maxIdx) { const v = s[di + 1] || 0; if (v > 0) parts.push(`${v}${u[di].name}`); }
  // Time portion
  for (let i = Math.max(di, mi) + 1; i < u.length && i <= maxIdx; i++) {
    parts.push(String(s[i + 1] || 0).padStart(u[i].digits, "0"));
  }
  return parts.join("");
}

function fmtTime(tp: string, tl: Timeline | null, precision?: number | null): string {
  const s = segs(tp); const u = getUnits(tl);
  const maxIdx = precision != null ? precision : u.length - 1;
  const parts: string[] = [];
  for (let i = 0; i < u.length; i++) {
    if (i > maxIdx) break;
    const v = s[i + 1] || 0;
    if (i <= maxIdx && v > 0) parts.push(`${v}${u[i].name}`);
  }
  if (parts.length >= 3) {
    const last3 = parts.slice(-3);
    const labs = last3.map(p => p.replace(/[0-9]/g, ""));
    if (labs.every(l => l === "时" || l === "分" || l === "秒")) {
      const nums = last3.map(p => p.replace(/[^0-9]/g, ""));
      const dates = parts.slice(0, -3);
      if (!nums.every(n => n === "00" || n === "0")) return dates.join("") + nums.join(":");
      return dates.join("");
    }
  }
  return parts.join("");
}

// ── Tree ──
type TreeNode = {
  key: string; depth: number; label: string;
  events: WorldEvent[]; children: TreeNode[];
};

function buildTree(events: WorldEvent[], tl: Timeline | null): TreeNode[] {
  const u = getUnits(tl);
  const eraI = u.findIndex(x => x.key === "era");
  const yearI = u.findIndex(x => x.key === "year");
  const root: TreeNode[] = [];
  for (const ev of events) {
    const s = segs(ev.time_point);
    let cur = root;
    if (eraI >= 0) {
      const v = s[eraI + 1] || 0; const k = `e:${v}`;
      let n = cur.find(x => x.key === k);
      if (!n) { n = { key: k, depth: 0, label: `${v}${u[eraI].name}`, events: [], children: [] }; cur.push(n); }
      cur = n.children;
    }
    if (yearI >= 0) {
      const v = s[yearI + 1] || 0; const k = `${cur === root ? "" : (root[0]?.key || "")}/y:${v}`;
      let n = cur.find(x => x.key === k);
      if (!n) { n = { key: k, depth: 1, label: `${v}${u[yearI].name}`, events: [], children: [] }; cur.push(n); }
      cur = n.children;
    }
    // Leaf: events hang directly under year with precision-truncated label
    cur.push({ key: `leaf:${ev.id}`, depth: 2, label: leafLabel(ev.time_point, tl, ev.precision), events: [ev], children: [] });
  }
  return root;
}

function countAll(n: TreeNode): number {
  return n.events.length + n.children.reduce((s, c) => s + countAll(c), 0);
}
/** Collect all collapsible keys (depth 0-1) from tree */
function collectAllKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = [];
  for (const n of nodes) { keys.push(n.key); keys.push(...collectAllKeys(n.children)); }
  return keys;
}

// ── Popover ──
function Popover({ ev, tl, anchor, onClose, onNavE, onNavO, entryNames, chapterTitles, storyNames }: {
  ev: WorldEvent; tl: Timeline | null; anchor: HTMLElement;
  onClose: () => void; onNavE?: (id: string) => void; onNavO?: (sid: string, o: number) => void;
  entryNames: Map<string, string>;
  chapterTitles: Map<string, string>;
  storyNames: Map<string, string>;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  const availH = window.innerHeight - r.bottom - 56;
  const p = { l: r.left + r.width / 2, t: r.bottom + 8, maxH: Math.min(400, Math.max(120, availH)) };
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const les = a(ev.linked_entries); const lcs = a(ev.linked_chapters);
  const rcs = a(ev.relationship_changes); const bts = a(ev.belongs_to_stories);

  return createPortal(
    <div ref={ref} className="fixed z-[9999] bg-surface-900 border border-surface-600 rounded-xl shadow-2xl"
      style={{ left: p.l, top: p.t, transform: "translateX(-50%)", minWidth: 300, maxWidth: 380 }}>
      <div className="absolute left-1/2 -top-[7px] w-3.5 h-3.5 bg-surface-900 border-l border-t border-surface-600 transform rotate-45 -translate-x-1/2" />
      <div className="p-4 space-y-2.5 overflow-y-auto" style={{ maxHeight: p.maxH }}>
        <p className="text-[0.8125rem] text-ink-secondary leading-relaxed">{ev.summary || ""}</p>
        <div className="flex items-center gap-2">
          <div className="text-[0.688rem] text-ink-muted font-mono">{fmtTime(ev.time_point, tl, ev.precision)}</div>
          <span className="px-1.5 py-0.5 rounded bg-surface-800/50 text-ink-muted/50 font-mono text-[0.625rem] select-all">{ev.id}</span>
        </div>
        {les.length > 0 && (<div><p className="text-[0.625rem] tracking-wider text-ink-muted/40 mb-1">{t.entry.linkedEntries(les.length)}</p>
          <div className="flex flex-col gap-0.5">{les.map((le: any) => (
            <button key={le.entry_id} onClick={() => { onClose(); onNavE?.(le.entry_id); }} className="text-[0.688rem] text-left text-amber-500 hover:text-amber-400 py-0.5 break-all">{entryNames.get(le.entry_id) || le.entry_id.slice(0, 8)}{le.perspective_summary ? ` — ${le.perspective_summary}` : ""}</button>
          ))}</div></div>)}
        {lcs.length > 0 && (<div><p className="text-[0.625rem] tracking-wider text-ink-muted/40 mb-1">{t.entry.linkedChapters(lcs.length)}</p>
          <div className="flex flex-col gap-0.5">{lcs.map((ch: any) => {
            const chTitle = chapterTitles.get(`${ch.story_id}:${ch.chapter_order}`);
            return (
            <button key={`${ch.story_id}-${ch.chapter_order}`} onClick={() => { onClose(); onNavO?.(ch.story_id, ch.chapter_order); }} className="text-[0.688rem] text-left text-amber-500 hover:text-amber-400 py-0.5">
              {t.entry.chapterLabel(ch.chapter_order, chTitle || "")}
            </button>
            );
          })}</div></div>)}
        {rcs.length > 0 && (<div><p className="text-[0.625rem] tracking-wider text-ink-muted/40 mb-1">{t.entry.relationChanges}</p>
          <div className="flex flex-col gap-0.5">{rcs.map((rc: any, i: number) => (
            <span key={i} className={`text-[0.625rem] ${rc.change_type === "add" ? "text-emerald-500" : rc.change_type === "delete" ? "text-red-500 line-through" : "text-amber-500"}`}>
              {rc.change_type === "add" ? "+" : rc.change_type === "delete" ? "−" : "~"} {entryNames.get(rc.entry_a) || rc.entry_a.slice(0, 8)}↔{entryNames.get(rc.entry_b) || rc.entry_b.slice(0, 8)}: {rc.relation}</span>
          ))}</div></div>)}
        {bts.length > 0 && <p className="text-[0.625rem] text-ink-muted/40">{t.entry.storyLabel}: {bts.map((sid: string) => storyNames.get(sid) || sid.slice(0, 8)).join(", ")}</p>}
      </div>
    </div>, document.body);
}

// ── TreeNodeRow ──
function TreeNodeRow({ node, tl, openNodes, toggleNode, openEventId, setOpenEventId, anchorRefs, onNavE, onNavO }: {
  node: TreeNode; tl: Timeline | null; openNodes: Set<string>; toggleNode: (k: string) => void;
  openEventId: string | null; setOpenEventId: (id: string | null) => void;
  anchorRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  onNavE?: (id: string) => void; onNavO?: (sid: string, o: number) => void;
}) {
  const { t } = useT();
  const hasCh = node.children.length > 0;
  const hasEv = node.events.length > 0;
  const open = openNodes.has(node.key);
  const indent = node.depth * 20;

  return (<>
    <div className="flex items-stretch min-h-[36px] group hover:bg-surface-800/20">
      <div className="w-px bg-surface-700/50 flex-shrink-0" style={{ marginLeft: 24 + indent }} />
      <div className="flex items-center gap-2 py-1 pr-4 flex-shrink-0">
        <div className={`rounded-full flex-shrink-0 -ml-[4px] ${node.depth <= 1 ? "w-[5px] h-[5px] bg-surface-500/40" : "w-[6px] h-[6px] bg-amber-500/60"}`} />
        <button onClick={() => hasCh && toggleNode(node.key)}
          className={`text-xs whitespace-nowrap ${hasCh ? "cursor-pointer hover:text-ink" : "cursor-default"} ${node.depth <= 1 ? "font-medium text-ink-muted" : "text-ink-muted/70"}`}>
          {hasCh && <span className="text-[0.625rem] mr-1 text-ink-muted/40">{open ? "▾" : "▸"}</span>}
          {node.label}
          {hasCh && <span className="text-[0.625rem] text-ink-muted/30 ml-1">{t.entry.eventCount(countAll(node))}</span>}
        </button>
      </div>
      {hasEv && (
        <div className="flex-1 flex items-center gap-2 py-1 pr-4">
          {node.events.map(ev => (
            <button key={ev.id} ref={el => { if (el) anchorRefs.current.set(ev.id, el); }}
              className={`flex-shrink-0 px-2.5 py-1 rounded border text-[0.688rem] text-left max-w-[200px] transition-colors ${openEventId === ev.id ? "border-amber-500/80 bg-amber-500/10" : "border-surface-600/30 bg-surface-800/30 hover:border-surface-500"}`}
              onClick={e => { e.stopPropagation(); setOpenEventId(openEventId === ev.id ? null : ev.id); }}
              title={ev.summary || ""}>
              <span className="line-clamp-2 text-ink-secondary leading-snug">{ev.summary || ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    {hasCh && open && node.children.map(ch => (
      <TreeNodeRow key={ch.key} node={ch} tl={tl} openNodes={openNodes} toggleNode={toggleNode}
        openEventId={openEventId} setOpenEventId={setOpenEventId} anchorRefs={anchorRefs} onNavE={onNavE} onNavO={onNavO} />
    ))}
  </>);
}

// ── Props ──
type Props = {
  worldPath: string; onClose: () => void; sidebarOpen: boolean; rightOpen: boolean;
  initialEventId?: string; initialTimelineId?: string;
  onNavigateEntry?: (id: string) => void; onNavigateOutline?: (sid: string, o: number) => void;
};

export function TimelinePanel({ worldPath, onClose, sidebarOpen, rightOpen, initialEventId, initialTimelineId, onNavigateEntry, onNavigateOutline }: Props) {
  const { t } = useT();
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [activeId, setActiveId] = useState("");
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [fEntry, setFEntry] = useState(""); const [fStory, setFStory] = useState(""); const [fChap, setFChap] = useState("");
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const anchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [entryNames, setEntryNames] = useState<Map<string, string>>(new Map());
  const [chapterTitles, setChapterTitles] = useState<Map<string, string>>(new Map()); // "story_id:chapter_order" -> title
  const [storyNames, setStoryNames] = useState<Map<string, string>>(new Map());

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

  // 加载故事名称映射
  useEffect(() => {
    if (!worldPath) return;
    invoke<Array<{id: string; title: string}>>("load_stories", { worldPath })
      .then((stories) => {
        const map = new Map<string, string>();
        if (Array.isArray(stories)) {
          for (const s of stories) map.set(s.id, s.title);
        }
        setStoryNames(map);
      })
      .catch(() => {});
  }, [worldPath]);

  // 加载章节标题映射 (for linked_chapters in popover)
  useEffect(() => {
    if (!worldPath || events.length === 0) return;
    const storyIds = new Set<string>();
    for (const ev of events) {
      for (const ch of a(ev.linked_chapters)) {
        if (ch.story_id) storyIds.add(ch.story_id);
      }
    }
    if (storyIds.size === 0) return;
    (async () => {
      const map = new Map<string, string>();
      for (const sid of storyIds) {
        try {
          const chs = await invoke<Array<{ order: number; title: string }>>("read_outline", { worldPath, storyId: sid });
          for (const ch of chs) {
            map.set(`${sid}:${ch.order}`, ch.title);
          }
        } catch {}
      }
      setChapterTitles(map);
    })();
  }, [worldPath, events]);

  useEffect(() => {
    if (!worldPath) return;
    setLoading(true); setErr("");
    invoke<Timeline[]>("list_timelines", { worldPath })
      .then(tls => { setTimelines(tls); if (tls.length > 0) { const target = initialTimelineId && tls.find(t => t.id === initialTimelineId); setActiveId((target || tls.find(t => t.is_default) || tls[0]).id); } setLoading(false); })
      .catch(e => { setErr(String(e)); setLoading(false); });
  }, [worldPath]);

  useEffect(() => {
    if (!worldPath || !activeId) return;
    const p: Record<string, unknown> = { worldPath, timelineId: activeId };
    if (fStory) p.storyId = fStory; if (fEntry) p.entryId = fEntry; if (fChap) p.chapterRef = fChap;
    invoke<WorldEvent[]>("list_events", p).then(setEvents).catch(() => setEvents([]));
  }, [worldPath, activeId, fEntry, fStory, fChap]);

  const tl = timelines.find(t => t.id === activeId) || null;
  const tree = useMemo(() => buildTree(events, tl), [events, tl]);

  // Always keep all nodes expanded by default
  useEffect(() => { setOpenNodes(new Set(collectAllKeys(tree))); }, [tree]);
  // Highlight and scroll to initial event
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialEventId && events.length > 0) {
      setOpenEventId(initialEventId);
      setTimeout(() => {
        const el = anchorRefs.current.get(initialEventId);
        if (el && scrollRef.current) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, 300);
    }
  }, [initialEventId, events.length]);

  const toggle = useCallback((k: string) => {
    setOpenNodes(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }, []);

  const pl = sidebarOpen ? 12 : 48; const pr = rightOpen ? 8 : 48;

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-ink-muted">{t.entry.loading}</div>;
  if (err) return <div className="flex-1 flex items-center justify-center text-sm text-red-500">{err}</div>;
  if (timelines.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-sm text-ink-muted p-8">
      <p className="text-base font-medium text-ink-secondary">{t.entry.timelineSetupTitle}</p>
      <p className="text-xs text-ink-muted/60 max-w-xs text-center leading-relaxed">
        {t.entry.timelineSetupDesc}
      </p>
      <button className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs hover:bg-amber-700"
        onClick={async () => { try { const tl = await invoke<Timeline>("create_timeline", { worldPath, name: t.entry.defaultTimelineName }); setTimelines([tl]); setActiveId(tl.id); } catch (e) { setErr(String(e)); } }}>{t.entry.timelineSetupDefault}</button>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-3 border-b border-surface-700 flex-shrink-0" style={{ height: 40, paddingLeft: pl, paddingRight: pr }}>
        <button onClick={onClose} className="text-[0.688rem] text-ink-muted hover:text-ink flex-shrink-0">{t.entry.backToChat}</button>
        <span className="text-[0.625rem] text-ink-muted/50">{t.sidebar.timeline}</span><span className="text-[0.688rem] text-ink-secondary truncate">{tl?.name || ""}</span>
        {timelines.length > 1 && (<select className="text-[0.688rem] bg-surface-800 border border-surface-700 rounded px-2 py-0.5" value={activeId} onChange={e => setActiveId(e.target.value)}>{timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>)}
        <div className="flex-1" />
        <input className="text-[0.688rem] bg-surface-800 border border-surface-700 rounded px-2 py-0.5 w-20 text-ink placeholder:text-ink-muted/30" placeholder={t.labels.entry} value={fEntry} onChange={e => setFEntry(e.target.value)} />
        <input className="text-[0.688rem] bg-surface-800 border border-surface-700 rounded px-2 py-0.5 w-20 text-ink placeholder:text-ink-muted/30" placeholder={t.entry.storyLabel} value={fStory} onChange={e => setFStory(e.target.value)} />
        <input className="text-[0.688rem] bg-surface-800 border border-surface-700 rounded px-2 py-0.5 w-24 text-ink placeholder:text-ink-muted/30" placeholder={t.entry.chapterFilterPlaceholder} value={fChap} onChange={e => setFChap(e.target.value)} />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto" style={{ paddingRight: pr }}>
        {tree.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-ink-muted">{t.entry.timelineEmpty}</div>
        ) : (<div className="py-4">{tree.map(n => (
          <TreeNodeRow key={n.key} node={n} tl={tl} openNodes={openNodes} toggleNode={toggle}
            openEventId={openEventId} setOpenEventId={setOpenEventId} anchorRefs={anchorRefs}
            onNavE={onNavigateEntry} onNavO={onNavigateOutline} />
        ))}
          <div style={{ height: "25vh" }} />
        </div>)}
      </div>
      {openEventId && (() => { const ev = events.find(e => e.id === openEventId); const el = anchorRefs.current.get(openEventId); return (ev && el) ? <Popover ev={ev} tl={tl} anchor={el} onClose={() => setOpenEventId(null)} onNavE={onNavigateEntry} onNavO={onNavigateOutline} entryNames={entryNames} chapterTitles={chapterTitles} storyNames={storyNames} /> : null; })()}
    </div>
  );
}

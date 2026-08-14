/**
 * 桥接到正式世界 (§十) — 推演产物"转正"。
 *
 * 对应 SIMULATION_DESIGN.md §十：
 * 默认关，用户手动触发，批量选择事件：
 * 1. 用户选中某 tick 区间的事件。
 * 2. 点击"提交到正式时间线"。
 * 3. 调度器把 SimulationEvent 转为现有 Event 写入 timelines/，
 *    自动触发 event_cascade（关系图、词条 timeline_summary、大纲联动）。
 * 4. 可把关键实体卡片转成词条（organization/location 类型）。
 *
 * 本文件生成"可提交的数据"（转换为正式世界的数据结构），
 * 实际写盘由调用方通过现有 Tauri IPC 命令执行（保持可测性）。
 */

import type { EntityCard, SimulationEvent, SimulationSession } from "./types.ts";

// ── 转换为正式 Event（timelines/*/events.json 的格式）──

export type BridgeEvent = {
  id: string;
  name: string;                 // 可读 slug（取自 type + 摘要前缀）
  timeline_id: string;          // 目标时间轴（调用方指定）
  time_point: string;           // 8 段零填充（由 tick 映射, 调用方可覆盖）
  precision: number | null;
  summary: string;              // 2-3 句叙事
  linked_entries: { entry_id: string; perspective_summary?: string }[];
  linked_chapters: { story_id: string; chapter_order: number }[];
  relationship_changes: { entry_a: string; entry_b: string; change_type: "add" | "delete"; relation: string; description?: string }[];
  belongs_to_stories: string[];
};

/**
 * 把推演事件转为可提交到正式时间线的事件。
 * - type 映射为可读 slug
 * - time_point 由 tick 映射（默认 "000-{tick padded}-00-00-00-00-00-00"，调用方可覆盖）
 * - participants → linked_entries（实体 id）
 * - 实体指标变化 → relationship_changes（若有意义）
 */
export function simulationEventToBridge(
  event: SimulationEvent,
  session: SimulationSession,
  opts: { timelineId?: string; tickToTimePoint?: (tick: number) => string } = {},
): BridgeEvent {
  const timelineId = opts.timelineId ?? "default-timeline";
  const timePoint = opts.tickToTimePoint
    ? opts.tickToTimePoint(event.tick)
    : defaultTickToTimePoint(event.tick);

  // participants → linked_entries（实体 id + 一句话视角）
  const linkedEntries = event.participants.map((p) => {
    const entity = session.entities[p];
    return {
      entry_id: p,
      perspective_summary: entity
        ? `${entity.name}: ${event.description}`
        : undefined,
    };
  }).filter((le) => le.entry_id);

  // 实体指标变化 → relationship_changes（推演改变了某实体的状态）
  const relationshipChanges: BridgeEvent["relationship_changes"] = [];
  for (const ch of event.changes) {
    if (ch.metrics && (ch.metrics.stability !== undefined || ch.metrics.legitimacy !== undefined)) {
      relationshipChanges.push({
        entry_a: ch.entity,
        entry_b: ch.entity, // 状态变化（self-relation, §3.1）
        change_type: "add",
        relation: "状态",
        description: event.description,
      });
    }
  }

  return {
    id: event.id,
    name: bridgeSlug(event),
    timeline_id: timelineId,
    time_point: timePoint,
    precision: 1,
    summary: event.description,
    linked_entries: linkedEntries,
    linked_chapters: [],
    relationship_changes: relationshipChanges,
    belongs_to_stories: [],
  };
}

/** tick → 默认 8 段 time_point（用 tick 作为年） */
export function defaultTickToTimePoint(tick: number): string {
  return `000-${String(tick).padStart(6, "0")}-00-00-00-00-00-00`;
}

/** 生成可读 slug */
function bridgeSlug(event: SimulationEvent): string {
  const prefix = event.type;
  const head = event.description.replace(/[^\p{L}\p{N}]/gu, "-").slice(0, 24).replace(/^-+|-+$/g, "");
  return `${prefix}-${head || "事件"}`;
}

// ── 实体卡片 → 词条 ──────────────────────────────────

export type BridgeEntry = {
  name: string;
  entry_type: "organization" | "location" | "concept" | "character";
  body: string;
  properties?: Record<string, unknown>;
};

/**
 * 把实体卡片转为正式词条（§十 第 4 步）。
 * - 有政权形态 → organization
 * - 无政权/散居 → location 或 character
 * - 抽象概念 → concept
 */
export function entityCardToEntry(
  entity: EntityCard,
): BridgeEntry {
  // 政体已自由化（非枚举）。判断是否有"组织化政权":
  // 有政权名(非散居/无政权) → organization; 低复杂度无政权 → concept; 散居/聚落 → location
  const complexity = entity.regime?.organizational_complexity ?? 0;
  const form = entity.identity.political_form?.trim() ?? "";
  const statelessish = ["散居", "无政权", "游荡", "狩猎采集", "stateless", "nomadic"].some((k) => form.includes(k));
  const hasPolity = form.length > 0 && !statelessish;
  const entryType: BridgeEntry["entry_type"] =
    hasPolity || complexity >= 25
      ? "organization"
      : !form
        ? "concept"
        : "location";

  const bodyLines = [
    `# ${entity.name}`,
    ``,
    `种族：${entity.identity.species}`,
    `政权形态：${entity.identity.political_form}`,
    `文化：${entity.identity.culture}`,
    `意识形态：${entity.identity.ideology}`,
    entity.identity.religion ? `信仰：${entity.identity.religion}` : "",
    ``,
    `## 起源`,
    entity.identity.origin_story,
    ``,
    `## 现状（tick ${entity.last_tick}）`,
    `人口 ${entity.metrics.population} · 军力 ${entity.metrics.military} · 稳定 ${entity.metrics.stability} · 合法 ${entity.metrics.legitimacy}`,
    `技术维度：${JSON.stringify(entity.tech)}`,
    `理念：${JSON.stringify(entity.values)}`,
  ].filter(Boolean).join("\n");

  return {
    name: entity.name,
    entry_type: entryType,
    body: bodyLines,
    properties: {
      simulation_origin: true,
      species: entity.identity.species,
      political_form: entity.identity.political_form,
    },
  };
}

// ── 批量提交辅助 ──────────────────────────────────────

export type BridgePayload = {
  events: BridgeEvent[];
  entries: BridgeEntry[];
  // 供调用方执行 IPC 的命令清单（描述, 非实际调用）
  timelineId: string;
  selectedTicks: [number, number];
  note: string;
};

/**
 * 生成一批可提交的数据。
 * 调用方拿到 payload 后执行实际 IPC（create_event / create_entry）。
 */
export function buildBridgePayload(
  session: SimulationSession,
  selectedEvents: SimulationEvent[],
  opts: { timelineId?: string; includeEntities?: boolean } = {},
): BridgePayload {
  const timelineId = opts.timelineId ?? "default-timeline";
  const events = selectedEvents.map((e) => simulationEventToBridge(e, session, { timelineId }));
  const entries = opts.includeEntities
    ? Object.values(session.entities)
        .filter((e) => e.status === "active")
        .map(entityCardToEntry)
    : [];

  const ticks = selectedEvents.map((e) => e.tick);
  const selectedTicks: [number, number] = ticks.length
    ? [Math.min(...ticks), Math.max(...ticks)]
    : [0, 0];

  return {
    events,
    entries,
    timelineId,
    selectedTicks,
    note: `提交 ${events.length} 个事件${entries.length ? ` + ${entries.length} 个词条` : ""} 到正式世界`,
  };
}

/**
 * 提交桥接到正式世界（§十 步骤 3-4）。
 * 执行实际 IPC：创建事件（自动触发 event_cascade）、创建词条。
 * timelineId 若不存在则先创建。
 */
export async function submitBridgePayload(
  worldPath: string,
  payload: BridgePayload,
): Promise<{ createdEvents: number; createdEntries: number }> {
  const { invoke } = await import("../api.ts");

  // 确保时间轴存在（§十 步骤 3 写入 timelines/）——用创建返回的真实 id, 而非硬编码默认
  let timelineId = payload.timelineId;
  try {
    const timelines = await invoke<Array<{ id: string }>>("list_timelines", { worldPath });
    if (!timelines.some((t) => t.id === timelineId)) {
      const created = await invoke<{ id: string }>("create_timeline", {
        worldPath,
        name: "推演导入",
        description: "从历史推演模式提交的事件",
      });
      if (created?.id) timelineId = created.id;
    }
  } catch {
    // 时间轴创建失败不阻塞（已有时间轴时忽略）
  }

  // 创建事件（自动触发 event_cascade → 关系图/timeline_summary/大纲联动, §十 步骤 3）
  let createdEvents = 0;
  for (const ev of payload.events) {
    try {
      await invoke("create_event", {
        worldPath,
        timelineId,
        timePoint: ev.time_point,
        summary: ev.summary,
        name: ev.name,
        precision: ev.precision ?? null,
        linkedEntries: JSON.stringify(ev.linked_entries),
        linkedChapters: JSON.stringify(ev.linked_chapters),
        relationshipChanges: JSON.stringify(ev.relationship_changes),
      });
      createdEvents++;
    } catch {
      // 单个事件失败跳过（可能是时间点冲突等）
    }
  }

  // 创建词条（§十 步骤 4: organization/location 类型）
  let createdEntries = 0;
  for (const en of payload.entries) {
    try {
      await invoke("create_entry", {
        worldPath,
        name: en.name,
        entryType: en.entry_type,
        body: en.body,
      });
      createdEntries++;
    } catch {
      // 单个词条失败跳过（可能重名）
    }
  }

  return { createdEvents, createdEntries };
}

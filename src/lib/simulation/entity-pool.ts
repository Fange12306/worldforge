/**
 * 动态 agent 池 (§5.4) — 实体随推演涌现式增删。
 *
 * 对应 SIMULATION_DESIGN.md §5.4：
 * - 分裂 → 派生 2 个子实体 agent（父卡片复制 + 拆分叙事 + 各得部分指标, parent 追溯）。
 * - 吞并 → 被吞者 status="extinct" 移入 archive；吞并者吸收人口/领土/部分指标。
 * - 灭亡 → 冻结进 archive（不删，可被后人"考古"甚至"复兴"）。
 * - 复兴 → 后世 agent 发现 archive 文明遗迹 → 可触发文化/宗教复兴。
 * - 分化 → 同一实体内部文化/宗教分裂 → 可派生子实体，共享部分 identity。
 *
 * 长尾聚合：稳定小实体数量大时不逐个开 agent，而是一个区域层 agent 批量处理一簇。
 */

import type { EntityCard, SimulationEvent } from "./types.ts";

// ── 档案 ──────────────────────────────────────────────

export type ArchiveEntry = {
  entity: EntityCard;
  archived_tick: number;
  reason: string;
};

// ── 分裂（secession / founding）───────────────────────

export type SecessionResult = {
  parent: EntityCard;
  child: EntityCard;
  /** 分割给子实体的指标比例（人口/军力等, 0-1） */
  split: { population: number; military: number; legitimacy: number; stability: number };
};

/**
 * 分裂：一个实体产出分裂事件 → 派生子实体。
 * 父实体保留剩余部分，子实体继承父卡片 + 部分指标 + 拆分叙事。
 * child 的 parent 字段指向父实体 id。
 */
export function splitEntity(
  parent: EntityCard,
  event: SimulationEvent,
  childName: string,
  tick: number,
  split: Partial<SecessionResult["split"]> = {},
): SecessionResult {
  const p = split.population ?? 0.4;
  const m = split.military ?? 0.4;
  const leg = split.legitimacy ?? 0.4;
  const stab = split.stability ?? 0.4;

  // 父实体让渡部分指标
  const parentMetrics = {
    ...parent.metrics,
    population: Math.max(100, Math.round(parent.metrics.population * (1 - p))),
    military: Math.max(1, Math.round(parent.metrics.military * (1 - m))),
    legitimacy: Math.max(1, Math.round(parent.metrics.legitimacy * (1 - leg))),
    stability: Math.max(1, Math.round(parent.metrics.stability * (1 - stab))),
  };

  // 子实体继承父卡片，但身份/指标为"分裂部分"
  const child: EntityCard = {
    ...parent,
    id: `child-${event.id}`,
    name: childName,
    parent: parent.id,
    metrics: {
      population: Math.max(100, Math.round(parent.metrics.population * p)),
      military: Math.max(1, Math.round(parent.metrics.military * m)),
      legitimacy: Math.round(parent.metrics.legitimacy * leg),
      stability: Math.round(parent.metrics.stability * stab),
      food: 0,
      economy: Math.round(parent.metrics.economy * (1 - p)),
    },
    // 子实体与父实体共享文化/种族，但政体/意识形态可稍异
    identity: {
      ...parent.identity,
      culture: `${childName}文化`,
    },
    geography: { ...parent.geography, neighbors: [...parent.geography.neighbors, parent.id] },
    relations: [],
    internal: {
      recent_events: [event.description],
      active_issues: ["分裂自" + parent.name],
    },
    active_level: "hotspot", // 新分裂的实体通常是热点（动荡）
    last_tick: tick,
    created_at: tick,
    updated_at: tick,
  };

  const updatedParent: EntityCard = { ...parent, metrics: parentMetrics, updated_at: tick };
  return { parent: updatedParent, child, split: { population: p, military: m, legitimacy: leg, stability: stab } };
}

// ── 吞并（conquest）───────────────────────────────────

export type ConquestResult = {
  conqueror: EntityCard;
  conquered: EntityCard; // status="extinct"
  archive: ArchiveEntry;
};

/**
 * 吞并：被吞者 status="extinct" 移入 archive，吞并者吸收人口/领土/部分指标。
 */
export function conquerEntity(
  conqueror: EntityCard,
  conquered: EntityCard,
  event: SimulationEvent,
  tick: number,
  absorption = 0.6, // 被吞者人口被吸收比例
): ConquestResult {
  // 吞并者吸收被吞者部分人口/军力
  const absorbedPop = Math.round(conquered.metrics.population * absorption);
  const absorbedMil = Math.round(conquered.metrics.military * absorption);
  const conquerorUpdated: EntityCard = {
    ...conqueror,
    metrics: {
      ...conqueror.metrics,
      population: conqueror.metrics.population + absorbedPop,
      military: conqueror.metrics.military + absorbedMil,
      stability: Math.max(1, conqueror.metrics.stability - 5), // 吞并异族可能引发稳定下降
    },
    geography: {
      ...conqueror.geography,
      neighbors: [
        ...new Set([
          ...conqueror.geography.neighbors.filter((n) => n !== conquered.id),
          ...conquered.geography.neighbors.filter((n) => n !== conqueror.id),
        ]),
      ],
    },
    // 吞并转移领土: 被吞者控制的区划并入吞并者(去重)
    territory: [...new Set([
      ...(conqueror.territory ?? [conqueror.geography.region]),
      ...(conquered.territory ?? [conquered.geography.region]),
    ])],
    internal: {
      recent_events: [`吞并了 ${conquered.name}, 领土并入`, ...conqueror.internal.recent_events].slice(0, 5),
      active_issues: [...conqueror.internal.active_issues],
    },
    updated_at: tick,
  };

  const conqueredArchived: EntityCard = { ...conquered, status: "extinct", updated_at: tick };
  const archive: ArchiveEntry = {
    entity: conqueredArchived,
    archived_tick: tick,
    reason: `被 ${conqueror.name} 吞并: ${event.description}`,
  };

  return { conqueror: conquerorUpdated, conquered: conqueredArchived, archive };
}

// ── 灭亡（collapse）───────────────────────────────────

/**
 * 灭亡：实体 collapse → 冻结进 archive（不删）。
 */
export function collapseEntity(
  entity: EntityCard,
  event: SimulationEvent,
  tick: number,
): ArchiveEntry {
  const archived: EntityCard = { ...entity, status: "extinct", updated_at: tick };
  return { entity: archived, archived_tick: tick, reason: event.description };
}

// ── 复兴 ──────────────────────────────────────────────

/**
 * 复兴：后世 agent 发现 archive 文明遗迹 → 可触发文化/宗教复兴。
 * 从 archive 恢复一个实体为 active，并部分重置指标。
 */
export function reviveEntity(
  archive: ArchiveEntry,
  newName: string,
  tick: number,
): EntityCard {
  const revived: EntityCard = {
    ...archive.entity,
    id: `${archive.entity.id}-revived-${tick}`,
    name: newName,
    parent: archive.entity.id,
    status: "active",
    metrics: {
      ...archive.entity.metrics,
      population: Math.max(100, Math.round(archive.entity.metrics.population * 0.3)),
      military: Math.max(1, Math.round(archive.entity.metrics.military * 0.3)),
      stability: 30, // 复兴初期的脆弱
    },
    internal: {
      recent_events: [`从 ${archive.entity.name} 的遗迹中复兴`, ...archive.entity.internal.recent_events].slice(0, 5),
      active_issues: ["重建家园", "延续上古文明"],
    },
    active_level: "hotspot",
    last_tick: tick,
    created_at: tick,
    updated_at: tick,
  };
  return revived;
}

// ── 分化（文化/宗教分裂）──────────────────────────────

/**
 * 分化：同一实体内部出现文化/宗教分裂 → 派生子实体，共享部分 identity。
 * 与分裂的区别：分化通常源于内部文化冲突，而非领土分裂。
 */
export function divergeEntity(
  parent: EntityCard,
  childName: string,
  divergence: { culture?: string; religion?: string; ideology?: string },
  tick: number,
): SecessionResult {
  // 分化让渡的指标较少（文化分裂不一定分割领土）
  const result = splitEntity(parent, {
    id: `diverge-${tick}`,
    tick,
    time_label: "",
    type: "cultural",
    participants: [parent.id],
    region: parent.geography.region,
    description: `${parent.name} 内部发生文化/信仰分化`,
    changes: [],
    random: false,
    source: "engine",
  } as SimulationEvent, childName, tick, { population: 0.2, military: 0.15, legitimacy: 0.1, stability: 0.1 });

  // 子实体应用分化特征
  result.child = {
    ...result.child,
    identity: {
      ...result.child.identity,
      culture: divergence.culture ?? result.child.identity.culture,
      religion: divergence.religion ?? result.child.identity.religion,
      ideology: divergence.ideology ?? result.child.identity.ideology,
    },
    internal: {
      recent_events: [`因信仰/文化分歧从 ${parent.name} 分化`],
      active_issues: ["独立信仰社群"],
    },
  };
  return result;
}

// ── 长尾聚合 ──────────────────────────────────────────

export type MicroCluster = {
  id: string;
  region: string;
  members: EntityCard[];      // 稳定的微邦/部落
  representative: EntityCard; // 区域层 agent 代表
};

/**
 * 长尾聚合：稳定微邦不逐个开 agent，聚合为区域层簇。
 * 满足条件的微邦（status=active, 无活跃冲突, 数量多）聚合。
 */
export function clusterMicroEntities(
  entities: EntityCard[],
  minPerCluster = 3,
  clusterActiveLevel = "longtail" as const,
): MicroCluster[] {
  const clusters: MicroCluster[] = [];
  const byRegion = new Map<string, EntityCard[]>();
  for (const e of entities) {
    if (e.status !== "active" || e.active_level === "longtail") continue;
    const region = e.geography.region;
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(e);
  }
  for (const [region, members] of byRegion) {
    if (members.length >= minPerCluster) {
      const representative = { ...members[0], active_level: clusterActiveLevel };
      clusters.push({ id: `micro-${region}`, region, members, representative });
    }
  }
  return clusters;
}

/**
 * 反事实分叉 (Phase 2 / §九) — 一键存档当前状态 → 改参数 → 另起分支 → 对比两条历史。
 *
 * 对应 SIMULATION_DESIGN.md §九：
 * - 反事实（Phase 2）：一键存档当前状态 → 改参数 → 另起分支 → 对比两条历史。
 *
 * 世界多时间轴模型天然支持（§2.1）：每条反事实分叉是一条"平行世界线"。
 */

import type {
  CanonicalLore,
  DimensionRegistry,
  EntityCard,
  SimulationConfig,
  SimulationEvent,
  SimulationSession,
  SimulationArchiveEntry,
  SpaceRegion,
  WorldLaws,
} from "./types.ts";
import { emptyLore } from "./lore.ts";
import { emptyRegistry } from "./registry.ts";
import { buildGeography } from "./geography.ts";

// ── 分叉存档 ──────────────────────────────────────────

export type BranchSnapshot = {
  id: string;
  baseTick: number;             // 从哪个 tick 分叉
  config: SimulationConfig;
  laws: WorldLaws;
  regions: Record<string, SpaceRegion>;
  entities: Record<string, EntityCard>;
  registry: DimensionRegistry;
  lore: CanonicalLore;
  events: SimulationEvent[];
  decrees: SimulationSession["decrees"];
  archive: SimulationArchiveEntry[];
  languages: SimulationSession["languages"];
  cultures: SimulationSession["cultures"];
  label: string;                // 用户可读描述（"未发生大饥荒"等）
  forkedAt: number;             // 分叉时间
};

/**
 * 从会话当前状态创建分叉存档（深拷贝, 后续分支改动不影响原始历史）。
 */
export function forkSession(
  session: SimulationSession,
  label: string,
  forkId: string,
): BranchSnapshot {
  return {
    id: forkId,
    baseTick: session.current_tick,
    config: structuredClone(session.config),
    laws: structuredClone(session.laws),
    regions: structuredClone(session.regions),
    entities: structuredClone(session.entities),
    registry: structuredClone(session.registry),
    lore: structuredClone(session.lore),
    events: structuredClone(session.events),
    decrees: structuredClone(session.decrees),
    archive: structuredClone(session.archive),
    languages: structuredClone(session.languages),
    cultures: structuredClone(session.cultures),
    label,
    forkedAt: session.current_tick,
  };
}

/**
 * 从分叉存档重建一个会话（新分支）。
 * 分叉后的推演基于存档快照, 不影响原始历史（历史即锁定的分支隔离）。
 */
export function restoreFromFork(
  snapshot: BranchSnapshot,
  newConfigOverrides: Partial<SimulationConfig> = {},
): SimulationSession {
  const config = { ...snapshot.config, ...newConfigOverrides };
  const session: SimulationSession = {
    id: `fork-${snapshot.id}`,
    world_id: "fork",
    current_tick: snapshot.baseTick,
    laws: structuredClone(snapshot.laws),
    regions: structuredClone(snapshot.regions),
    geography: buildGeography(snapshot.regions),
    entities: structuredClone(snapshot.entities),
    registry: structuredClone(snapshot.registry),
    lore: structuredClone(snapshot.lore),
    config,
    events: structuredClone(snapshot.events),
    decrees: structuredClone(snapshot.decrees),
    archive: structuredClone(snapshot.archive),
    languages: structuredClone(snapshot.languages ?? {}),
    cultures: structuredClone(snapshot.cultures ?? {}),
    started_at: snapshot.forkedAt,
  };
  return session;
}

// ── 分支对比 ──────────────────────────────────────────

export type BranchDiff = {
  // 事件轨迹差异：同一 tick 两条分支的事件数/描述
  eventsDivergedAt: number | null;  // 从哪个 tick 开始事件不同
  // 实体状态差异（同名实体指标对比）
  entityDiffs: {
    name: string;
    metric: string;            // 差异最大的指标
    original: number;
    forked: number;
    delta: number;
  }[];
  // 概要
  summary: string;
};

/**
 * 对比两条历史（原始 vs 分叉）。
 * 从 baseTick 之后找第一个事件不同的 tick（分叉点）。
 */
export function compareBranches(
  original: SimulationSession,
  fork: SimulationSession,
): BranchDiff {
  const base = fork.current_tick; // 分叉会话停在 baseTick 前的快照? 不, 用 baseTick
  void base;

  // 找分叉点：从 fork 的 baseTick 起，事件序列第一个不同
  let eventsDivergedAt: number | null = null;
  const origEvents = original.events;
  const forkEvents = fork.events;
  const minLen = Math.min(origEvents.length, forkEvents.length);
  for (let i = 0; i < minLen; i++) {
    if (origEvents[i].description !== forkEvents[i].description || origEvents[i].tick !== forkEvents[i].tick) {
      eventsDivergedAt = Math.min(origEvents[i].tick, forkEvents[i].tick);
      break;
    }
  }
  if (eventsDivergedAt === null && origEvents.length !== forkEvents.length) {
    eventsDivergedAt = Math.min(origEvents[minLen]?.tick ?? 0, forkEvents[minLen]?.tick ?? 0);
  }

  // 实体状态对比
  const entityDiffs: BranchDiff["entityDiffs"] = [];
  for (const [id, origEntity] of Object.entries(original.entities)) {
    const forkEntity = fork.entities[id];
    if (!forkEntity) continue;
    const metrics = ["population", "military", "stability", "legitimacy"] as const;
    for (const m of metrics) {
      const o = origEntity.metrics[m];
      const f = forkEntity.metrics[m];
      if (Math.abs(o - f) > 0.001) {
        entityDiffs.push({
          name: origEntity.name,
          metric: m,
          original: o,
          forked: f,
          delta: Math.round((f - o) * 100) / 100,
        });
        break; // 每个实体只取差异最大的一个指标
      }
    }
  }
  entityDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  entityDiffs.splice(5); // 最多展示 5 个

  const summary = eventsDivergedAt !== null
    ? `两条历史从 tick ${eventsDivergedAt} 开始分道扬镳，${entityDiffs.length} 个实体的状态出现差异。`
    : "两条历史尚未分叉（相同参数下演化一致）。";

  return { eventsDivergedAt, entityDiffs, summary };
}

// ── 独立工具（供测试/UI 使用）────────────────────────

export function emptySnapshot(id: string): BranchSnapshot {
  return {
    id,
    baseTick: 0,
    config: { randomness: 0.3, surprise: 0.3, rigor: 0.7, granularity: "macro", yearsPerTick: 10, autoJump: true, maxTicks: 100, budget: { perTickGlobal: 100000, perEntity: 4000, hotspotMultiplier: 4 }, infoDelay: 2, maxEntities: null, seed: 0 },
    laws: { id: "", name: "", physics: { food_per_capita: 1, pop_growth_base: 0.02, military_per_pop: 0.002, military_tech_mult: 0.5, stability_recovery: 0.02, stability_decay: 0.05, overpopulation_pressure: 0.05 }, rules: [], narrative: [], ontology: [], spatial_scale: "" },
    regions: {},
    entities: {},
    registry: emptyRegistry(),
    lore: emptyLore(),
    events: [],
    decrees: [],
    archive: [],
    languages: {},
    cultures: {},
    label: "",
    forkedAt: 0,
  };
}

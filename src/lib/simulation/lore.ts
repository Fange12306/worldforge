/**
 * 背景规则库 (§3.6) — 世界在空间与时间两个向度上"单向累积、永不回溯"的不可更改事实层。
 *
 * 对应 SIMULATION_DESIGN.md §4.0 核心规则 2/3：
 * - 细化即锁定（空间向）：推演中涉及某子区域，向下细化它。一旦确定即锁定，不可回溯修改。
 * - 历史即锁定（时间向）：宏观轨迹锁定不可改写；但允许在已发生时代向下细化过去
 *   （创造人物/事件/细节），且必须与已发生的未来兼容。
 * - 细化过去即锁定：一旦判定通过即写入，不可再改。
 *
 * 本文件实现确定性逻辑：细化写入、层级锁定、禁止回溯修改、与已发生未来兼容检查。
 * 纯函数，可单测。
 */

import type { CanonicalLore, EntityCard, LoreAxis, LoreFact, LoreSource, SimulationEvent, SimulationSession } from "./types.ts";

// ── 创建 ──────────────────────────────────────────────

export function emptyLore(): CanonicalLore {
  return { facts: [], max_layer: 0 };
}

export type NewLoreFact = {
  axis: LoreAxis;
  layer: number;
  scope: string;
  content: string;
  source: LoreSource;
  locked_tick: number;
  refined_from?: string;
  notes?: string;
  /** 关联的实体 id（用户指定的实体级事实, 供按实体回读） */
  entityScope?: string;
};

export function addLoreFact(lore: CanonicalLore, fact: NewLoreFact): LoreFact {
  const full: LoreFact = {
    id: `lore-${lore.facts.length + 1}-${fact.locked_tick}`,
    ...fact,
  };
  lore.facts.push(full);
  if (fact.layer > lore.max_layer) lore.max_layer = fact.layer;
  return full;
}

// ── 查询 ──────────────────────────────────────────────

/** 按 scope 前缀查找已锁定事实（用于判断"是否已确定"） */
export function findLoreByScope(lore: CanonicalLore, scope: string): LoreFact[] {
  return lore.facts.filter((f) => f.scope === scope || scope.startsWith(f.scope + "/") || f.scope.startsWith(scope + "/"));
}

/** 该 scope 是否已有初始全景事实（顶层，layer 0） */
export function hasInitialFact(lore: CanonicalLore, scope: string): boolean {
  return lore.facts.some((f) => f.source === "initial" && f.scope === scope);
}

export type LoreFactsForOpts = {
  /** 最多返回条数（防上下文膨胀, 默认 8） */
  max?: number;
  /** 时间向只取近 N tick 的历史锁定事实（默认 20） */
  recentTicks?: number;
};

/**
 * 取与某实体相关的已锁定世界事实, 供 agent/稀有事件注入。
 * 空间向优先: 实体核心区域 + 领土的已确定事实（细化即锁定）;
 * 时间向次之: 近 recentTicks tick 的历史锁定（历史即锁定）。
 * 让"已确定世界"约束新事件生成——lore 不再只写不读。
 */
export function loreFactsFor(
  session: SimulationSession,
  entity: EntityCard,
  opts: LoreFactsForOpts = {},
): LoreFact[] {
  const { max = 8, recentTicks = 20 } = opts;
  const facts = session.lore?.facts ?? [];
  const scopes = new Set(
    [entity.geography?.region, ...(entity.territory ?? [])].filter(Boolean) as string[],
  );
  // 空间向: 实体区域/领土的已锁定事实（含子/父 scope 前缀）
  // + 实体级事实（entityScope === 本实体 id —— 用户初始化指定的身份/关系/约束, 保证被回读）
  const space = facts.filter(
    (f) => f.axis === "space"
      && ((f.entityScope && f.entityScope === entity.id)
        || [...scopes].some((s) => f.scope === s || f.scope.startsWith(s + "/") || s.startsWith(f.scope + "/"))),
  );
  // 时间向: 已发生的近 recentTicks 历史锁定事实（不引未来）
  const time = facts
    .filter((f) => f.axis === "time" && f.locked_tick <= session.current_tick
      && f.locked_tick >= session.current_tick - recentTicks)
    .sort((a, b) => b.locked_tick - a.locked_tick);
  const out: LoreFact[] = [];
  for (const f of [...space, ...time]) {
    if (out.length >= max) break;
    out.push(f);
  }
  return out;
}

/** 该 scope 已锁定的最大细化层级 */
export function maxLockedLayer(lore: CanonicalLore, scope: string): number {
  const hits = lore.facts.filter((f) => f.scope === scope);
  return hits.length ? Math.max(...hits.map((f) => f.layer)) : -1;
}

// ── 细化即锁定（空间向）──────────────────────────────

export type RefinementVerdict = "accepted" | "conflict" | "already-refined" | "layer-mismatch";

export type RefineResult = {
  verdict: RefinementVerdict;
  fact?: LoreFact;
  reason: string;
};

/**
 * 尝试在空间向细化一个 scope（子区域）。
 *
 * 规则（§4.0 核心规则 2）：
 * - 细化必须基于已有父层级（scope 的父级已存在，或本身是初始全景的一部分）。
 * - 一旦某 scope 已细化到某 layer，同一 scope 不能再被"同层改写"——只能在更深层细化。
 * - 不能修改已锁定事实，只能新增更细层级。
 */
export function refineSpace(
  lore: CanonicalLore,
  parentScope: string | undefined, // 父 scope（undefined = 初始全景顶层）
  childScope: string,
  content: string,
  locked_tick: number,
  notes?: string,
): RefineResult {
  // 1. 父级必须已存在（初始全景或已细化过）
  if (parentScope !== undefined) {
    const parent = lore.facts.find((f) => f.scope === parentScope);
    if (!parent) {
      return { verdict: "conflict", reason: `父层级 '${parentScope}' 尚未确定，不能在其下细化` };
    }
  }
  // 2. 不能重复细化同一个子 scope（已存在 → 拒绝，防止覆盖）
  if (lore.facts.some((f) => f.scope === childScope)) {
    return { verdict: "already-refined", reason: `'${childScope}' 已细化确定，不能再次细化` };
  }
  // 3. 层数 = 父层级 + 1（或初始 0）
  const parentLayer = parentScope === undefined ? -1 : lore.facts.find((f) => f.scope === parentScope)!.layer;
  const layer = parentLayer + 1;
  const fact = addLoreFact(lore, {
    axis: "space",
    layer,
    scope: childScope,
    content,
    source: "refinement",
    locked_tick,
    refined_from: parentScope,
    notes,
  });
  return { verdict: "accepted", fact, reason: `细化 '${childScope}' (layer ${layer}) 已锁定` };
}

// ── 历史即锁定（时间向）──────────────────────────────

/**
 * 追加一个已确定的历史事件到背景规则库。
 * 历史事实 layer 恒为 0（宏观），axis=time，source=history。
 */
export function lockHistoricalEvent(
  lore: CanonicalLore,
  event: SimulationEvent,
  content?: string,
): LoreFact {
  const fact = addLoreFact(lore, {
    axis: "time",
    layer: 0,
    scope: `tick:${event.tick}`,
    content: content ?? `[${event.type}] ${event.description}`,
    source: "history",
    locked_tick: event.tick,
  });
  return fact;
}

/**
 * 细化过去（§4.0 核心规则 3 / §5.5）：
 * 在已发生的时代向下细化——创造人物/事件/细节。
 *
 * 约束：
 * - target_tick 必须 ≤ 当前（只能细化已发生的过去，不能预支未来）。
 * - 不能与已发生的未来矛盾：新增的过去事实不得与 target_tick 之后已锁定的事件冲突
 *   （语义检查由 LLM 判定做；此处做确定性范围检查：target_tick 必须 < 最早未来事件 tick，
 *    且新增事实的 scope 不与已锁定事实的"影响范围"重叠）。
 * - 细化一旦确定即锁定，不可再改。
 */
export function refinePast(
  lore: CanonicalLore,
  target_tick: number,
  current_tick: number,
  scope: string,          // 时间范围，如 "第三纪元"
  content: string,
  notes?: string,
): RefineResult {
  // 1. 只能细化已发生的过去
  if (target_tick > current_tick) {
    return { verdict: "conflict", reason: `tick ${target_tick} 尚未发生，不能细化未来` };
  }
  // 2. 不能重复细化同一个 scope（已存在 → 拒绝）
  if (lore.facts.some((f) => f.scope === scope)) {
    return { verdict: "already-refined", reason: `'${scope}' 已细化确定，不能再次细化` };
  }
  // 3. 与已发生未来兼容（确定性检查）：细化的过去不能声称"发生了"之后时间点的事件
  const futureEvents = lore.facts.filter(
    (f) => f.axis === "time" && f.source === "history" && f.locked_tick > target_tick,
  );
  // 若用户细化的 scope 与某个未来事件的时间段重叠，且未来事件声称了不同因果 → 标记风险
  // （Phase 0 只做保守的范围检查：细化的时间点必须早于所有已锁定未来事件的最早 tick，
  //   否则视为"与未来冲突"——严格的语义兼容由 Phase 1 的 LLM 判定负责。）
  if (futureEvents.length > 0) {
    const earliestFuture = Math.min(...futureEvents.map((f) => f.locked_tick));
    if (target_tick >= earliestFuture) {
      return {
        verdict: "conflict",
        reason: `tick ${target_tick} 不早于最早已发生未来事件 (tick ${earliestFuture})，细化过去可能与已发生历史矛盾`,
      };
    }
  }
  // 4. 通过：写入背景规则库（layer = 该时间点的细化深度；宏观=1 起算）
  const fact = addLoreFact(lore, {
    axis: "time",
    layer: 1,
    scope,
    content,
    source: "past_refinement",
    locked_tick: target_tick,
    notes,
  });
  return { verdict: "accepted", fact, reason: `细化过去 '${scope}' (tick ${target_tick}) 已锁定` };
}

// ── 不可回溯修改的硬性保证 ───────────────────────────

/**
 * 尝试修改一个已锁定事实 —— 永远拒绝（单向累积）。
 * 这是"细化即锁定/历史即锁定"的确定性防线：已确定的事实不可改。
 */
export function tryModifyFact(lore: CanonicalLore, factId: string, _newContent: string): {
  allowed: false;
  reason: string;
} {
  const fact = lore.facts.find((f) => f.id === factId);
  if (!fact) return { allowed: false, reason: `事实 ${factId} 不存在` };
  return {
    allowed: false,
    reason: `事实 '${fact.scope}' (${fact.id}) 已锁定，不可回溯修改。只能在其下继续细化，或追加新历史。`,
  };
}

/** 断言：同一 scope 不能被改写到已确定层级 */
export function canRefineFurther(lore: CanonicalLore, scope: string, targetLayer: number): boolean {
  const existing = lore.facts.filter((f) => f.scope === scope);
  if (existing.length === 0) return true;
  return targetLayer > Math.max(...existing.map((f) => f.layer));
}

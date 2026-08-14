/**
 * 维度注册表 (§3.5/§4.2) — 动态涌现的发展轴。
 *
 * 核心原则（SIMULATION_DESIGN.md §4.2）：
 * - "什么构成发展"是涌现的，不是预设的。维度不由我们预设，而是推演中涌现。
 * - agent 行为（开放式）→ 调度器观察哪些轴反复在塑造结果
 *   → 按"出现频率 × 后果权重 × 法则一致性"升格为受追踪维度。
 * - 维度一旦注册就用确定性数值一致地算（自洽）；可消退，新轴升起。
 *
 * Phase 0 无 agent，升格信号来自物理引擎观察到的"实际塑造结果的轴"——
 * 由区域资源 + 世界法则派生（法则决定"有哪些发展轴"，见 physics.deriveTechPotential）。
 * 升格判定公式在此落地，后续 Phase 1 接入 agent 行为信号时复用同一函数。
 */

import type {
  DimensionDef,
  DimensionKind,
  DimensionRegistry,
  WorldLaws,
} from "./types.ts";

// ── 升格判定 (§4.2) ───────────────────────────────────

export type PromotionSignal = {
  dim: string;
  kind: DimensionKind;
  /** 出现频率 0-1（该轴在多大概率上出现在 agent 行为/事件中） */
  frequency: number;
  /** 后果权重 0-1（该轴对世界状态变化的影响幅度） */
  consequence: number;
  /** 法则一致性 0-1（该轴与世界法则的吻合度） */
  lawConsistency: number;
  /** 潜力上限（由空间/法则推导） */
  potential: number;
  description?: string;
};

export type PromotionParams = {
  /** 升格阈值：signal_score ≥ threshold 才注册 */
  threshold: number;
  /** 权重系数 */
  freqWeight: number;
  consWeight: number;
  lawWeight: number;
};

export const DEFAULT_PROMOTION_PARAMS: PromotionParams = {
  threshold: 0.35,
  freqWeight: 0.4,
  consWeight: 0.35,
  lawWeight: 0.25,
};

/**
 * 升格判定：出现频率 × 后果权重 × 法则一致性。
 * 返回 0-1 的升格分。≥ threshold 则注册。
 */
export function promotionScore(
  signal: PromotionSignal,
  params: PromotionParams = DEFAULT_PROMOTION_PARAMS,
): number {
  return (
    signal.frequency * params.freqWeight
    + signal.consequence * params.consWeight
    + signal.lawConsistency * params.lawWeight
  );
}

/**
 * 尝试注册一个维度。返回 { registered, score, reason }。
 * 已注册 → 只更新 last_active。未达阈值 → 不注册。
 */
export function tryRegisterDimension(
  registry: DimensionRegistry,
  signal: PromotionSignal,
  tick: number,
  params: PromotionParams = DEFAULT_PROMOTION_PARAMS,
): { registered: boolean; score: number; reason: string } {
  const score = promotionScore(signal, params);
  const existing = registry.dims[signal.dim];
  if (existing) {
    existing.last_active = tick;
    if (signal.potential > existing.potential) existing.potential = signal.potential;
    return { registered: false, score, reason: "already-registered" };
  }
  if (score < params.threshold) {
    return { registered: false, score, reason: "below-threshold" };
  }
  registry.dims[signal.dim] = {
    name: signal.dim,
    kind: signal.kind,
    potential: signal.potential,
    weight: Math.round(score * 100) / 100,
    description: signal.description,
    first_tick: tick,
    last_active: tick,
  };
  registry.history.push({
    tick,
    action: "register",
    dim: signal.dim,
    reason: `score=${score.toFixed(2)} >= threshold=${params.threshold}`,
  });
  return { registered: true, score, reason: "registered" };
}

/**
 * 依据世界法则 + 区域资源推导初始"候选维度信号"。
 * Phase 0：法则决定有哪些发展轴（物理层派生），频率/后果按资源潜力折算。
 * Phase 1 起，agent 行为信号会并入。
 */
export function signalsFromLaws(
  laws: WorldLaws,
  techPotential: Record<string, number>,
): PromotionSignal[] {
  const meta = laws.physics.metaphysics ?? {};
  const signals: PromotionSignal[] = [];

  for (const [dim, potential] of Object.entries(techPotential)) {
    // 频率 = 潜力/100（潜力越高的轴越常被"尝试"）；后果 = 潜力相关性
    signals.push({
      dim,
      kind: "tech",
      frequency: clamp01(potential / 100),
      consequence: clamp01(potential / 100),
      lawConsistency: 1,
      potential,
      description: `由世界法则/空间推导的发展轴（潜力 ${Math.round(potential)}）`,
    });
  }

  // 理念维度：由世界法则的本体规则推导（如第二物理 → 对力量之源的敬畏/对天道的顺应）
  if ((meta.mana ?? 0) > 0) {
    signals.push({
      dim: "对力量之源的敬畏",
      kind: "value",
      frequency: clamp01((meta.mana ?? 0) / 100),
      consequence: 0.7,
      lawConsistency: 1,
      potential: meta.mana ?? 0,
      description: "魔法世界的理念维度：对魔力来源的敬畏",
    });
  }
  if ((meta.qi ?? 0) > 0) {
    signals.push({
      dim: "对天道的顺应",
      kind: "value",
      frequency: clamp01((meta.qi ?? 0) / 100),
      consequence: 0.7,
      lawConsistency: 1,
      potential: meta.qi ?? 0,
      description: "真气世界的理念维度：对天地法则的顺应",
    });
  }

  return signals;
}

/** 由物理引擎的 techPotential 初始化/同步注册表中的 tech 维度 */
export function syncTechDimensions(
  registry: DimensionRegistry,
  techPotential: Record<string, number>,
  tick: number,
): void {
  for (const [dim, potential] of Object.entries(techPotential)) {
    const existing = registry.dims[dim];
    if (existing) {
      if (potential > existing.potential) existing.potential = potential;
      existing.last_active = tick;
    } else {
      registry.dims[dim] = {
        name: dim,
        kind: "tech",
        potential,
        weight: clamp01(potential / 100),
        first_tick: tick,
        last_active: tick,
      };
      registry.history.push({ tick, action: "register", dim, reason: "sync-from-physics" });
    }
  }
}

/**
 * 维度升格（promote, §3.5/§4.2）：维度重要性上升 → 权重上调。
 * 时代主题强化（如航海成为时代主轴 → 航海维度 promote）。
 */
export function promoteDimension(
  registry: DimensionRegistry,
  dim: string,
  amount = 0.1,
  tick = 0,
  reason = "importance increased",
): boolean {
  const def = registry.dims[dim];
  if (!def) return false;
  def.weight = Math.min(1, def.weight + amount);
  def.last_active = tick;
  registry.history.push({ tick, action: "promote", dim, reason });
  return true;
}

/**
 * 维度降格（demote, §3.5/§4.2）：维度重要性下降 → 权重下调。
 * 时代主题消退（如工业取代航海 → 航海维度 demote）。
 */
export function demoteDimension(
  registry: DimensionRegistry,
  dim: string,
  amount = 0.1,
  tick = 0,
  reason = "importance decreased",
): boolean {
  const def = registry.dims[dim];
  if (!def) return false;
  def.weight = Math.max(0, def.weight - amount);
  def.last_active = tick;
  registry.history.push({ tick, action: "demote", dim, reason });
  return true;
}

// ── 维度生命周期（retire）──

export type RetireParams = { inactiveTicks: number };

/**
 * 维度消退：超过 inactiveTicks 无活跃 → retire。
 * 防止注册表无限膨胀。
 */
export function retireInactiveDimensions(
  registry: DimensionRegistry,
  currentTick: number,
  params: RetireParams = { inactiveTicks: 20 },
): string[] {
  const retired: string[] = [];
  for (const [dim, def] of Object.entries(registry.dims)) {
    // 冻结维度不参与 retire（§十二 风险缓解）
    if (registry.frozen.includes(dim)) continue;
    if (currentTick - def.last_active >= params.inactiveTicks) {
      delete registry.dims[dim];
      registry.history.push({
        tick: currentTick,
        action: "retire",
        dim,
        reason: `inactive for ${currentTick - def.last_active} ticks`,
      });
      retired.push(dim);
    }
  }
  return retired;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 检查维度是否已注册（供外部判断） */
export function isRegistered(registry: DimensionRegistry, dim: string): boolean {
  return dim in registry.dims;
}

/** 获取已注册 tech 维度集合 */
export function techDims(registry: DimensionRegistry): string[] {
  return Object.values(registry.dims)
    .filter((d) => d.kind === "tech")
    .map((d) => d.name);
}

/** 获取已注册 value 维度集合 */
export function valueDims(registry: DimensionRegistry): string[] {
  return Object.values(registry.dims)
    .filter((d) => d.kind === "value")
    .map((d) => d.name);
}

export function emptyRegistry(): DimensionRegistry {
  return { dims: {}, history: [], frozen: [] };
}

/** 冻结维度（§十二: 注册表可人工冻结, 防维度涌现失控）——冻结后不可 retire */
export function freezeDimension(registry: DimensionRegistry, dim: string): void {
  if (!registry.frozen.includes(dim)) registry.frozen.push(dim);
}

/** 解冻维度 */
export function unfreezeDimension(registry: DimensionRegistry, dim: string): void {
  registry.frozen = registry.frozen.filter((d) => d !== dim);
}

/** 冻结的维度不参与 retire（§4.2 生命周期） */
export function isFrozen(registry: DimensionRegistry, dim: string): boolean {
  return registry.frozen.includes(dim);
}

export function emptyDimensionDef(name: string, kind: DimensionKind, potential: number): DimensionDef {
  return { name, kind, potential, weight: 0, first_tick: 0, last_active: 0 };
}

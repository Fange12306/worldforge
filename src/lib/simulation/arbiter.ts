/**
 * 片尾仲裁器 (§5.3) — 自洽核心。每 tick 所有 agent 产出汇总后统一对账。
 *
 * 对应 SIMULATION_DESIGN.md §5.3：
 * 1. 冲突检测 — 两个实体对同一事件的不同说法 → 需要消解。
 * 2. 硬约束检查 — 全部事件过物理层 + 规则层（世界法则 rules）。
 * 3. 细化即锁定检查 — 事件涉及既有区域描述，必须符合背景规则库，只许向下细化。
 * 4. 历史即锁定检查 — 新事件必须建立在已发生历史上，不得与已确定历史矛盾。
 * 5. 消解策略 — 等级仲裁（数值优先）/ 合并对账 / 打回重写 / 细化入库 / 历史锁定。
 * 6. 实体消解（EvoSpark 启发）— 同一实体被不同 agent 起了不同名字/状态 → 统一到 canonical id。
 *
 * 扩展（§4.4/§7）：
 * - 软约束（叙事层）检查：违反不阻断，但标记并在事件描述中体现张力。
 * - rigor 生效：高 rigor 拒绝"巧合救场"（黑天鹅逆转明确因果）。
 * - 打回受阻记录：被否决事件生成一条"受阻"记录，保持历史连续。
 *
 * 全局仲裁 agent（LLM 裁决多个冲突）与细化合理性语义判定留接口（Phase 1 接入 single_chat）。
 */

import type {
  CanonicalLore,
  EntityCard,
  SimulationConfig,
  SimulationEvent,
  WorldLaws,
} from "./types.ts";
import { findLoreByScope, maxLockedLayer, canRefineFurther } from "./lore.ts";

// ── 类型 ──────────────────────────────────────────────

export type Violation = {
  level: "hard" | "soft";
  rule: string;
  event_id: string;
  reason: string;
};

export type ConflictPair = {
  eventA: SimulationEvent;
  eventB: SimulationEvent;
  topic: string;
  resolution: "numeric" | "llm" | "merged";
  resolved?: { winner: string; loser: string };
};

export type ArbitrationResult = {
  /** 通过的事件（保持原样或已合并） */
  accepted: SimulationEvent[];
  /** 被打回/否决的事件 */
  rejected: { event: SimulationEvent; reason: string }[];
  /** 受阻记录（被否决事件的"受阻"标记, 保持历史连续 §5.3） */
  blocked: SimulationEvent[];
  /** 已细化入库的细节 */
  refinements: { scope: string; content: string; layer: number }[];
  /** 检查到的冲突（已消解或待 LLM） */
  conflicts: ConflictPair[];
  violations: Violation[];
  /** 软约束（叙事层）标记, §4.4 */
  softWarnings: Violation[];
};

// ── 主入口 ────────────────────────────────────────────

export type ArbitrateContext = {
  laws: WorldLaws;
  config: SimulationConfig;
  entities: Record<string, EntityCard>;
  lore: CanonicalLore;
  currentTick: number;
  llm?: {
    resolveConflict: (a: SimulationEvent, b: SimulationEvent) => Promise<ConflictPair["resolved"]>;
    validateRefinement: (content: string, laws: WorldLaws) => Promise<boolean>;
    /** §4.3 规则层语义复核（可选）: 批量判定事件是否违反世界法则（关键词粗筛之外的第二道防线） */
    validateRules?: (events: SimulationEvent[], laws: WorldLaws) => Promise<{ violations: { event_id: string; reason: string }[] }>;
  };
};

/**
 * 仲裁一批事件。
 * 输入：本 tick 所有 agent/引擎产出的事件。
 * 输出：通过的事件（进历史锁定）、拒绝的事件、受阻记录、细化的细节、冲突记录、软约束标记。
 */
export async function arbitrate(
  ctx: ArbitrateContext,
  events: SimulationEvent[],
): Promise<ArbitrationResult> {
  const result: ArbitrationResult = {
    accepted: [], rejected: [], blocked: [], refinements: [], conflicts: [], violations: [], softWarnings: [],
  };

  // 0. §4.3 规则层语义复核（可选）: 关键词粗筛之外的 LLM 批量判定（只审 agent 事件, 引擎事件由确定性逻辑生成）
  const llmViolations = new Map<string, string>(); // event_id → reason
  if (ctx.llm?.validateRules) {
    const agentEvents = events.filter((e) => e.source === "agent");
    if (agentEvents.length > 0) {
      const res = await ctx.llm.validateRules(agentEvents, ctx.laws);
      for (const v of res?.violations ?? []) {
        if (v.event_id && agentEvents.some((e) => e.id === v.event_id)) {
          llmViolations.set(v.event_id, v.reason ?? "LLM 判定违反世界法则");
        }
      }
    }
  }

  // 细化候选: 按事件 id 暂存, 冲突消解/去重完成后再按"最终 accepted"收集（§5.3）
  const refinementCandidates = new Map<string, { scope: string; content: string; layer: number }>();

  for (const event of events) {
    // 1. 硬约束检查（世界法则 rules + physics）
    const v = checkHardConstraints(event, ctx.laws);
    if (v.hard.length > 0) {
      result.rejected.push({ event, reason: v.hard[0].reason });
      result.violations.push(...v.hard);
      result.blocked.push(makeBlockedEvent(event, v.hard[0].rule, v.hard[0].reason));
      continue;
    }

    // 1.1 规则层语义复核命中 → 打回（与硬约束同级, 受阻记录保持历史连续）
    const llmReason = llmViolations.get(event.id);
    if (llmReason) {
      result.rejected.push({ event, reason: llmReason });
      result.violations.push({ level: "hard", rule: "世界法则(语义复核)", event_id: event.id, reason: llmReason });
      result.blocked.push(makeBlockedEvent(event, "世界法则", llmReason));
      continue;
    }

    // 1.5 软约束（叙事层）检查（§4.4）：违反不阻断, 标记张力
    const soft = checkNarrativeSoft(event, ctx.laws);
    if (soft.length > 0) {
      result.softWarnings.push(...soft);
      // 事件描述体现张力（§4.4）
      event.description = `${event.description}\n[叙事张力: ${soft[0].rule}]`;
    }

    // 1.6 叙事-数值一致性软检查（改动 2）：事件声称的指标后果 vs 实体硬边界 → 软警告, 不阻断
    const metricWarn = checkMetricConsistency(event, ctx);
    if (metricWarn.length > 0) {
      result.softWarnings.push(...metricWarn);
    }

    // 1.75 rigor 检查（§7）：高 rigor 拒绝"巧合救场"（黑天鹅逆转明确因果）
    const rigorCheck = checkRigor(event, ctx);
    if (rigorCheck.blocked) {
      result.rejected.push({ event, reason: rigorCheck.reason ?? "因果严密性检查失败" });
      result.blocked.push(makeBlockedEvent(event, "因果严密性", rigorCheck.reason ?? ""));
      continue;
    }

    // 2. 细化即锁定检查（空间向）：事件若声称了某区域细节，必须符合背景规则库
    const refineCheck = checkRefinementLock(event, ctx);
    if (refineCheck.blocked) {
      result.rejected.push({ event, reason: refineCheck.reason ?? "细化即锁定检查失败" });
      result.blocked.push(makeBlockedEvent(event, "细化即锁定", refineCheck.reason ?? ""));
      continue;
    }
    if (refineCheck.isRefinement && refineCheck.refinement) {
      refinementCandidates.set(event.id, refineCheck.refinement);
    }

    // 3. 历史即锁定检查（时间向）：不得与已发生历史矛盾
    const histCheck = checkHistoryLock(event, ctx);
    if (histCheck.blocked) {
      result.rejected.push({ event, reason: histCheck.reason ?? "历史即锁定检查失败" });
      result.blocked.push(makeBlockedEvent(event, "历史即锁定", histCheck.reason ?? ""));
      continue;
    }

    result.accepted.push(event);
  }

  // 4. 冲突检测 + 消解（跨事件对）
  const conflictPairs = detectConflicts(result.accepted);
  for (const pair of conflictPairs) {
    const resolved = await resolveConflict(pair, ctx);
    result.conflicts.push(resolved);
    // 等级仲裁决出胜负后, 只移除败方"那一条冲突事件"（合并对账, §5.3）——
    // 旧实现按 participants[0] 过滤, 把败方本 tick 的无关事件也一并删除（误伤）
    if (resolved.resolved?.loser) {
      const loserEvent = pair.eventA.participants[0] === resolved.resolved.loser
        ? pair.eventA
        : (pair.eventB.participants[0] === resolved.resolved.loser ? pair.eventB : null);
      if (loserEvent) {
        result.accepted = result.accepted.filter((e) => e !== loserEvent);
        // 败方事件以"受阻"记录可见（历史连续）; 其细化提案由下方收集规则自动作废
        result.rejected.push({ event: loserEvent, reason: "冲突仲裁落败（与对方宣称互斥）" });
        result.blocked.push(makeBlockedEvent(loserEvent, "冲突消解", "与「" + resolved.resolved.winner + "」的宣称冲突, 仲裁落败"));
      }
    }
  }

  // 5. 实体消解（§5.3 第6步, EvoSpark 启发）：同区域同现象的重复事件合并到 canonical
  result.accepted = resolveEntityDuplicates(result.accepted);

  // 6. 细化入库候选: 只保留"最终 accepted"事件的细化（冲突落败/被拒事件的细化不作数, §5.3）
  result.refinements = result.accepted
    .map((e) => refinementCandidates.get(e.id))
    .filter((r): r is { scope: string; content: string; layer: number } => !!r);

  return result;
}

// ── 1. 硬约束检查 ─────────────────────────────────────

/** 世界法则规则层 + 物理层的关键词/数值匹配（§4.3）。 */
function checkHardConstraints(
  event: SimulationEvent,
  laws: WorldLaws,
): { hard: Violation[]; soft: Violation[] } {
  const hard: Violation[] = [];
  const soft: Violation[] = [];
  const text = `${event.description} ${event.type}`;

  for (const rule of laws.rules) {
    if (rule.includes("不可能") && ruleHasMatch(rule, text)) {
      hard.push({
        level: "hard",
        rule,
        event_id: event.id,
        reason: `事件与硬约束「${rule}」冲突`,
      });
    }
  }

  // §4.3 timeline_id 作用域: 带作用域的规则只在匹配的时间轴生效（空=通用）
  for (const tr of laws.timeline_rules ?? []) {
    // 事件无 timeline_id → 只应用通用作用域规则; 事件有 timeline_id → 应用匹配或通用
    if (tr.timeline_id && event.timeline_id && tr.timeline_id !== event.timeline_id) {
      continue; // 规则属于其他时间轴, 不适用
    }
    if (tr.rule.includes("不可能") && ruleHasMatch(tr.rule, text)) {
      hard.push({
        level: "hard",
        rule: `${tr.rule}${tr.timeline_id ? ` [时间轴 ${tr.timeline_id}]` : ""}`,
        event_id: event.id,
        reason: `事件与${tr.timeline_id ? "该时间轴的" : "通用"}硬约束「${tr.rule}」冲突`,
      });
    }
  }

  for (const ch of event.changes) {
    if (ch.metrics?.military && ch.metrics.military < 0) {
      soft.push({
        level: "soft",
        rule: "军力不得为负",
        event_id: event.id,
        reason: `${ch.entity} 军力变化导致负值`,
      });
    }
  }

  return { hard, soft };
}

// ── 1.5 软约束（叙事层）检查 ──────────────────────────

/** 叙事层（§4.4）：文明风格/价值观/禁忌。违反不阻断, 标记张力。 */
function checkNarrativeSoft(event: SimulationEvent, laws: WorldLaws): Violation[] {
  const result: Violation[] = [];
  const text = `${event.description} ${event.type}`;
  for (const rule of laws.narrative) {
    if (ruleHasMatch(rule, text)) {
      result.push({
        level: "soft",
        rule,
        event_id: event.id,
        reason: `事件触及叙事约束「${rule}」, 体现张力`,
      });
    }
  }
  return result;
}

// ── 1.6 叙事-数值一致性软检查（改动 2）────────────────

/** 人口硬下限（与 engine.ts 的 MIN_POP 一致） */
const MIN_POP = 100;

/**
 * 事件声称的指标后果 vs 实体硬边界的确定性冲突软检查。
 * 声称的增量把某指标推出合法范围（人口 < 下限 / 军力 < 0 / 0-100 指标超界）→ 软警告。
 * 不阻断（叙事可夸张, clamp 会兜底）; 仅标记供 UI/审查可见"LLM 声称了不可能的结果"。
 */
function checkMetricConsistency(event: SimulationEvent, ctx: ArbitrateContext): Violation[] {
  const result: Violation[] = [];
  for (const c of event.changes ?? []) {
    const m = c.metrics;
    if (!m) continue;
    const entity = ctx.entities[c.entity];
    if (!entity) continue;
    for (const [k, v] of Object.entries(m) as Array<[keyof EntityCard["metrics"], unknown]>) {
      if (typeof v !== "number") continue;
      const cur = entity.metrics[k];
      const next = cur + v;
      const signed = `${v >= 0 ? "+" : ""}${v}`;
      if (k === "population" && next < MIN_POP) {
        result.push({ level: "soft", rule: "人口不得低于下限", event_id: event.id, reason: `${entity.name} 人口 ${cur}${signed} 将低于下限 ${MIN_POP}` });
      } else if (k === "military" && next < 0) {
        result.push({ level: "soft", rule: "军力不得为负", event_id: event.id, reason: `${entity.name} 军力 ${cur}${signed} 将为负` });
      } else if (k !== "population" && k !== "military" && k !== "food" && (next > 100 || next < 0)) {
        result.push({ level: "soft", rule: "指标超边界", event_id: event.id, reason: `${entity.name} ${k} ${cur}${signed} 超出 [0,100]` });
      }
    }
  }
  return result;
}

// ── 1.75 rigor 检查（§7）──────────────────────────────

/**
 * rigor（因果严密性）生效：高 rigor 拒绝"巧合救场"。
 * 黑天鹅事件（random=true）若被用来逆转一个明确因果进程（如大军压境一方必胜却失败）→ 拒绝/改写。
 */
function checkRigor(
  event: SimulationEvent,
  ctx: ArbitrateContext,
): { blocked: boolean; reason?: string } {
  const rigor = ctx.config.rigor;
  // 低 rigor 允许巧合（传奇模式）
  if (rigor < 0.5) return { blocked: false };
  // 非黑天鹅事件不适用（黑天鹅才可能是巧合救场）
  if (!event.random) return { blocked: false };

  // 高 rigor：黑天鹅不应用于逆转"明确因果"。检测：
  // 事件声明了吞并/灭亡(absorbed_by/collapsed)这类结果性变化, 且声称的结果与实体军力明显相反
  const declaresConquestOrCollapse = event.changes?.some((c) => c.absorbed_by || c.collapsed);
  if (declaresConquestOrCollapse) {
    const [winnerId, loserId] = event.participants;
    const winner = winnerId ? ctx.entities[winnerId] : undefined;
    const loser = loserId ? ctx.entities[loserId] : undefined;
    if (winner && loser && rigor >= 0.7) {
      // 若胜者军力远低于败者 → 巧合救场, 高 rigor 拒绝
      const winnerMil = winner.metrics.military;
      const loserMil = loser.metrics.military;
      if (loserMil > winnerMil * 1.5) {
        return {
          blocked: true,
          reason: `高 rigor 拒绝巧合救场：${winner.name} 军力(${winnerMil})远低于 ${loser.name}(${loserMil}) 却宣称取胜（§7）`,
        };
      }
    }
  }
  return { blocked: false };
}

/** 生成"受阻"记录（§5.3 打回重写, 保持历史连续） */
function makeBlockedEvent(event: SimulationEvent, rule: string, reason: string): SimulationEvent {
  return {
    id: `blocked-${event.id}`,
    tick: event.tick,
    time_label: event.time_label,
    type: "other",
    participants: event.participants,
    region: event.region,
    description: `【受阻】${rule}: ${reason}`,
    changes: [],
    causals: event.causals,
    random: false,
    source: "engine",
  };
}

// ── 2. 细化即锁定检查（空间向）───────────────────────

/** 空间细化的最大层数（每 scope 至多 初始 + MAX_REFINEMENT_LAYERS 条空间事实, 防 lore 无限膨胀） */
const MAX_REFINEMENT_LAYERS = 4;

/**
 * 只有"空间细节事件"才产生细化入库——生态变化/区域细分(engine 源、非随机)描述空间本身;
 * agent 行为叙事/黑天鹅(战争/瘟疫/异象)不是空间事实, 只进事件日志, 不锁入 lore
 * （§3.6 细化即锁定锁的是"空间细节", 不是事件叙事——旧实现把事件描述当细化锁定, 导致 lore 膨胀+语义污染）。
 */
function isSpatialDetailEvent(event: SimulationEvent): boolean {
  return event.source === "engine" && !event.random && event.type !== "other";
}

function checkRefinementLock(
  event: SimulationEvent,
  ctx: ArbitrateContext,
): { blocked: boolean; reason?: string; isRefinement?: boolean; refinement?: { scope: string; content: string; layer: number } } {
  if (!event.region) return { blocked: false };
  const scope = event.region;

  // 非空间细节事件: 通过（事件叙事由事件日志/历史锁定管理, 不锁为空间事实）
  if (!isSpatialDetailEvent(event)) return { blocked: false };

  const existing = findLoreByScope(ctx.lore, scope);
  if (existing.length === 0) {
    return {
      blocked: false,
      isRefinement: true,
      refinement: { scope, content: event.description, layer: 0 },
    };
  }

  // 细化层数封顶: 超过 MAX_REFINEMENT_LAYERS 不再入库（事件照常 accepted, 历史由事件日志锁定）
  const maxLayer = maxLockedLayer(ctx.lore, scope);
  if (maxLayer >= MAX_REFINEMENT_LAYERS) return { blocked: false };
  if (existing.some((f) => f.content && f.content !== event.description && event.description.includes(f.content))) {
    return { blocked: false };
  }
  if (canRefineFurther(ctx.lore, scope, maxLayer + 1)) {
    return {
      blocked: false,
      isRefinement: true,
      refinement: { scope, content: event.description, layer: maxLayer + 1 },
    };
  }
  return { blocked: false };
}

// ── 3. 历史即锁定检查（时间向）───────────────────────

function checkHistoryLock(
  event: SimulationEvent,
  ctx: ArbitrateContext,
): { blocked: boolean; reason?: string } {
  if (event.tick > ctx.currentTick) {
    return { blocked: true, reason: `事件 tick ${event.tick} > 当前 ${ctx.currentTick}, 不能预支未来` };
  }
  return { blocked: false };
}

// ── 4. 冲突检测 ───────────────────────────────────────

/** 检测两个事件对同一对象的冲突说法（同一参与者 + 同一区域 + 不同结果）。
 *  冲突性由事件的 major 语义标志（LLM 判断）而非 type 枚举决定:
 *  两个 major 事件对同一批参与者宣称互斥的结果 → 冲突。 */
function detectConflicts(events: SimulationEvent[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      const aResult = a.major || a.changes?.some((c) => c.absorbed_by || c.collapsed || c.founded);
      const bResult = b.major || b.changes?.some((c) => c.absorbed_by || c.collapsed || c.founded);
      if (aResult && bResult) {
        const sharedParticipants = a.participants.filter((p) => b.participants.includes(p));
        if (sharedParticipants.length === 0) continue;
        // 直接互斥的吞并宣称（A 声称吞并 B, B 声称吞并 A）——同一件事的相反说法, 跨区域也算冲突
        const aAbsorb = a.changes?.find((c) => c.absorbed_by);
        const bAbsorb = b.changes?.find((c) => c.absorbed_by);
        const contradictoryAbsorption = !!(
          aAbsorb && bAbsorb
          && aAbsorb.absorbed_by === b.participants[0]
          && bAbsorb.absorbed_by === a.participants[0]
        );
        if (a.region === b.region || contradictoryAbsorption) {
          pairs.push({
            eventA: a,
            eventB: b,
            topic: `${a.region} 的 ${sharedParticipants.join("、")} 冲突`,
            resolution: "numeric",
          });
        }
      }
    }
  }
  return pairs;
}

// ── 5. 冲突消解 ───────────────────────────────────────

async function resolveConflict(pair: ConflictPair, ctx: ArbitrateContext): Promise<ConflictPair> {
  if (ctx.llm?.resolveConflict) {
    const resolved = await ctx.llm.resolveConflict(pair.eventA, pair.eventB);
    return { ...pair, resolution: "llm", resolved };
  }
  const militaryOf = (event: SimulationEvent): number => {
    const name = event.participants[0];
    const entity = ctx.entities[name];
    return entity?.metrics.military ?? 0;
  };
  const mA = militaryOf(pair.eventA);
  const mB = militaryOf(pair.eventB);
  if (mA !== mB) {
    const winner = mA > mB ? pair.eventA : pair.eventB;
    const loser = mA > mB ? pair.eventB : pair.eventA;
    return { ...pair, resolution: "numeric", resolved: { winner: winner.participants[0], loser: loser.participants[0] } };
  }
  return pair;
}

// ── 5. 实体消解（§5.3 第6步）──────────────────────────

/**
 * 实体消解（EvoSpark 启发）：同一实体被不同 agent 起了不同名字/状态 → 统一到 canonical id。
 * Phase 0 确定性实现：同区域 + 同类型 + 描述高度相似的事件合并为一条（去重同一现象）。
 * 真正的"同实体不同 id 合并"由 LLM 语义判定（llm.resolveConflict 已覆盖冲突事件对）。
 */
function resolveEntityDuplicates(events: SimulationEvent[]): SimulationEvent[] {
  const merged: SimulationEvent[] = [];
  const seen: { key: string; ev: SimulationEvent }[] = [];
  for (const ev of events) {
    const key = `${ev.region}|${ev.type}`;
    const similar = seen.find((s) => {
      if (s.key !== key) return false;
      return similarity(s.ev.description, ev.description) > 0.75;
    });
    if (similar) {
      // 合并：保留第一个, 参与者合并
      similar.ev.participants = [...new Set([...similar.ev.participants, ...ev.participants])];
      continue;
    }
    seen.push({ key, ev });
    merged.push(ev);
  }
  return merged;
}

/** 简单文本相似度（字符级重合率） */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const aChars = new Set(a);
  const bChars = new Set(b);
  const inter = [...aChars].filter((c) => bChars.has(c)).length;
  return inter / Math.max(aChars.size, bChars.size, 1);
}

// ── 导出辅助 ──────────────────────────────────────────

/** 判断一批事件是否全部通过（供调度器决定是否锁定历史） */
export function allAccepted(result: ArbitrationResult): boolean {
  return result.rejected.length === 0;
}

/** 规则关键词是否命中（供外部使用）。
 * 只取规则的"核心实体/现象"名词——排除泛动词（发生/存在/进行）和程度词。
 * 要求规则的所有核心 token 都出现在事件文本中才算命中, 避免"起死回生不可能发生"
 * 因事件里带"发生"二字就误匹配。 */
export function ruleHasMatch(rule: string, text: string): boolean {
  const tokens = rule
    .replace(/不可能|必须|不得|任何|所有|事件|规则|发生|存在|进行|出现|导致|能够|可以|会|的/g, " ")
    .split(/[，。；、\s，。]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  // 无有效 token（规则过短）→ 不命中, 避免误拦
  if (tokens.length === 0) return false;
  return tokens.every((t) => text.includes(t));
}

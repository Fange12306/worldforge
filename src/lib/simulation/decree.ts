/**
 * 干预指令判定 (§3.7/§5.5) — 用户从"旁观者"变为"可干预的神明"，但仍受世界法则约束。
 *
 * 对应 SIMULATION_DESIGN.md §5.5：
 * 用户注入的干预指令（Decree）**不直接生效**，必须经过判定，决定它以何种方式进入历史。
 *
 * 判定依据：
 * 1. 历史法则判定 — 指令是否违反世界法则/物理层（§4.0①/§4.1/§4.3）？违反物理常识的不成立。
 * 2. 历史惯性判定 — 指令与已发生历史、当前趋势的吻合度（§4.0 核心规则 3 + §5.4）？
 * 3. 面向过去的额外关卡：与已发生未来兼容（direction="past" 时）。
 *
 * 判定结果谱系：
 * - accepted（完全生效）：符合法则 + 与历史惯性相容。
 * - adjusted（打折生效）：部分违背 → 以调整后形式生效。
 * - twisted（扭曲生效）：与法则冲突但用户坚持 → 以悲剧/意外/变异形式实现。
 * - rejected（拒绝生效）：完全违反法则 → 否决，但记录为"天意被阻"。
 *
 * 自然化原则：指令在历史里被自然化为世界内部的力量（神谕/天启/强人崛起/思潮），
 * 由 agent 在法则内实现。
 *
 * Phase 0/1：纯确定性判定（规则关键词匹配 + 历史惯性评分）。
 * 全局仲裁 agent（LLM）语义判定留接口。
 */

import type {
  CanonicalLore,
  Decree,
  DecreeStrength,
  DecreeVerdict,
  EntityCard,
  SimulationEvent,
  WorldLaws,
} from "./types.ts";

// ── 判定上下文 ────────────────────────────────────────

export type DecreeContext = {
  laws: WorldLaws;
  lore: CanonicalLore;
  entities: Record<string, EntityCard>;
  events: SimulationEvent[];     // 全部已发生历史
  currentTick: number;
  /** LLM 语义判定接口（Phase 1 接 single_chat） */
  llm?: {
    assess: (decree: Decree, context: string) => Promise<{ verdict: DecreeVerdict; note: string }>;
  };
};

export type DecreeAdjudication = {
  decree: Decree;
  verdict: DecreeVerdict;
  note: string;
  /** 评分明细 */
  lawScore: number;      // 0-1 与法则一致性
  inertiaScore: number;  // 0-1 与历史惯性吻合度
  futureCompat: boolean; // 与已发生未来兼容（仅 past）
};

// ── 判定主入口 ────────────────────────────────────────

export async function adjudicateDecree(
  ctx: DecreeContext,
  decree: Decree,
): Promise<DecreeAdjudication> {
  // 1. 历史法则判定
  const lawScore = assessLawCompliance(decree, ctx.laws);

  // 2. 历史惯性判定
  const inertiaScore = assessInertia(decree, ctx);

  // 3. 面向过去的未来兼容
  let futureCompat = true;
  if (decree.direction === "past") {
    futureCompat = assessFutureCompatibility(decree, ctx);
  }

  // 4. 综合判定（确定性基础；LLM 可覆盖）
  if (ctx.llm?.assess) {
    const llmResult = await ctx.llm.assess(decree, summarizeContext(ctx));
    return {
      decree,
      verdict: llmResult.verdict,
      note: llmResult.note,
      lawScore,
      inertiaScore,
      futureCompat,
    };
  }

  // 确定性判定：优先级 法则 > 未来兼容 > 惯性
  if (lawScore < 0.2 || (decree.direction === "past" && !futureCompat)) {
    return {
      decree,
      verdict: "rejected",
      note: decree.direction === "past"
        ? "与已发生历史/未来矛盾，天意被阻"
        : "严重违反世界法则，天意被阻",
      lawScore,
      inertiaScore,
      futureCompat,
    };
  }
  if (lawScore < 0.5) {
    return {
      decree,
      verdict: "twisted",
      note: "与法则冲突，以悲剧/意外/变异形式实现",
      lawScore,
      inertiaScore,
      futureCompat,
    };
  }
  if (inertiaScore < 0.4) {
    return {
      decree,
      verdict: "adjusted",
      note: "与历史惯性剧烈冲突，以打折形式生效",
      lawScore,
      inertiaScore,
      futureCompat,
    };
  }
  return {
    decree,
    verdict: "accepted",
    note: "符合法则且与历史惯性相容",
    lawScore,
    inertiaScore,
    futureCompat,
  };
}

// ── 历史法则判定 ──────────────────────────────────────

/** 评估指令与世界法则的一致性（0-1）。 */
function assessLawCompliance(decree: Decree, laws: WorldLaws): number {
  let score = 1;
  const intent = decree.intent;

  // 硬性违反物理常识（规则层, §4.3）
  for (const rule of laws.rules) {
    if (rule.includes("不可能") && lawKeywords(rule, intent)) {
      score -= 0.7;
    }
    if (rule.includes("必须") && !lawKeywords(rule, intent)) {
      score -= 0.3;
    }
  }

  // 本体规则冲突（§4.0①）
  for (const onto of laws.ontology) {
    if (onto.includes("边界") && intent.includes("超越")) {
      score -= 0.4;
    }
  }

  return Math.max(0, Math.min(1, score));
}

/** 规则关键词是否命中指令意图（简化匹配） */
function lawKeywords(rule: string, intent: string): boolean {
  const tokens = rule
    .replace(/不可能|必须|不得|任何|事件|规则/g, " ")
    .split(/[，。；、\s]+/)
    .filter((t) => t.length >= 2);
  return tokens.some((t) => intent.includes(t));
}

// ── 历史惯性判定 ──────────────────────────────────────

/** 评估指令与已发生历史/当前趋势的吻合度（0-1）。 */
function assessInertia(decree: Decree, ctx: DecreeContext): number {
  // 简化：根据实体当前状态与指令的吻合度
  const target = decree.target;
  if (target.type === "entity" && target.id) {
    const entity = ctx.entities[target.id];
    if (entity) {
      // 稳定/强大的实体 → 指令"顺势"吻合度高；衰败实体 → 强加巨变吻合度低
      const strength = (entity.metrics.legitimacy + entity.metrics.stability) / 2 / 100;
      return 0.3 + strength * 0.7;
    }
  }
  if (target.type === "region") {
    // 区域无明显历史 → 中性
    return 0.5;
  }
  // global
  return 0.5;
}

// ── 面向过去的未来兼容 ────────────────────────────────

/**
 * 细化的过去必须与已发生的未来兼容（§4.0 核心规则 3）。
 * 确定性检查：指令目标 tick 必须早于所有已发生未来事件的最早 tick。
 */
function assessFutureCompatibility(decree: Decree, ctx: DecreeContext): boolean {
  if (decree.target_tick > ctx.currentTick) {
    return false; // 不能预支未来
  }
  const futureEvents = ctx.events.filter((e) => e.tick > decree.target_tick);
  if (futureEvents.length === 0) return true;
  const earliestFuture = Math.min(...futureEvents.map((e) => e.tick));
  return decree.target_tick < earliestFuture;
}

// ── 辅助 ──────────────────────────────────────────────

/** 指令强度对引导权重的影响（供 agent 输入装配） */
export function strengthWeight(strength: DecreeStrength): number {
  switch (strength) {
    case "command": return 1;
    case "lean": return 0.6;
    case "nudge": return 0.3;
  }
}

/** 生成给 agent 的"外部力量"输入（自然化, §5.5） */
export function naturalizeDecree(decree: Decree): string {
  const target = decree.target.type === "entity"
    ? decree.target.id
    : decree.target.type === "region"
      ? decree.target.id
      : "整个世界";
  const strength = strengthWeight(decree.strength);
  const verb = strength >= 0.8 ? "天启昭示" : strength >= 0.5 ? "一场思潮涌动" : "隐约的预兆";
  return `【${verb}】${target} 的未来被指向：${decree.intent}`;
}

/** 把已判定通过的干预写入事件日志（作为"外部力量"事件） */
export function decreeToEvent(decree: Decree, adjudication: DecreeAdjudication, tick: number): SimulationEvent {
  return {
    id: `decree-${decree.id}`,
    tick,
    time_label: `tick ${tick}`,
    type: "other",
    participants: decree.target.id ? [decree.target.id] : [],
    region: decree.target.type === "region" && decree.target.id ? decree.target.id : "",
    description: `【天意】${decree.intent}（${adjudication.verdict}: ${adjudication.note}）`,
    changes: [],
    random: false,
    source: "decree",
  };
}

function summarizeContext(ctx: DecreeContext): string {
  return `当前 tick ${ctx.currentTick}，有 ${Object.keys(ctx.entities).length} 个活跃实体，${ctx.events.length} 条历史事件。法则: ${ctx.laws.name}`;
}

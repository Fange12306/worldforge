/**
 * 多 agent 并行推演 (§5.2) — 每个活跃实体一个 agent，独立推演并产出事件。
 *
 * 对应 SIMULATION_DESIGN.md §5.2：
 * - 调度器在**前端 lib 层**（TS）用并发 Promise 调度所有活跃 agent。
 * - 每个 agent 一轮**非流式 single_chat**（复用 api_proxy::single_chat），**不启用工具循环**。
 * - Agent 输入装配（§5.2）：世界模型全景 + 实体卡片 + 邻接动态 + 延迟窗口事件 + 未决议题 + 干预。
 * - Agent 产出契约（严格 JSON）：decisions/events/metric_delta/tech_delta/values_delta/notes。
 * - 产出过仲裁（§5.3）：硬约束/细化锁定/历史锁定/冲突消解。
 *
 * 依赖注入 LLM（llm.ts）：真实 single_chat 或 mock。mock 可测。
 */

import { buildAgentInput, buildEntityKnowledge, classifyAttention, computeActiveScore, entityTokenBudget } from "./context.ts";
import { parseJSONFromLLM, safeCall, type LLMBindings } from "./llm.ts";
import type { EntityCard, SimulationEvent, SimulationSession } from "./types.ts";

const clampNum = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

// ── Agent 产出契约（§5.2 严格 JSON）──────────────────

export type AgentOutput = {
  decisions: string[];
  events: Array<{
    /** 自由文本类型标签（LLM 结合时代/状态综合判断, 不预设枚举） */
    type: string;
    target?: string;             // 目标实体 id（若为交互）
    description: string;
    /** 是否结构性/重大事件（LLM 判断, 全文明广播） */
    major?: boolean;
    /** 结构化结果: 吞并/建国/灭亡/关系变化/数值后果 */
    changes?: Array<{
      entity: string;
      /** 数值后果(与叙事一致): 指标变化量。经调度器与顶层 metric_delta 合并去重后 clamp 生效 */
      metrics?: Partial<EntityCard["metrics"]>;
      /** 已注册维度的变化量(与顶层 tech_delta 合并去重) */
      tech?: Record<string, number>;
      values?: Record<string, number>;
      stance?: string;
      hostility?: number;
      absorbed_by?: string;
      founded?: { name: string; from: string };
      collapsed?: boolean;
    }>;
    expected_outcome?: string;
  }>;
  metric_delta?: Partial<{ population: number; food: number; economy: number; military: number; legitimacy: number; stability: number }>;
  tech_delta?: Record<string, number>;
  values_delta?: Record<string, number>;
  /** 领土扩张/新建区划（§4.0② 领土由 LLM 决策, 引擎校验后并入 territory） */
  territory_claim?: Array<{ region: string; name?: string; character?: string }>;
  /** 提议新发展轴（§4.2 涌现: 需复现≥2 次才注册, 防一次性维度膨胀） */
  propose_dim?: Array<{ name: string; reason: string }>;
  /** 政体演化决策（§: 物理层给信号, agent 决定形态——涌现） */
  regime_evolution?: {
    /** 演化后的政体形态描述（自由文本, 不预设类别） */
    new_form?: string;
    /** 集权度变化（-100 ~ +100） */
    centralization_delta?: number;
    /** 演化理由 */
    reason?: string;
  };
  /** 建议的时间粒度调整(每 tick 年数): agent 结合世界状态/时代判断, 软约束不预设档位 */
  suggest_years_per_tick?: number;
  notes?: string;
};

/**
 * agent 本 tick 的暂存改动——不直接写实体, 由调度器在物理基线之上 clamp 后应用,
 * 保证 LLM 决策真实生效且不被 physics 每 tick 全量覆盖（叙事/数值/空间一致）。
 */
export type AgentDelta = {
  metric_delta?: Partial<EntityCard["metrics"]>;
  tech_delta?: Record<string, number>;
  values_delta?: Record<string, number>;
  territory_claims?: NonNullable<AgentOutput["territory_claim"]>;
  propose_dims?: NonNullable<AgentOutput["propose_dim"]>;
};

// ── 单 agent 推演 ─────────────────────────────────────

export type AgentConfig = {
  llm: LLMBindings;
  maxTokens?: number;
  /** 从实体 agent 产出构建事件的策略（默认：每个 agent event → SimulationEvent） */
};

/**
 * 单个实体 agent 推演一轮。
 * 返回 { events, delta }：events 待仲裁; delta 由调度器在物理基线之上 clamp 应用。
 * 非 metric 状态（political_form/recent_events/active_issues/yearsPerTick）直接更新。
 */
export async function runEntityAgent(
  session: SimulationSession,
  entityId: string,
  agentConfig: AgentConfig,
): Promise<{ events: SimulationEvent[]; delta: AgentDelta | null; entityIds: string[] }> {
  const entity = session.entities[entityId];
  if (!entity || entity.status !== "active") return { events: [], delta: null, entityIds: [] };

  // 注意力分层：决定推理深度与 token 预算（§6）
  const score = computeActiveScore(entity, session);
  const attention = classifyAttention(score);
  const budget = entityTokenBudget(session.config, attention);

  // 信息延迟：装配该实体可见的世界（§5.1）
  const knowledge = buildEntityKnowledge(session, entity);
  const input = buildAgentInput(session, entity, knowledge, attention);

  // 非流式 single_chat（§5.2）
  const response = await safeCall(agentConfig.llm, {
    systemPrompt: input.system,
    userMessage: input.user,
    maxTokens: Math.min(agentConfig.maxTokens ?? 1024, budget),
    json: true,
  });

  if (!response) return { events: [], delta: null, entityIds: [] }; // LLM 失败 → 无产出（降级）

  // 解析 JSON 产出
  let output: AgentOutput;
  try {
    output = parseJSONFromLLM<AgentOutput>(response);
  } catch {
    return { events: [], delta: null, entityIds: [] }; // 产出不是合法 JSON → 丢弃
  }

  // 转成事件
  const events: SimulationEvent[] = [];
  const tick = session.current_tick;

  // 1. decisions → 内部决策（记录到 recent_events）——防御 LLM 输出对象/非字符串
  if (output.decisions?.length) {
    const decisionStrings = output.decisions
      .map((d) => typeof d === "string" ? d.trim() : (d && typeof d === "object" ? JSON.stringify(d) : ""))
      .filter(Boolean);
    if (decisionStrings.length > 0) {
      entity.internal.recent_events = [
        ...decisionStrings.map((d) => `决策: ${d}`),
        ...entity.internal.recent_events,
      ].slice(0, 8);
    }
  }

  // 2. events → SimulationEvent
  // 感知校验: 事件 target 必须在感知范围(awareEntities)内——未感知的文明不可互动
  const awareIds = new Set(knowledge.awareEntities.map((a) => a.entity));
  for (const e of output.events ?? []) {
    // 防御: LLM 可能输出非字符串 description(对象/缺失), 归一化避免仲裁崩溃
    let desc = "";
    if (typeof e.description === "string") desc = e.description;
    else if (e.description && typeof e.description === "object") desc = JSON.stringify(e.description);
    if (!desc.trim()) continue; // 空描述事件丢弃
    // target 不在感知范围 → 丢弃(编造的未感知互动, 与空间一致性冲突)
    if (e.target && !awareIds.has(e.target)) {
      continue;
    }
    const participants = [entityId];
    if (e.target) participants.push(e.target);
    // 防御: LLM 的 changes 可能不是数组(对象/字符串/数字), 或数组元素是零散描述。
    // 非数组/非对象元素丢弃, 只保留结构化对象——否则仲裁/applyStateChanges 会崩。
    const changes: SimulationEvent["changes"] = [];
    if (Array.isArray(e.changes)) {
      for (const c of e.changes) {
        if (!c || typeof c !== "object" || Array.isArray(c)) continue; // 跳过字符串/数组等
        const o = c as {
          entity?: string; metrics?: Partial<EntityCard["metrics"]>; tech?: Record<string, number>;
          values?: Record<string, number>; stance?: string; hostility?: number;
          absorbed_by?: string; founded?: { name: string; from: string }; collapsed?: boolean;
        };
        changes.push({
          entity: o.entity ?? entityId,
          metrics: o.metrics,
          tech: o.tech,
          values: o.values,
          stance: o.stance,
          hostility: o.hostility,
          absorbed_by: o.absorbed_by,
          founded: o.founded,
          collapsed: o.collapsed,
        });
      }
    }
    events.push({
      id: `agent-${tick}-${entityId}-${events.length}`,
      tick,
      time_label: `tick ${tick}`,
      type: e.type,
      participants,
      region: entity.geography.region,
      description: desc,
      changes,
      major: e.major,
      random: false,
      source: "agent",
    });
  }

  // 3. metric_delta / tech_delta / values_delta → 暂存, 由调度器在物理基线之上 clamp 应用
  //   （不直接写实体: 否则被 physics 每 tick 全量覆盖, LLM 决策丢失）。
  //   tech_delta 键只允许当前已存在的维度——这是维度膨胀(矮人 150+ 键)的直接防线;
  //   新发明写进事件叙事, 确需新轴走 propose_dim(复现≥2 次才注册)。
  const existingTech = new Set(Object.keys(entity.tech));
  const techDelta: Record<string, number> = {};
  for (const [k, v] of Object.entries(output.tech_delta ?? {})) {
    if (existingTech.has(k) && typeof v === "number") techDelta[k] = v;
  }
  const delta: AgentDelta = {
    metric_delta: output.metric_delta && Object.keys(output.metric_delta).length > 0 ? output.metric_delta : undefined,
    tech_delta: Object.keys(techDelta).length > 0 ? techDelta : undefined,
    values_delta: output.values_delta && Object.keys(output.values_delta).length > 0 ? output.values_delta : undefined,
    territory_claims: output.territory_claim?.length ? output.territory_claim : undefined,
    propose_dims: output.propose_dim?.length ? output.propose_dim : undefined,
  };

  // 3.5 政体演化决策（§: 物理层信号 → agent 决定形态, 涌现）
  if (output.regime_evolution && entity.regime) {
    const re = output.regime_evolution;
    if (re.new_form) {
      entity.identity.political_form = re.new_form as EntityCard["identity"]["political_form"];
      entity.internal.recent_events = [`政体演化: ${entity.name} 演化为 ${re.new_form}`, ...entity.internal.recent_events].slice(0, 5);
    }
    if (typeof re.centralization_delta === "number") {
      entity.regime.centralization = clampNum(entity.regime.centralization + re.centralization_delta, 0, 100);
    }
    entity.regime.evolve_signal = false; // 已决策, 清除信号
    events.push({
      id: `evolve-${tick}-${entityId}`,
      tick,
      time_label: `tick ${tick}`,
      type: "reform",
      participants: [entityId],
      region: entity.geography.region,
      description: `${entity.name} 的治理形态发生了演化${re.new_form ? `，成为${re.new_form}` : ""}。${re.reason ?? ""}`,
      changes: [{ entity: entityId }],
      random: false,
      source: "agent",
    });
  }

  // 4. notes → 未决议题更新
  if (output.notes) {
    entity.internal.active_issues = [output.notes, ...entity.internal.active_issues].slice(0, 5);
  }

  // 5. suggest_years_per_tick → 更新时间粒度(软约束: agent 结合世界判断, 校验合理性)
  if (typeof output.suggest_years_per_tick === "number") {
    const suggested = output.suggest_years_per_tick;
    const cur = session.config.yearsPerTick ?? 10;
    // 合理校验: 正整数 + 突变不超过 10 倍(防离谱建议)
    if (Number.isFinite(suggested) && suggested >= 1 && suggested <= 10000
      && (cur === 0 || suggested <= cur * 10) && (cur === 0 || suggested * 10 >= cur)) {
      session.config.yearsPerTick = Math.round(suggested);
      entity.internal.recent_events = [`时间粒度调整为每 tick ${session.config.yearsPerTick} 年`, ...entity.internal.recent_events].slice(0, 5);
    }
  }

  entity.last_tick = tick;
  entity.updated_at = tick;
  return { events, delta, entityIds: [entityId] };
}

// ── 多 agent 并行调度 ────────────────────────────────

/**
 * 并行调度所有活跃实体 agent（§5.2）。
 * 每个 agent 独立推演一轮，产出汇总后由调用方过仲裁。
 * 长尾聚合（§5.4）：active_level=longtail 的稳定微邦不逐个开 agent，
 * 而是合并为"区域层"簇，由单个 agent 批量处理（只汇报结构性变化）。
 */
export type AgentRunResult = {
  events: SimulationEvent[];
  deltas: Map<string, AgentDelta>;
};

export async function runAllAgents(
  session: SimulationSession,
  agentConfig: AgentConfig,
): Promise<AgentRunResult> {
  const active = Object.values(session.entities).filter((e) => e.status === "active");
  const hotspotOrRegular = active.filter((e) => e.active_level !== "longtail");
  const longtail = active.filter((e) => e.active_level === "longtail");

  // 长尾聚合：同区域微邦合并为一簇, 单个 agent 批量处理（§5.4）
  const longtailByRegion = new Map<string, typeof longtail>();
  for (const e of longtail) {
    const region = e.geography.region;
    if (!longtailByRegion.has(region)) longtailByRegion.set(region, []);
    longtailByRegion.get(region)!.push(e);
  }

  const tasks: Promise<{ events: SimulationEvent[]; delta: AgentDelta | null; entityIds: string[] }>[] = [];
  // hotspot/regular：逐个独立推演
  tasks.push(...hotspotOrRegular.map((e) => runEntityAgent(session, e.id, agentConfig)));
  // longtail：每簇一个区域层 agent
  for (const [region, cluster] of longtailByRegion) {
    tasks.push(runClusterAgent(session, region, cluster, agentConfig));
  }

  const results = await Promise.all(tasks);
  const events: SimulationEvent[] = [];
  const deltas = new Map<string, AgentDelta>();
  for (const r of results) {
    events.push(...r.events);
    // longtail cluster agent 的 delta 落到簇内每个实体（集群级决策共享）
    if (r.delta) {
      for (const id of r.entityIds) deltas.set(id, r.delta);
    }
  }
  return { events, deltas };
}

/**
 * 长尾聚合的区域层 agent（§5.4）：
 * 一簇稳定微邦由一个 agent 批量处理，只汇报结构性变化（谁灭了谁、谁并入谁）。
 * 相比逐个推演大幅省 token（0.2x）。
 */
async function runClusterAgent(
  session: SimulationSession,
  region: string,
  cluster: EntityCard[],
  agentConfig: AgentConfig,
): Promise<{ events: SimulationEvent[]; delta: AgentDelta | null; entityIds: string[] }> {
  const tick = session.current_tick;
  const clusterSummary = cluster
    .map((e) => `${e.name}(人口${e.metrics.population})`)
    .join("、");

  const system = [
    `你是 ${region} 区域的历史推演器，负责一批稳定微邦/部落的批量推演（§5.4 长尾聚合）。`,
    `世界法则: ${session.laws.rules.join("；")}`,
    `只汇报结构性变化（谁灭了谁、谁并入谁、重大迁移/技术突破），日常事务不报。`,
    `输出格式契约：严格 JSON（events 数组, 每项 {type, description}）。无变化输出 {"events": []}。`,
  ].join("\n");

  const user = [
    `# 本区域稳定微邦（${cluster.length} 个）`,
    clusterSummary,
    ``,
    `# 全球事件（延迟 ${session.config.infoDelay} tick）`,
    ...session.events.slice(-5).map((e) => `- [${e.type}] ${e.description}`),
  ].join("\n");

  const response = await safeCall(agentConfig.llm, { systemPrompt: system, userMessage: user, maxTokens: 512, json: true });
  if (!response) return { events: [], delta: null, entityIds: [] };

  let output: { events: Array<{ type: SimulationEvent["type"]; description: string }> };
  try {
    output = parseJSONFromLLM(response);
  } catch {
    return { events: [], delta: null, entityIds: [] };
  }

  const events: SimulationEvent[] = [];
  for (const e of output.events ?? []) {
    events.push({
      id: `cluster-${tick}-${region}-${events.length}`,
      tick,
      time_label: `tick ${tick}`,
      type: e.type,
      participants: cluster.map((c) => c.id),
      region,
      description: `[区域层] ${e.description}`,
      changes: [],
      random: false,
      source: "agent",
    });
  }
  return { events, delta: null, entityIds: cluster.map((c) => c.id) };
}

// ── 全局仲裁 agent（§5.3）────────────────────────────

export type GlobalArbiterResult = {
  /** 裁决结果：{event_id, winner, note}[] */
  rulings: { eventId: string; winner: string; note: string }[];
};

/**
 * 全局仲裁 agent：一次性 LLM 裁决多个冲突（比逐对便宜, §5.3）。
 * 输入冲突对，输出裁决。
 */
export async function runGlobalArbiter(
  session: SimulationSession,
  conflicts: Array<{ eventA: SimulationEvent; eventB: SimulationEvent }>,
  llm: LLMBindings,
): Promise<GlobalArbiterResult> {
  if (conflicts.length === 0) return { rulings: [] };

  const conflictText = conflicts.map((c, i) =>
    `[${i}] 事件A: ${c.eventA.description} (参与: ${c.eventA.participants.join(",")})\n事件B: ${c.eventB.description} (参与: ${c.eventB.participants.join(",")})`,
  ).join("\n\n");

  const systemPrompt = [
    "你是历史推演的全局仲裁者。",
    "以下列出冲突的事件对（同一对象的不同说法）。",
    `世界法则: ${session.laws.rules.join("；")}`,
    "裁决原则：数值模型优先（军力差决定战争结局）→ 其次历史惯性 → 最后合理性。",
    "输出严格 JSON 数组，每个元素: {\"index\": 冲突索引, \"winner\": \"A\" 或 \"B\", \"note\": \"一句话理由\"}",
  ].join("\n");

  const response = await safeCall(llm, { systemPrompt, userMessage: conflictText, maxTokens: 1024, json: true });
  if (!response) return { rulings: [] };

  try {
    const parsed = parseJSONFromLLM<Array<{ index: number; winner: string; note: string }>>(response);
    const rulings = parsed.map((r) => {
      const conflict = conflicts[r.index];
      if (!conflict) return { eventId: "", winner: "", note: "" };
      const eventId = r.winner === "B" ? conflict.eventB.id : conflict.eventA.id;
      return { eventId, winner: r.winner, note: r.note ?? "" };
    }).filter((r) => r.eventId);
    return { rulings };
  } catch {
    return { rulings: [] };
  }
}

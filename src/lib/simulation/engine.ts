/**
 * 推演调度器 (§5) — 顶层编排：每 tick 推进所有实体。
 *
 * Phase 0：确定性数值引擎（无 LLM、无 agent）。
 * 每个 tick：
 *   1. 对每个实体跑物理层数值引擎（tickPhysics）
 *   2. 应用指标/维度变化
 *   3. 稀有事件判定（LLM 综合世界状态生成 / 程序化 fallback）
 *   4. 维度注册表同步 + 生命周期
 *   5. 细化即锁定 / 历史即锁定（事件入背景规则库）
 *   6. 写事件日志（追加不可改写）
 *
 * 纯前端 lib，不依赖 Tauri。可单测。
 */

import { createRng, type Rng } from "./random.ts";
import {
  generateBlackSwan,
  generateRareEvent,
  makeBlackSwanContext,
  type BlackSwanCandidate,
} from "./black-swan.ts";
import { tickPhysics, deriveRegionResources, deriveTechPotential, populationCapacity, developmentLevel, type PhysicsResult } from "./physics.ts";
import { syncTechDimensions, emptyRegistry, retireInactiveDimensions, promoteDimension, demoteDimension, freezeDimension, techDims, valueDims, tryRegisterDimension } from "./registry.ts";
import { emptyLore, lockHistoricalEvent, refinePast } from "./lore.ts";
import { arbitrate } from "./arbiter.ts";
import { backfillCausals } from "./causality.ts";
import { conquerEntity, splitEntity, collapseEntity, reviveEntity, divergeEntity, type ArchiveEntry } from "./entity-pool.ts";
import { maybeSubdivideRegions, createNamedSubregion } from "./subdivision.ts";
import { adjudicateDecree, decreeToEvent, naturalizeDecree } from "./decree.ts";
import { runAllAgents, type AgentConfig, type AgentDelta } from "./agent.ts";
import { safeCall, parseJSONFromLLM, type LLMBindings } from "./llm.ts";
import { addTerritory } from "./geography.ts";
import { nameForEntity, createCulture, evolveLanguageBorrowing, divergeLanguage, generateWorldLanguages } from "./culture.ts";
import { deriveRegionScales, deriveHierarchyScales, deriveRegionEnvironment, evolveEcology } from "./measure.ts";
import { computeActiveScore, classifyAttention } from "./context.ts";
import { derivePoliticalForm } from "./regime.ts";
import { buildGeography } from "./geography.ts";
import type {
  CanonicalLore,
  Culture,
  DimensionRegistry,
  EntityCard,
  GeographyUnit,
  LanguageSystem,
  SimulationConfig,
  SimulationEvent,
  SimulationResult,
  SimulationSession,
  SpaceRegion,
  WorldLaws,
} from "./types.ts";

// ── 默认配置 ──────────────────────────────────────────

export function defaultConfig(seed = 42): SimulationConfig {
  return {
    randomness: 0.3,
    surprise: 0.3,
    rigor: 0.7,
    granularity: "macro",
    yearsPerTick: 10,
    autoJump: true,
    maxTicks: 100,
    budget: { perTickGlobal: 100_000, perEntity: 4_000, hotspotMultiplier: 4 },
    infoDelay: 2,
    maxEntities: null,
    seed,
  };
}

export function defaultRegions(): Record<string, SpaceRegion> {
  // 一个大陆的物理布局（生物群系网格, 区域名由文化语言命名填充, 此处仅 biome 描述）
  const defs: Omit<SpaceRegion, "resources" | "neighbors" | "layer" | "refined">[] = [
    { id: "coast-east", name: "沿海地带", biome: "coast" },
    { id: "plains-mid", name: "平原腹地", biome: "plains" },
    { id: "mountains-north", name: "山地", biome: "mountains" },
    { id: "desert-south", name: "沙漠", biome: "desert" },
    { id: "steppe-west", name: "草原", biome: "steppe" },
    { id: "forest-valley", name: "林地", biome: "forest" },
  ];
  const regions: Record<string, SpaceRegion> = {};
  for (const d of defs) {
    regions[d.id] = { ...d, resources: deriveRegionResources(d.biome, EARTH_DEFAULT), neighbors: [], layer: 0, refined: false };
  }
  // 邻接（简单拓扑）
  const adjacency: Record<string, string[]> = {
    "coast-east": ["plains-mid", "forest-valley"],
    "plains-mid": ["coast-east", "mountains-north", "forest-valley", "steppe-west"],
    "mountains-north": ["plains-mid", "steppe-west"],
    "desert-south": ["steppe-west", "forest-valley"],
    "steppe-west": ["plains-mid", "mountains-north", "desert-south"],
    "forest-valley": ["coast-east", "plains-mid", "desert-south"],
  };
  for (const [id, nbrs] of Object.entries(adjacency)) {
    regions[id].neighbors = nbrs;
  }
  return regions;
}

// 占位：默认区域资源推导用的法则（真实世界）。实际由 session 的 laws 决定。
import { EARTH_LAWS as EARTH_DEFAULT } from "./physics.ts";

// ── 实体辅助 ──────────────────────────────────────────

export function makeEntity(
  id: string,
  name: string,
  regionId: string,
  species: string,
  politicalForm: EntityCard["identity"]["political_form"],
  metrics: Partial<EntityCard["metrics"]>,
  tech: Record<string, number>,
  values: Record<string, number>,
  /** 文化 id（绑定语言系统, 命名与文化强相关） */
  cultureId?: string,
  /** 首都名（调用方用文化语言生成; 默认兜底） */
  capital?: string,
): EntityCard {
  return {
    id,
    name,
    kind: "entity",
    status: "active",
    metrics: {
      population: 100_000,
      food: 0,
      economy: 0,
      military: 500,
      legitimacy: 60,
      stability: 60,
      ...metrics,
    },
    tech,
    values,
    identity: {
      species,
      ethnicity: cultureId ?? species,
      culture: cultureId ?? `${name}文化`,
      political_form: politicalForm,
      ideology: "传统",
      origin_story: `${name}起源于${regionId}`,
    },
    geography: { region: regionId, neighbors: [], capital: capital ?? `${name}城` },
    territory: [regionId],   // 初始领土 = 核心区域
    relations: [],
    internal: { recent_events: [], active_issues: [] },
    // 政体轻结构化初始（物理层将驱动演化）
    regime: {
      organizational_complexity: 10,
      centralization: 20,
      economic_base: 0,
      evolve_signal: false,
    },
    active_level: "regular",
    last_tick: 0,
    created_at: 0,
    updated_at: 0,
  };
}

// ── 会话初始化 ────────────────────────────────────────

export function createSession(opts: {
  laws: WorldLaws;
  regions?: Record<string, SpaceRegion>;
  entities?: EntityCard[];
  config?: SimulationConfig;
  worldId?: string;
  /** 文化-语言系统（默认从世界初始实体生成, 不预设地球语言） */
  languages?: Record<string, LanguageSystem>;
  cultures?: Record<string, Culture>;
  /** 初始自然实体（山脉/河流/湖泊/海洋等, §4.0② 独立地理地图） */
  features?: GeographyUnit[];
}): SimulationSession {
  const config = opts.config ?? defaultConfig();
  const regions = opts.regions ?? buildRegionsFor(opts.laws);
  // 语言从世界初始状态生成（§: 不预设地球语言, 从物种/地理/文化涌现）
  // 若调用方显式提供则用之（全景初始化定义的语言）
  let languages = opts.languages;
  let cultures = opts.cultures;
  if (!languages && (opts.entities?.length ?? 0) > 0) {
    const generated = generateWorldLanguages({
      seed: config.seed,
      entities: opts.entities!.map((e) => ({
        species: e.identity.species,
        regionBiome: regions[e.geography.region]?.biome,
        cultureName: e.identity.ethnicity || e.identity.species,
      })),
    });
    languages = generated.languages;
    cultures = generated.cultures;
  }
  languages = languages ?? {};
  cultures = cultures ?? {};
  // 派生区域尺寸与环境（§: 空间尺度确定 + 环境三层初始确定）
  // 若调用方未提供尺寸/环境（默认区域布局）, 从大陆尺度派生
  let finalRegions = regions;
  if (Object.values(regions).some((r) => !r.dimensions)) {
    // 大陆尺度从 measurement_system.worldScale 读（§4.0② 用户世界尺度生效）, 缺省用类地球大陆
    const ws = opts.laws.measurement_system?.worldScale;
    const continentKm = ws && ws.width > 0 && ws.height > 0
      ? { width: ws.width, height: ws.height }
      : { width: 3000, height: 2500 };
    // 文明所在地 = 有初始实体的区域（分层 LOD: 这些细, 其余次大陆级概略）
    const knownRegionIds = [...new Set((opts.entities ?? []).map((e) => e.geography.region).filter(Boolean))];
    // 有层级(parent) → 用层级尺度(父内细分, 每个区域有面积); 否则原平铺
    const hasHierarchy = Object.values(regions).some((r) => r.parent);
    finalRegions = hasHierarchy
      ? deriveHierarchyScales(opts.laws, regions, continentKm)
      : deriveRegionScales(opts.laws, regions, { continentKm, knownRegionIds });
    for (const [id, r] of Object.entries(finalRegions)) {
      // 文明所在地(layer≥1)补完整环境; 次大陆级概略区(layer 0)保持概略, 靠 scale.ts 兜底
      if (!r.environment && r.layer >= 1) {
        finalRegions[id] = { ...r, environment: deriveRegionEnvironment(r) };
      }
    }
  }
  const session: SimulationSession = {
    id: `sim-${config.seed}`,
    world_id: opts.worldId ?? "default",
    current_tick: 0,
    laws: opts.laws,
    regions: finalRegions,
    geography: buildGeography(finalRegions, opts.features ?? []),
    entities: {},
    registry: emptyRegistry(),
    languages,
    cultures,
    lore: emptyLore(),
    config,
    events: [],
    decrees: [],
    archive: [],
    started_at: 0,
  };
  // §12 维度冻结生效: 从 config 应用冻结维度（防维度涌现失控）
  for (const dim of config.frozenDims ?? []) {
    freezeDimension(session.registry, dim);
  }
  // 初始全景写入背景规则库（顶层确定事实）
  for (const r of Object.values(regions)) {
    addInitialRegionFact(session.lore, r);
  }
  // 初始化实体（保留调用方传入的 neighbors——实体邻接基于实体 id, 由调用方/推演维护）
  for (const e of opts.entities ?? []) {
    // 若实体指定了文化绑定, 但 culture 未注册 → 自动绑定到该种族的生成语言（命名与文化强相关）
    const ethnicity = e.identity.ethnicity || e.identity.species;
    if (ethnicity && !session.cultures[ethnicity]) {
      // 找到该种族对应的语言（generateWorldLanguages 生成的, 名称含种族）
      const lang = Object.values(languages).find((l) => l.name.includes(e.identity.species))
        ?? Object.values(languages)[0];
      session.cultures[ethnicity] = createCulture(ethnicity, ethnicity, lang?.id ?? "");
    }
    session.entities[e.id] = {
      ...e,
      identity: { ...e.identity, ethnicity, culture: session.cultures[ethnicity]?.name ?? e.identity.culture },
      geography: { ...e.geography, region: e.geography.region, neighbors: e.geography.neighbors ?? [] },
      territory: e.territory ?? [e.geography.region],   // 领土缺省 = 核心区域
      relations: e.relations ?? [],
    };
  }
  // 初始同步维度注册表
  for (const e of Object.values(session.entities)) {
    const region = regions[e.geography.region];
    if (region) syncTechDimensions(session.registry, deriveRegionResources(region.biome, opts.laws), 0);
  }
  return session;
}

function buildRegionsFor(laws: WorldLaws): Record<string, SpaceRegion> {
  const base = defaultRegions();
  // 用真实法则重新推导（默认区域用了 EARTH_DEFAULT 占位，这里换成传入法则）
  for (const [id, r] of Object.entries(base)) {
    base[id] = { ...r, resources: deriveRegionResources(r.biome, laws) };
  }
  return base;
}

function addInitialRegionFact(lore: CanonicalLore, region: SpaceRegion): void {
  // 初始全景 = 顶层背景规则（layer 0）
  lore.facts.push({
    id: `lore-initial-${region.id}`,
    axis: "space",
    layer: 0,
    scope: region.id,
    content: `${region.name}（${region.biome}），存在于此世界`,
    source: "initial",
    locked_tick: 0,
    notes: "初始全景",
  });
  if (lore.max_layer < 0) lore.max_layer = 0;
}

// ── 推演主循环 ────────────────────────────────────────

export type RunOptions = {
  /** 多 agent 推演配置（§5.2）。提供则每 tick 先跑 LLM agent 产出事件 */
  agentConfig?: AgentConfig;
  /** LLM 语义判定（§5.3/§5.5）：全局仲裁、细化合理性、干预判定 */
  llm?: LLMBindings;
};

/**
 * 推进 N 个 tick。
 * 返回每个 tick 后的事件（追加到 session.events）与更新后的会话。
 * 幂等性：传入的 session 会被原地推进（调用方持有引用）。
 * 每 tick 末尾过仲裁器（§5.3）：只有 accepted 事件进历史锁定。
 * 提供 options.agentConfig 时，每 tick 先跑多 agent 并行推演（§5.2），产出并入仲裁。
 */
export async function runTicks(
  session: SimulationSession,
  ticks: number,
  options: RunOptions = {},
): Promise<SimulationResult> {
  const rng = createRng(session.config.seed + session.current_tick);
  const trace: SimulationResult["population_trace"] = [];

  for (let i = 0; i < ticks; i++) {
    session.current_tick += 1;
    const tick = session.current_tick;
    const tickEvents: SimulationEvent[] = [];

    // 1. 多 agent 并行推演（§5.2，可选）：LLM agent 产出事件 + 暂存 delta（不改实体数值,
    //    避免被物理层全量覆盖——agent 决策在物理基线之上 clamp 生效）
    let agentDeltas = new Map<string, AgentDelta>();
    if (options.agentConfig) {
      const agentRun = await runAllAgents(session, options.agentConfig);
      tickEvents.push(...agentRun.events);
      agentDeltas = agentRun.deltas;
    }

    // 1. 每个实体跑物理层（物理基线）→ agent delta 之上 clamp 应用 → 稀有事件
    for (const entity of Object.values(session.entities)) {
      if (entity.status !== "active") continue;
      const region = session.regions[entity.geography.region];
      if (!region) continue;

      const result = tickPhysics(entity, region, session.laws);
      const spawned = applyPhysicsResult(entity, result, session, tick, rng);
      // agent 决策（人口/粮食/科技/领土/新轴）在物理基线之上真实生效
      const agentDelta = agentDeltas.get(entity.id);
      if (agentDelta) {
        // 事件 changes[].metrics/tech/values 与顶层 delta 合并去重（顶层优先）, 避免同量 double-count
        const merged = mergeClaimedChangesIntoDelta(entity, agentDelta, tickEvents);
        applyAgentDelta(session, entity, merged, result, tick);
      }
      // 记录本 tick 结束时的核心指标快照（环形缓冲, 供"近期走势"注入）
      pushMetricSnapshot(entity, tick);
      // 物理引擎触发的结构性事件
      for (const te of result.triggeredEvents) {
        tickEvents.push({
          id: `evt-${tick}-${entity.id}-${tickEvents.length}`,
          tick,
          time_label: timeLabel(session, tick),
          type: te.type as SimulationEvent["type"],
          participants: [entity.id],
          region: entity.geography.region,
          description: te.description,
          changes: [],
          random: true,
          source: "engine",
        });
      }
      tickEvents.push(...spawned);
    }

    // 1.2 稀有事件（§7 收口）: 不再用概率阈值"拍板"该不该发生——**每 tick 对每个活跃实体
    // 询问 LLM 综合世界状态判断**: 这几十年内有无值得记载的独特事件(黑天鹅/天才/异象/变迁)。
    // LLM 输出 null/无事件 = 平静年代, 由 LLM 判断而非引擎概率。无真实 LLM 才回退程序化生成。
    for (const pick of Object.values(session.entities)) {
      if (pick.status !== "active") continue;
      const region = session.regions[pick.geography.region];
      if (!region) continue;
      let swan: BlackSwanCandidate | null = null;
      if (options.llm?.real) {
        // 真实 LLM: 综合判断"这数十年有无值得记载之事"。LLM 输出 null/平静 → 无事件,
        // **不**回退程序化(否则会淹没 LLM 的"平静年代"判断)。
        swan = await generateRareEvent({ session, entity: pick, region, tick }, options.llm);
      } else if (options.llm) {
        // 无真实 LLM(mock/未配) → 程序化组合 fallback
        swan = generateBlackSwan(makeBlackSwanContext({
          laws: session.laws,
          entity: pick,
          region,
          config: session.config,
          rng,
          tick,
          techDims: techDims(session.registry),
          valueDims: valueDims(session.registry),
          populationPressure: populationPressureOf(pick, region),
          foodDeficit: pick.metrics.food < 0,
        }));
      }
      if (swan) {
        applyRareEventEffect(session, pick, region, swan, tick);
        tickEvents.push({
          id: `evt-bs-${tick}-${pick.id}`,
          tick,
          time_label: timeLabel(session, tick),
          type: swan.type ?? "other",
          participants: [pick.id],
          region: pick.geography.region,
          description: swan.description,
          changes: swan.dim
            ? [{ entity: pick.id, tech: { [swan.dim]: swan.dimDelta ?? 0 } }]
            : [],
          random: true,
          source: "engine",
        });
      }
    }

    // 1.5 例行推演事件（时间推进的锚点, 防空 tick）
    const mainEvent = buildRoutineEvent(session, tick);
    tickEvents.push(mainEvent);

    // 1.6 区域多实体自动细分（改动 C）: 每 SUBDIVISION_INTERVAL tick, 区域 2+ 实体 → LLM 判定细分
    const subdivEvents = await maybeSubdivideRegions(session, tick, options.llm);
    tickEvents.push(...subdivEvents);

    // 1.75 用户干预判定（§5.5）：处理 target_tick = 当前 tick 且未判定的指令
    const pendingDecrees = session.decrees.filter((d) => d.target_tick <= tick && !d.verdict);
    for (const decree of pendingDecrees) {
      const adjudication = await adjudicateDecree({
        laws: session.laws,
        lore: session.lore,
        entities: session.entities,
        events: session.events,
        currentTick: tick,
        llm: options.llm ? {
          assess: async (decree, context) => {
            const text = await safeCall(options.llm!, {
              systemPrompt: "你是历史推演的干预判定者。评估用户的指令是否违反世界法则、是否与历史惯性相容。输出严格 JSON: {verdict: accepted|adjusted|twisted|rejected, note: 一句话理由}",
              userMessage: `指令: ${decree.intent}\n${context}`,
              json: true,
            });
            if (!text) return { verdict: "adjusted", note: "LLM 判定失败, 默认打折" };
            try {
              return parseJSONFromLLM(text);
            } catch {
              return { verdict: "adjusted", note: "LLM 判定不可解析, 默认打折" };
            }
          },
        } : undefined,
      }, decree);
      // 回填判定结果
      decree.verdict = adjudication.verdict;
      decree.verdict_note = adjudication.note;
      decree.effective_tick = tick;
      // 生效的指令（accepted/adjusted/twisted）自然化为事件注入（rejected 也记录为天意被阻）
      tickEvents.push(decreeToEvent(decree, adjudication, tick));
      // §5.5 面向过去细化: accepted 的 past 指令写入背景规则库（细化即锁定）
      if (decree.direction === "past" && (decree.verdict === "accepted" || decree.verdict === "adjusted")) {
        const refineResult = refinePast(
          session.lore,
          decree.target_tick,
          tick,
          `过去纪元-${decree.target_tick}`,
          decree.intent,
          "用户干预细化过去",
        );
        if (refineResult.verdict === "accepted") {
          session.lore.facts.push(refineResult.fact!);
        }
      }
    }

    // 2. 维度注册表生命周期（§4.2）——register/retire 生成事件, 时代轨迹在事件日志中可见
    const retiredDims = retireInactiveDimensions(session.registry, tick);
    if (retiredDims.length > 0) {
      tickEvents.push({
        id: `dim-retire-${tick}`,
        tick, time_label: timeLabel(session, tick),
        type: "cultural",
        participants: [], region: "",
        description: `发展轴「${retiredDims.join("、")}」逐渐淡出历史（维度消退, §4.2）`,
        changes: [], random: false, source: "engine",
      });
    }
    const registryEvents = session.registry.history.filter((h) => h.tick === tick && h.action === "register");
    if (registryEvents.length > 0) {
      tickEvents.push({
        id: `dim-register-${tick}`,
        tick, time_label: timeLabel(session, tick),
        type: "tech",
        participants: [], region: "",
        description: `新的发展轴「${registryEvents.map((h) => h.dim).join("、")}」浮现于历史（维度升格, §4.2）`,
        changes: [], random: false, source: "engine",
      });
    }

    // 3. 片尾仲裁（§5.3）：所有事件过自洽检查, 只锁定 accepted
    // 接入 LLM 语义判定（§5.3 全局仲裁 agent / 细化合理性）——提供 llm 时生效
    const arbResult = await arbitrate({
      laws: session.laws,
      config: session.config,
      entities: session.entities,
      lore: session.lore,
      currentTick: tick,
      llm: options.llm ? {
        resolveConflict: async (a, b) => {
          const text = await safeCall(options.llm!, {
            systemPrompt: "你是历史推演的冲突仲裁者。裁决两个冲突事件（同一对象的不同说法）。考虑军力、世界法则、历史惯性。输出严格 JSON: {winner: 事件A 或 事件B 的参与者名, note: 一句话理由}",
            userMessage: `事件A: ${a.description} (参与: ${a.participants.join(",")})\n事件B: ${b.description} (参与: ${b.participants.join(",")})`,
            json: true,
          });
          if (!text) return undefined;
          try {
            const r = parseJSONFromLLM<{ winner: string; note?: string }>(text);
            return { winner: r.winner, loser: r.winner === a.participants[0] ? (b.participants[0] ?? "") : (a.participants[0] ?? "") };
          } catch {
            return undefined;
          }
        },
        validateRefinement: async (content, laws) => {
          const text = await safeCall(options.llm!, {
            systemPrompt: `你是历史推演的世界法则校验者。判断这段细化描述是否违反世界法则。输出严格 JSON: {valid: boolean, note: string}\n世界法则: ${laws.rules.join("；")}`,
            userMessage: content,
            json: true,
          });
          if (!text) return true; // LLM 失败 → 通过（宽松）
          try {
            return parseJSONFromLLM<{ valid: boolean }>(text).valid;
          } catch {
            return true;
          }
        },
      } : undefined,
    }, tickEvents);

    // 3.5 因果链回填：accepted 事件补 causals(只引用已锁定的旧事件, 不引同批)
    backfillCausals(session, arbResult.accepted);

    // 4. 历史锁定：accepted 事件写入背景规则库（时间向, 不可改写）
    for (const ev of arbResult.accepted) {
      lockHistoricalEvent(session.lore, ev);
      session.events.push(ev);
    }
    // §5.3 受阻记录写入事件流（保持历史连续: 被否决的事件以"受阻"标记可见）
    for (const ev of arbResult.blocked) {
      session.events.push(ev);
    }
    // 细化的区域细节写入背景规则库（空间向, 细化即锁定）。
    // 注意: 不再自动生成 "X:sub-{tick}" 无名子区划（曾造出 213 个「·细化」垃圾节点并把事件文本
    // 塞进 terrain）。真实有名字的子区划由 LLM 领土扩张(territory_claim)创建。
    for (const r of arbResult.refinements) {
      session.lore.facts.push({
        id: `lore-refine-${tick}-${r.scope}-${r.layer}`,
        axis: "space",
        layer: r.layer,
        scope: r.scope,
        content: r.content,
        source: "refinement",
        locked_tick: tick,
        notes: "仲裁细化入库",
      });
      if (r.layer > session.lore.max_layer) session.lore.max_layer = r.layer;
    }

    // 5. 动态 agent 池更新（§5.4）：处理状态变化事件
    applyStateChanges(session, arbResult.accepted, tick, rng);

    // 5.5 复兴触发（§5.4, 进阶）：后世 agent 有概率发现 archive 文明遗迹 → 触发复兴
    maybeRevive(session, tick, rng, tickEvents);

    trace.push({
      tick,
      entities: Object.values(session.entities).filter((e) => e.status === "active").length,
      events: arbResult.accepted.length,
    });
  }

  return { session, ticks_run: ticks, population_trace: trace };
}

function applyPhysicsResult(
  entity: EntityCard,
  result: PhysicsResult,
  session: SimulationSession,
  tick: number,
  rng: Rng,
): SimulationEvent[] {
  const spawnedEvents: SimulationEvent[] = [];
  // 指标更新
  entity.metrics = result.metrics;

  // 技术维度：应用收敛增量（实际值向该区域潜力收敛, clamp 到区域潜力）
  for (const [dim, delta] of Object.entries(result.techDelta ?? {})) {
    const cap = result.techPotential[dim] ?? 100;
    entity.tech[dim] = clampNum((entity.tech[dim] ?? 0) + delta, 0, cap);
  }
  // 同步注册表（确保维度存在 + 权重/活跃度更新; 潜力是区域属性不在此存单一值）
  syncTechDimensions(session.registry, result.techPotential, tick);

  // 理念漂移
  for (const [dim, delta] of Object.entries(result.valuesDelta ?? {})) {
    entity.values[dim] = clampNum((entity.values[dim] ?? 50) + delta);
  }

  // §3.5/§4.2 promote/demote 生效: 维度大幅增长 → promote（时代主题强化）;
  // 长期停滞的维度由 retireInactiveDimensions 处理, 此处仅当增量显著时 promote
  for (const [dim, delta] of Object.entries(result.techDelta ?? {})) {
    if (delta > 0.5) {
      promoteDimension(session.registry, dim, 0.05, tick, `tech surge (+${delta.toFixed(1)}) by ${entity.name}`);
    }
  }

  // 政体信号应用（主干链: 经济 → 组织复杂度 → 演化信号）
  const rd = result.regimeDelta;
  entity.regime.organizational_complexity = rd.organizational_complexity;
  entity.regime.centralization = rd.centralization;
  entity.regime.economic_base = rd.economic_base;
  entity.regime.evolve_signal = rd.evolve_signal;
  entity.regime.evolve_reason = rd.evolve_reason;

  // §6 注意力分层生效: 计算活跃度并写回 active_level（此前恒为 regular）
  const activeScore = computeActiveScore(entity, session);
  entity.active_level = classifyAttention(activeScore).level;

  // 生态演化（§: 生态最动态, 被文明改变 + 自然演替）
  const ecoRegion = session.regions[entity.geography.region];
  if (ecoRegion?.environment) {
    const pressure = entity.metrics.population / Math.max(1, ecoRegion.dimensions?.area ?? 1) * (ecoRegion.dimensions ? 1 : 100_000);
    const eco = evolveEcology(ecoRegion.environment, {
      populationPressure: Math.min(1, pressure),
      agricultureTech: entity.tech["农业"] ?? 0,
      longTimescale: tick % 50 === 0, // 每 50 tick 一次长周期气候漂移
    });
    if (Math.abs(eco.vegetation_delta) + Math.abs(eco.arable_delta) + Math.abs(eco.biodiversity_delta) > 0) {
      ecoRegion.environment.ecology.vegetation = clampNum(ecoRegion.environment.ecology.vegetation + eco.vegetation_delta, 0, 100);
      ecoRegion.environment.ecology.arable_land = clampNum(ecoRegion.environment.ecology.arable_land + eco.arable_delta, 0, 100);
      ecoRegion.environment.ecology.biodiversity = clampNum(ecoRegion.environment.ecology.biodiversity + eco.biodiversity_delta, 0, 100);
      ecoRegion.environment.ecology.modified = true;
      spawnedEvents.push({
        id: `eco-${tick}-${entity.id}`,
        tick,
        time_label: timeLabel(session, tick),
        type: "cultural",
        participants: [entity.id],
        region: entity.geography.region,
        description: `${entity.name}的活动改变了 ${ecoRegion.name} 的生态（${eco.description}）`,
        changes: [{ entity: entity.id }],
        random: false,
        source: "engine",
      });
    }
  }
  // 政体演化压力提示: 不自动生成 reform 事件(演化由 agent 判断, agent.ts regime_evolution),
  // 只把"组织复杂度 vs 经济 vs 当前政体"的状态注入 active_issues 供 agent 参考(软约束)。
  // 数据驱动候选形态: 供 agent 决策时参考（§4.1 先算数值, 再让 agent 叙事化细化）
  let candidate = "";
  try {
    candidate = derivePoliticalForm(entity, ecoRegion, session);
  } catch {
    candidate = "";
  }
  // 演化考量只在演化信号实际触发时注入(org 确实在增长), 避免稳定期每 tick 骚扰 agent
  if (rd.evolve_signal) {
    const evolveNote = candidate
      ? `政体演化考量: ${rd.evolve_reason}（数据推导的候选形态: ${candidate}; 你可选择演化、细化或保持现状）`
      : `政体演化考量: ${rd.evolve_reason}`;
    entity.internal.active_issues = [evolveNote, ...entity.internal.active_issues].slice(0, 5);
  }

  entity.last_tick = tick;
  entity.updated_at = tick;
  return spawnedEvents;
}

/** 稀有事件效果应用（clamp 到物理边界）: 维度 delta → 该区域潜力; 指标 delta → 边界 */
function applyRareEventEffect(
  session: SimulationSession,
  entity: EntityCard,
  region: SpaceRegion | undefined,
  swan: BlackSwanCandidate,
  tick: number,
): void {
  if (swan.dim && swan.dim in entity.tech) {
    const cap = region ? (deriveTechPotential(region.resources, session.laws)[swan.dim] ?? 100) : 100;
    entity.tech[swan.dim] = clampNum((entity.tech[swan.dim] ?? 0) + (swan.dimDelta ?? 0), 0, cap);
  }
  if (swan.metric_delta) {
    // 稀有事件的指标扰动近似 clamp: 人口 → [MIN_POP, 承载], food → 小缓冲, 其余 → [0,100]
    for (const [k, v] of Object.entries(swan.metric_delta)) {
      if (typeof v !== "number" || !(k in entity.metrics)) continue;
      const key = k as keyof EntityCard["metrics"];
      let next = entity.metrics[key] + v;
      if (k === "population") {
        const cap = region ? populationCapacity(region.resources, developmentLevel(entity)) : Infinity;
        next = clampNum(next, MIN_POP, cap);
      } else if (k === "food") {
        next = clampNum(next, -entity.metrics.population * 0.3, entity.metrics.population * 3);
      } else if (k === "military") {
        next = Math.max(0, next);
      } else {
        next = clampNum(next, 0, 100);
      }
      entity.metrics[key] = Math.round(next * 10) / 10;
    }
  }
  entity.internal.recent_events = [swan.description, ...entity.internal.recent_events].slice(0, 5);
}

/** 人口相对区域承载的压力（供黑天鹅生成参考）——用复合承载（随发展水平上升） */
function populationPressureOf(entity: EntityCard, region: SpaceRegion): number {
  const cap = populationCapacity(region.resources, developmentLevel(entity));
  return entity.metrics.population / Math.max(cap, 1);
}

/** 记录本 tick 结束时的核心指标快照（环形缓冲, cap 20, 时间升序）。
 * 供 buildAgentInput/稀有事件注入"近期走势"。满则 shift 丢弃最旧。 */
function pushMetricSnapshot(entity: EntityCard, tick: number, max = 20): void {
  const history = entity.history ?? [];
  history.push({ tick, metrics: { ...entity.metrics } });
  if (history.length > max) history.shift();
  entity.history = history;
}

// ── agent 决策在物理基线之上 clamp 生效（§4.1 先算基线, LLM 决策真实生效）────

/** 把指标 delta clamp 到物理边界（人口→[MIN_POP, populationCap]; 军力→[0,∞] 原始计数; 其余→[0,100]） */
function applyMetricDelta(
  entity: EntityCard,
  metricDelta: Partial<EntityCard["metrics"]>,
  result: PhysicsResult,
): void {
  for (const [k, v] of Object.entries(metricDelta)) {
    if (typeof v !== "number" || !(k in entity.metrics)) continue;
    const key = k as keyof EntityCard["metrics"];
    let next = entity.metrics[key] + v;
    if (k === "population") {
      next = clampNum(next, MIN_POP, result.populationCap);
    } else if (k === "food") {
      next = clampNum(next, -result.foodCap, result.foodCap);
    } else if (k === "military") {
      next = Math.max(0, next); // 军力是原始计数, 不作 0-100 限制
    } else {
      next = clampNum(next, 0, 100);
    }
    entity.metrics[key] = Math.round(next * 10) / 10;
  }
}

/**
 * 把本 tick 该实体的 agent 事件 changes[].metrics/tech/values 并入顶层 delta。
 * 顶层 delta 优先, 同 key 跳过（避免事件与顶层对同一量 double-count）;
 * tech 只并入已存在的维度（与 agent.ts 顶层过滤一致, 防维度膨胀）。
 * 只合并 source==="agent" 的事件——稀有事件(changes 有 metrics)已由 applyRareEventEffect
 * 单独应用, 不在此重复。被仲裁拒绝的事件不会进入本路径（合并发生在 applyAgentDelta,
 * 而拒绝发生在仲裁; 与顶层 metric_delta 同语义）。
 */
function mergeClaimedChangesIntoDelta(
  entity: EntityCard,
  delta: AgentDelta,
  events: SimulationEvent[],
): AgentDelta {
  let out = delta;
  const existingTech = new Set(Object.keys(entity.tech));
  for (const ev of events) {
    if (ev.source !== "agent") continue;
    if (ev.participants[0] !== entity.id) continue;
    for (const c of ev.changes ?? []) {
      if (c.metrics) {
        const merged: Partial<EntityCard["metrics"]> = {};
        for (const [k, v] of Object.entries(c.metrics)) {
          if (typeof v !== "number") continue;
          if (out.metric_delta && k in out.metric_delta) continue;
          (merged as Record<string, number>)[k] = v;
        }
        if (Object.keys(merged).length > 0) {
          out = { ...out, metric_delta: { ...(out.metric_delta ?? {}), ...merged } };
        }
      }
      if (c.tech) {
        const merged: Record<string, number> = {};
        for (const [k, v] of Object.entries(c.tech)) {
          if (typeof v !== "number" || !existingTech.has(k)) continue;
          if (out.tech_delta && k in out.tech_delta) continue;
          merged[k] = v;
        }
        if (Object.keys(merged).length > 0) {
          out = { ...out, tech_delta: { ...(out.tech_delta ?? {}), ...merged } };
        }
      }
      if (c.values) {
        const merged: Record<string, number> = {};
        for (const [k, v] of Object.entries(c.values)) {
          if (typeof v !== "number") continue;
          if (out.values_delta && k in out.values_delta) continue;
          merged[k] = v;
        }
        if (Object.keys(merged).length > 0) {
          out = { ...out, values_delta: { ...(out.values_delta ?? {}), ...merged } };
        }
      }
    }
  }
  return out;
}

/**
 * 应用 agent 本 tick 的暂存决策（在物理基线之上）：
 * - metric/tech/values delta clamp 到边界
 * - territory_claim 校验后并入领土（只能占相邻/感知内区域, 或建命名子区划）
 * - propose_dim 走复现门槛: 同一维度 ≥2 次相隔提议才注册
 */
function applyAgentDelta(
  session: SimulationSession,
  entity: EntityCard,
  delta: AgentDelta,
  result: PhysicsResult,
  tick: number,
): void {
  if (delta.metric_delta) {
    applyMetricDelta(entity, delta.metric_delta, result);
  }
  for (const [dim, dv] of Object.entries(delta.tech_delta ?? {})) {
    if (typeof dv !== "number") continue;
    const cap = result.techPotential[dim] ?? 100;
    entity.tech[dim] = clampNum((entity.tech[dim] ?? 0) + dv, 0, cap);
  }
  for (const [dim, dv] of Object.entries(delta.values_delta ?? {})) {
    if (typeof dv !== "number") continue;
    entity.values[dim] = clampNum((entity.values[dim] ?? 50) + dv, 0, 100);
  }
  if (delta.territory_claims?.length) {
    applyTerritoryClaims(session, entity, delta.territory_claims, result.adminCapacity);
  }
  if (delta.propose_dims?.length) {
    applyProposedDims(session, entity, delta.propose_dims, tick);
  }
}

/**
 * 领土扩张（§4.0②）：LLM 决策的 territory_claim 校验后并入。
 * - **治理上限**（软门, "不能无限扩张"）：territory 数已达 adminCapacity → 拒绝, 优先内部整合。
 * - 占已有区划：需相邻/感知内; 若被另一活跃实体控制, 还需军力占优（征服）。
 * - 建命名子区划：claim.region 不存在但有 name → 挂在已领区划下, 计入治理容量。
 * - 否则拒绝（不凭空占远区）。
 */
function applyTerritoryClaims(
  session: SimulationSession,
  entity: EntityCard,
  claims: NonNullable<AgentDelta["territory_claims"]>,
  adminCapacity: number,
): void {
  const owned = new Set(entity.territory ?? [entity.geography.region]);
  const ownedRegions = new Set<string>();
  for (const id of owned) {
    ownedRegions.add(id);
    // 已领区划的子区划也算已领
    for (const c of session.regions[id]?.children ?? []) ownedRegions.add(c);
  }
  // 可扩张集合: 已领区划的邻居 + 已感知实体所在区域
  const claimable = new Set<string>();
  for (const oid of ownedRegions) {
    for (const nid of session.regions[oid]?.neighbors ?? []) claimable.add(nid);
    for (const cid of session.regions[oid]?.children ?? []) claimable.add(cid);
  }
  for (const [tid, t] of Object.entries(session.entities)) {
    if (tid === entity.id) continue;
    if (t.status !== "active") continue;
    claimable.add(t.geography.region);
  }

  for (const claim of claims) {
    // 已拥有 → 跳过
    if (owned.has(claim.region)) continue;

    // 治理上限: 扩张是历史性大动作, 不能无限扩——超容量则否决(软门, 由 LLM 结合发展水平判断)
    const currTerritory = entity.territory ?? [entity.geography.region];
    if (currTerritory.length >= adminCapacity) {
      entity.internal.recent_events = [
        `扩张被否决: 治理能力不足(${currTerritory.length}/${adminCapacity} 区划), 优先内部整合`, ...entity.internal.recent_events,
      ].slice(0, 5);
      continue;
    }

    const target = session.regions[claim.region];
    if (target && claimable.has(claim.region)) {
      // 占已有区划（邻居/感知内）——若被另一活跃实体控制, 需军力占优(征服)
      const defender = Object.values(session.entities).find(
        (t) => t.status === "active" && t.id !== entity.id
          && (t.territory ?? [t.geography.region]).includes(claim.region),
      );
      if (defender && entity.metrics.military <= defender.metrics.military * 0.8) {
        entity.internal.recent_events = [
          `征服 ${target.name} 失败: 军力不足(${Math.round(entity.metrics.military)} vs ${Math.round(defender.metrics.military)})`, ...entity.internal.recent_events,
        ].slice(0, 5);
        continue;
      }
      entity.territory = addTerritory(entity.territory, [claim.region]);
      entity.internal.recent_events = [
        `领土扩张: 占取 ${target.name}`, ...entity.internal.recent_events,
      ].slice(0, 5);
      continue;
    }
    if (!target && claim.name) {
      // 建命名子区划: 挂在已领区划下（复用 subdivision 的 createNamedSubregion, 同时维护 regions + geography）
      const parentId = [...ownedRegions].find((id) => session.regions[id]);
      if (!parentId) continue;
      const parent = session.regions[parentId];
      const childId = `${parentId}:${slugify(claim.name)}`;
      const child = createNamedSubregion(session, parent, {
        id: childId,
        name: claim.name,
        character: claim.character ?? `在 ${parent.name} 内的新开拓地`,
      });
      entity.territory = addTerritory(entity.territory, [childId]);
      entity.internal.recent_events = [
        `领土扩张: 开拓 ${claim.name}`, ...entity.internal.recent_events,
      ].slice(0, 5);
    }
  }
}

/**
 * 新维度提议（§4.2 涌现）: 同一维度 ≥2 次相隔提议才注册（复现门槛, 防一次性维度膨胀）。
 * 复现记录存 session.dimCandidates。
 */
function applyProposedDims(
  session: SimulationSession,
  entity: EntityCard,
  proposals: NonNullable<AgentDelta["propose_dims"]>,
  tick: number,
): void {
  for (const p of proposals) {
    const name = p.name?.trim();
    if (!name) continue;
    // 维度涌现由 LLM 综合判断(propose_dim 是实体深思熟虑的提议), 不再设复现阈值——
    // 单次提议即注册。注册表仍是受追踪维度集合, 防膨胀靠"LLM 只在确需长期追踪时才 propose"。
    const registered = tryRegisterDimension(session.registry, {
      dim: name,
      kind: "tech",
      frequency: 0.6,
      consequence: 0.6,
      lawConsistency: 1,
      potential: 40,
      description: p.reason ?? `由 ${entity.name} 提议涌现`,
    }, tick);
    if (registered.registered) {
      entity.internal.recent_events = [`新维度确立: ${name}`, ...entity.internal.recent_events].slice(0, 5);
    }
  }
}

const MIN_POP = 100;

function slugify(name: string): string {
  const s = name.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9一-龥-]/g, "");
  return s.slice(0, 24) || "new";
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * 动态 agent 池更新（§5.4）：根据 accepted 状态事件分裂/吞并/灭亡/复兴/分化实体。
 * 事件类型 → 动作：
 * - conquest → 吞并（conqueror 吸收, conquered 进 archive）
 * - secession / founding → 分裂（派生子实体）
 * - collapse → 灭亡（冻结进 archive）
 * - cultural → 分化（派生子实体, 共享部分 identity）
 * - 复兴：由后续 tick 的 agent 发现 archive 触发（此处预留接口）
 */
function applyStateChanges(
  session: SimulationSession,
  events: SimulationEvent[],
  tick: number,
  rng: Rng,
): void {
  for (const ev of events) {
    // 机制由事件声明的结构化结果(changes)驱动, 不由 type 枚举驱动:
    // LLM 说"被吞并"→ absorbed_by; 说"建国/分裂"→ founded; 说"灭亡"→ collapsed。
    for (const c of ev.changes ?? []) {
      // 吞并(conquest/征服/合并)
      if (c.absorbed_by) {
        const conqueror = session.entities[c.absorbed_by];
        const conquered = session.entities[c.entity];
        if (!conqueror || !conquered || conquered.status === "extinct") continue;
        const r = conquerEntity(conqueror, conquered, ev, tick);
        session.entities[c.absorbed_by] = r.conqueror;
        session.entities[c.entity] = r.conquered;
        session.archive.push(r.archive);
        // 语言接触演化（§: 征服 → 借词）：吞并者语言借入被吞者文化的词根
        const conqCulture = session.cultures[conqueror.identity.ethnicity];
        const conquCulture = session.cultures[conquered.identity.ethnicity];
        const conqLang = conqCulture ? session.languages[conqCulture.languageId] : undefined;
        const conquLang = conquCulture ? session.languages[conquCulture.languageId] : undefined;
        if (conqLang && conquLang && conquLang.id !== conqLang.id) {
          const { lang, loanword } = evolveLanguageBorrowing(conqLang, conquLang, "征服地", tick);
          if (loanword) {
            session.languages[conqLang.id] = lang;
            r.conqueror.internal.recent_events = [`语言借词: 从 ${conquLang.name} 借入「${loanword}」`, ...r.conqueror.internal.recent_events].slice(0, 5);
            session.entities[c.absorbed_by] = r.conqueror;
          }
        }
        continue;
      }
      // 建国/分裂
      if (c.founded) {
        const parent = session.entities[c.entity];
        if (!parent || parent.status === "extinct") continue;
        // §3.4 maxEntities 生效: 达到上限则禁止分裂
        const activeCount = Object.values(session.entities).filter((e) => e.status === "active").length;
        const maxEnt = session.config.maxEntities;
        if (maxEnt != null && activeCount >= maxEnt) continue;
        // 分裂子实体名：优先事件指定, 否则用父实体文化的语言生成（命名与文化强相关）
        const childName = c.founded.name
          ?? nameForEntity(session, parent.identity.ethnicity || undefined, "nation", rng);
        const r = splitEntity(parent, ev, childName, tick);
        session.entities[c.entity] = r.parent;
        session.entities[r.child.id] = r.child;
        // 分裂 → 方言分化（§: 文化分裂 → 语言分化）: 子实体文化衍生新方言
        const parentCulture = session.cultures[parent.identity.ethnicity];
        if (parentCulture) {
          const parentLang = session.languages[parentCulture.languageId];
          if (parentLang) {
            const dialect = divergeLanguage(parentLang, `${childName}语`, tick, rng);
            session.languages[dialect.id] = dialect;
            // 子实体文化绑定新方言
            session.cultures[childName] = createCulture(childName, childName, dialect.id);
            session.entities[r.child.id].identity.ethnicity = childName;
            session.entities[r.child.id].identity.culture = childName;
          }
        }
        continue;
      }
      // 灭亡
      if (c.collapsed) {
        const entity = session.entities[c.entity];
        if (!entity || entity.status === "extinct") continue;
        const archive = collapseEntity(entity, ev, tick);
        session.entities[c.entity] = archive.entity;
        session.archive.push(archive);
        continue;
      }
    }
  }
}

/**
 * 复兴触发（§5.4, 进阶）：后世 agent 有概率发现 archive 中的文明遗迹 → 触发文化/宗教复兴。
 * 概率低（古代文明复兴是罕见事件），且需要该区域当前无强敌（复兴初期脆弱）。
 */
function maybeRevive(
  session: SimulationSession,
  tick: number,
  rng: Rng,
  tickEvents: SimulationEvent[],
): void {
  if (session.archive.length === 0) return;
  // §3.4 maxEntities 生效: 达到上限则不再复兴（实体数量涌现但有硬上限）
  const activeCount = Object.values(session.entities).filter((e) => e.status === "active").length;
  const maxEnt = session.config.maxEntities;
  if (maxEnt != null && activeCount >= maxEnt) return;
  // 复兴概率：每 tick 5%，且仅当 archive 有文明
  if (rng() >= 0.05) return;
  const entry = session.archive[Math.floor(rng() * session.archive.length)];
  if (!entry) return;
  // 复兴实体名用其原文化的语言生成（§: 命名与文化强相关）
  const revivedName = nameForEntity(session, entry.entity.identity.ethnicity || undefined, "nation", rng);
  const revived = reviveEntity(entry, revivedName, tick);
  session.entities[revived.id] = revived;
  tickEvents.push({
    id: `revive-${tick}`,
    tick,
    time_label: timeLabel(session, tick),
    type: "cultural",
    participants: [revived.id],
    region: revived.geography.region,
    description: `后世的考古者重新发现了 ${entry.entity.name} 的遗迹，一场文化复兴悄然兴起（§5.4）`,
    changes: [{ entity: revived.id }],
    random: true,
    source: "engine",
  });
}

function buildRoutineEvent(session: SimulationSession, tick: number): SimulationEvent {
  const active = Object.values(session.entities).filter((e) => e.status === "active");
  // §3.4 granularity 生效: 宏观=概括性描述, 微观=细节描述
  const granularity = session.config.granularity ?? "macro";
  let desc: string;
  if (active.length === 0) {
    desc = "世界空寂，尚无文明存在。";
  } else if (granularity === "micro") {
    desc = active.map((e) => `${e.name}（${e.identity.political_form}, 人口${e.metrics.population.toLocaleString()}）继续演化`)
      .slice(0, 8).join("；") + (active.length > 8 ? ` 等 ${active.length} 个实体。` : "。");
  } else if (granularity === "standard") {
    desc = `${active.map((e) => e.name).slice(0, 5).join("、")}等 ${active.length} 个实体在各自领域稳定推进。`;
  } else {
    desc = `${active.map((e) => e.name).slice(0, 5).join("、")}${active.length > 5 ? ` 等 ${active.length} 个实体` : ""}继续在各自领域演化。`;
  }
  return {
    id: `evt-routine-${tick}`,
    tick,
    time_label: timeLabel(session, tick),
    type: "other",
    participants: [],
    region: "",
    description: desc,
    changes: [],
    random: false,
    source: "engine",
  };
}

export function timeLabel(session: SimulationSession, tick: number): string {
  // §3.4 yearsPerTick 生效: 决定每 tick 代表的真实年数
  const ypt = session.config.yearsPerTick ?? 10;
  const worldYear = tick * ypt;
  const era = Math.floor(worldYear / 1000) + 1;
  const year = worldYear % 1000;
  return `第${era}纪元 ${String(year).padStart(3, "0")}年 (tick ${tick})`;
}

const clampNum = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

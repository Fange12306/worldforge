/**
 * 黑天鹅事件发生器 (§7) — 基于世界法则 + 实体状态 + 区域特征 **生成**候选事件。
 *
 * 对应 SIMULATION_DESIGN.md §7：
 * - 每 tick 每个实体按 randomness 概率触发黑天鹅事件发生器。
 * - **生成**候选小概率事件（天灾、天才诞生、意外发现、疾病、异象）——
 *   不是从预设模板池抽取，而是由当前上下文组合生成，每个事件都是独一无二的。
 * - 触发后进仲裁器，与其他事件一起过自洽检查（§5.3）。
 * - surprise 单独控制意外结果比例；rigor 控制"事如何被允许发生"。
 *
 * 生成逻辑（§4.2 涌现而非预设）：
 *   候选内容 = 世界法则(物理/规则/叙事) × 实体当前状态(指标/维度) × 区域特征 × 已注册维度
 *   例：
 *   - 区域是沙漠 + 人口压力大 → 生成"旱灾/饥荒"
 *   - 实体"航海"维度高 → 生成"航路突破"天才事件
 *   - 世界法则有魔力 → 生成"灵脉爆发/施法事故"
 *   - 世界法则有灵气 + 山脉区域 → 生成"灵气潮汐/福地现世"
 *
 * 生成器接口（blackSwanContext → candidate）：
 * Phase 0 用程序化生成（本文件）；Phase 1 可无缝替换为 LLM agent 生成（同一接口）。
 */

import type {
  EntityCard,
  RegionResources,
  SimulationConfig,
  SimulationSession,
  SpaceRegion,
  WorldLaws,
} from "./types.ts";
import type { Rng } from "./random.ts";
import type { LLMBindings } from "./llm.ts";
import { parseJSONFromLLM, safeCall } from "./llm.ts";
import { inferBiome } from "./regime.ts";
import { metricTrendLine } from "./context.ts";
import { loreFactsFor } from "./lore.ts";

// ── 生成上下文 ────────────────────────────────────────

export type BlackSwanContext = {
  laws: WorldLaws;
  entity: EntityCard;
  region: SpaceRegion;
  config: SimulationConfig;
  rng: Rng;
  tick: number;
  /** 已注册维度（当前实体可用的） */
  techDims: string[];
  valueDims: string[];
  /** 人口压力 / 稳定度等派生状态（由调度器预先算好传入） */
  populationPressure: number;
  foodDeficit: boolean;
};

export type BlackSwanCandidate = {
  type: string;
  description: string;
  /** 扰动某个已注册维度（可为空=纯事件） */
  dim?: string;
  dimDelta?: number;
  /** 是否"天才/奇观"型（随机性注入差异性, §7） */
  genius?: boolean;
  /** 该候选如何被 rigor 约束（供仲裁参考） */
  causality: "natural" | "coincidental";
  /** LLM 生成的指标扰动（真实生效, clamp 到边界） */
  metric_delta?: Partial<{ population: number; food: number; economy: number; military: number; legitimacy: number; stability: number }>;
};

// ── 类型判定与区域特征 ────────────────────────────────

type BiomeTrait = "coast" | "inland" | "mountain" | "desert" | "steppe" | "forest" | "wetland" | "space";

/** biome → 黑天鹅特质（未知 biome 先经 inferBiome 归一化） */
function biomeTrait(biome: string): BiomeTrait {
  switch (inferBiome(biome)) {
    case "coast": case "ocean": return "coast";
    case "mountains": return "mountain";
    case "desert": return "desert";
    case "steppe": return "steppe";
    case "forest": return "forest";
    case "plains": return "inland";
    case "tundra": return "steppe";
    case "space": return "space";
    default: return "inland";
  }
}

// ── 生成器：程序化组合生成 ─────────────────────────────

/**
 * 生成一个黑天鹅候选。
 * 返回 null = 本次未触发（概率判定由调度器做，这里只负责"如果触发了，生成什么"）。
 *
 * 生成方式：根据世界法则 × 实体状态 × 区域特征组合出事件，
 * 而不是从固定列表抽取。事件内容随上下文变化，独一无二。
 */
export function generateBlackSwan(ctx: BlackSwanContext): BlackSwanCandidate | null {
  const { laws, entity, region, config, rng, techDims, valueDims } = ctx;
  const meta = laws.physics.metaphysics ?? {};
  const trait = biomeTrait(region.biome);

  // 判定：触发哪类黑天鹅（天灾/天才/异象/疾病/意外）
  // 概率由 randomness 决定（调度器已按 randomness 判定进入此函数）
  const roll = rng();

  // 类别权重（§7）：surprise 控制"意外结果比例"——
  // surprise 越高，天才/意外/发现等"计划外结局"占比越高；surprise 越低越偏向天灾。
  const surprise = config.surprise ?? 0.3;
  // 意外类阈值：0.30 (低 surprise) → 0.30 + surprise*0.5 (高 surprise 时意外类占比高)
  const accidentThreshold = 0.30 + surprise * 0.5;
  const hasMagic = (meta.mana ?? 0) > 0;
  const hasQi = (meta.qi ?? 0) > 0;

  if (roll < 0.30) {
    return generateDisaster(ctx, trait, hasMagic, hasQi);
  }
  if (roll < accidentThreshold) {
    return generateGenius(ctx, techDims, valueDims, hasMagic, hasQi);
  }
  if (roll < accidentThreshold + 0.15) {
    return generateDiscovery(ctx, techDims, hasMagic, hasQi);
  }
  if (roll < accidentThreshold + 0.30) {
    return generatePlague(ctx, trait);
  }
  return generateOmen(ctx, trait, hasMagic, hasQi);
}

// ── 具体生成器 ────────────────────────────────────────

// ── 组合式生成（§: 一切从世界上下文涌现, 非模板池）──
// 每个生成器把"生物群系特征 × 实体状态 × 世界法则 × 已注册维度"的语义片段
// 组合成描述。片段由世界自身的特征产出, 而非硬编码的句子数组。

/** 生物群系的灾难性特征（语义片段, 供组合）——不是完整句子 */
const TRAIT_HAZARDS: Record<BiomeTrait, { force: string; target: string }> = {
  coast:    { force: "狂暴的海潮", target: "沿岸的聚落与盐田" },
  inland:   { force: "骤然的大旱", target: "平原的河渠与耕地" },
  mountain: { force: "山体的崩塌", target: "谷地的聚落与矿道" },
  desert:   { force: "席卷的沙暴", target: "绿洲与商路" },
  steppe:   { force: "蔓延的野火", target: "草场与畜群" },
  forest:   { force: "突发的林火", target: "林间的村落" },
  wetland:  { force: "倒灌的洪水", target: "低洼的耕地" },
  space:    { force: "异常的星体活动", target: "轨道与殖民地" },
};

function generateDisaster(
  ctx: BlackSwanContext,
  trait: BiomeTrait,
  hasMagic: boolean,
  hasQi: boolean,
): BlackSwanCandidate {
  const { region, entity, rng } = ctx;
  const hazard = TRAIT_HAZARDS[trait];

  // 世界法则叠加：有魔力 → 魔力天灾（由法则名 + 魔力特征组合）
  if (hasMagic && rng() < 0.5) {
    const metaName = ctx.laws.name;
    return {
      type: "disaster",
      description: `${region.name}的魔力场骤然紊乱，灵脉失控，${entity.name}的施法者亦难以幸免（${metaName}的法则反噬）。`,
      causality: "natural",
    };
  }
  if (hasQi && rng() < 0.5) {
    const metaName = ctx.laws.name;
    return {
      type: "disaster",
      description: `${region.name}的天地灵气倒灌，${entity.name}的修士修炼时走火入魔者众（${metaName}灵气潮汐紊乱）。`,
      causality: "natural",
    };
  }

  // 普通天灾：由区域特征 + 实体状态组合
  const affliction = ctx.foodDeficit
    ? `，本已紧张的粮储雪上加霜`
    : entity.metrics.stability < 30
      ? `，人心惶惶`
      : `，${entity.name}元气大伤`;
  return {
    type: "disaster",
    description: `${hazard.force}袭击了${hazard.target}${affliction}。`,
    causality: "natural",
  };
}

function generateGenius(
  ctx: BlackSwanContext,
  techDims: string[],
  valueDims: string[],
  hasMagic: boolean,
  hasQi: boolean,
): BlackSwanCandidate {
  // 天才/奇观：扰动已注册维度。优先选该实体最擅长的维度（潜在增长方向）。
  const { entity, rng, region } = ctx;

  // 候选维度池：已注册维度 + 世界法则派生的超常维度
  const candidates: { dim: string; label: string }[] = [];
  for (const d of techDims) candidates.push({ dim: d, label: d });
  for (const d of valueDims) candidates.push({ dim: d, label: d });
  if (hasMagic) candidates.push({ dim: "魔力掌控", label: "魔力" });
  if (hasQi) candidates.push({ dim: "修为", label: "修为" });

  if (candidates.length === 0) {
    return {
      type: "other",
      description: `${region.name}的${entity.identity.ethnicity}中出现了一位极具远见的领袖，正试图改变${entity.name}的前路。`,
      genius: true,
      causality: "coincidental",
    };
  }

  // 倾向选维度值最高者（天才推动最强方向突破）
  const scored = candidates
    .map((c) => ({ ...c, val: entity.tech[c.dim] ?? entity.values[c.dim] ?? 50 }))
    .sort((a, b) => b.val - a.val);
  const pick = scored[Math.floor(rng() * Math.min(2, scored.length))]; // 前 2 名内随机

  return {
    type: "tech",
    description: `${region.name}的${entity.identity.ethnicity}中诞生了一位罕见的天才，在「${pick.label}」领域取得了突破，为${entity.name}开辟了新的可能。`,
    dim: pick.dim,
    dimDelta: 4 + Math.floor(rng() * 6),
    genius: true,
    causality: "coincidental", // 天才的诞生是偶然的
  };
}

function generatePlague(ctx: BlackSwanContext, trait: BiomeTrait): BlackSwanCandidate {
  // 疾病与人口密集度相关（由人口压力组合描述, 非模板）
  const { populationPressure, region, entity } = ctx;
  const traitWord = trait === "coast" ? "潮湿的港埠" : trait === "forest" ? "密林深处" : "拥挤的聚落";
  if (populationPressure < 0.8) {
    return {
      type: "disaster",
      description: `${region.name}的${traitWord}间悄然蔓延起一场疫病，${entity.name}的劳动力受到冲击。`,
      causality: "natural",
    };
  }
  return {
    type: "disaster",
    description: `${region.name}人口过密，疫病在${entity.name}的营地间迅速传播，人心惶惶。`,
    causality: "natural",
  };
}

function generateOmen(
  ctx: BlackSwanContext,
  trait: BiomeTrait,
  hasMagic: boolean,
  hasQi: boolean,
): BlackSwanCandidate {
  const { laws, rng, region, entity } = ctx;
  const ontology = laws.ontology.join(" ");
  // 异象由世界本体规则 + 区域特征组合（非模板列表）
  const omenParts: string[] = [];

  if (ontology.includes("星") || ontology.includes("宇宙")) {
    omenParts.push(`${region.name}上空出现了前所未见的星象`);
  }
  if (hasMagic) {
    omenParts.push(`魔力潮汐紊乱`);
  }
  if (hasQi) {
    omenParts.push(`天地灵气异常涌动`);
  }
  if (trait === "space") {
    omenParts.push(`深空中传来规律性的信号`);
  }
  if (omenParts.length === 0) {
    omenParts.push(`${region.name}的天象出现不寻常的光点`);
  }
  return {
    type: "other",
    description: `${omenParts.join("，")}，${entity.name}的智者与百姓对此解读不一。`,
    causality: "coincidental",
  };
}

function generateDiscovery(
  ctx: BlackSwanContext,
  techDims: string[],
  hasMagic: boolean,
  hasQi: boolean,
): BlackSwanCandidate {
  const { rng, entity, region } = ctx;
  const dim = techDims.length > 0
    ? techDims[Math.floor(rng() * techDims.length)]
    : hasMagic ? "魔力掌控" : hasQi ? "修为" : "制度";
  const val = entity.tech[dim] ?? 50;
  const finder = entity.identity.ethnicity;
  return {
    type: "tech",
    description: `${region.name}的${finder}在一次偶然中获得了关于「${dim}」的新发现，推进了${entity.name}的发展（当前值 ${Math.round(val)}）。`,
    dim,
    dimDelta: 3 + Math.floor(rng() * 4),
    causality: "coincidental",
  };
}

// ── 判定：是否触发 + 生成 ─────────────────────────────

/**
 * 黑天鹅事件发生器入口（程序化 fallback, mock/未配 LLM 时用）。
 * 保留旧语义供测试/降级: 每实体按 randomness 判定触发。
 * 引擎主路径已改为"每 tick 全局一次"稀有事件判定（runTicks, 与实体数无关）——
 * 此处保留为降级路径与单元测试用。
 */
export function rollBlackSwan(ctx: BlackSwanContext): BlackSwanCandidate | null {
  const { config, rng } = ctx;
  if (config.randomness <= 0) return null;
  if (rng() >= config.randomness) return null;
  return generateBlackSwan(ctx);
}

// ── LLM 综合生成（主路径, §7 黑天鹅改为 LLM 判定）──────

export type RareEventRequest = {
  session: SimulationSession;
  entity: EntityCard;
  region: SpaceRegion;
  tick: number;
};

/**
 * 稀有事件生成（LLM 主路径）：综合世界法则 + 区域 + 实体全卡片 + 全球近期事件 +
 * 已注册维度, 现场生成一个独一无二的事件, 不预设类别。
 * 返回 null = 未触发/解析失败/无真实 LLM。
 */
export async function generateRareEvent(
  ctx: RareEventRequest,
  llm: LLMBindings | undefined,
): Promise<BlackSwanCandidate | null> {
  if (!llm?.real) return null; // 无真实 LLM → 走程序化 fallback
  const { session, entity, region, tick } = ctx;

  const recent = session.events.filter((e) => e.tick >= tick - 3)
    .map((e) => `- [${e.type}] ${e.description}`).slice(-6);
  const dims = Object.entries(session.registry.dims ?? {})
    .map(([d, def]) => `${d}(${def.potential})`).join("、") || "(无)";
  const laws = session.laws;

  const system = [
    `你是架空世界的历史推演器, 负责判断并生成一个文明在当下几十年间的「稀有事件」。`,
    `世界: ${laws.name}（${laws.spatial_scale}）。法则: ${laws.rules.join("；")}`,
    `推演参数: surprise=${session.config.surprise}, rigor=${session.config.rigor}。`,
    `稀有事件可以是任何对当前文明有真实影响的事: 天才/技术突破、天灾、瘟疫、异象、外交变故、内部动荡、环境突变、社会风俗、经济现象……**不要预设类别, 结合下方状态的因果自然生成**。`,
    `type 是一个自由文本标签, 用 1-4 个中文字词**精确概括事件类别**(如"彗星观象""银根紧缩""先贤遗策""海市蜃楼""王室决裂"), **必须契合时代与实体状态**——部落时代不会出现"金融危机", 无魔法的世界不会出现"魔力潮汐"。不要用"disaster/tech/other"这类泛泛标签。`,
    `**时代语言(严格)**: 事件叙事与设施必须完全契合当前时代。部落/氏族时代只能用石斧/骨器/陶器/聚落/祭坛/氏族/长老/巫师等符合该时代的技术与词汇, 不能出现后世才有的东西(文字法典/铸币/盐引/火炮/宫殿/职业官僚/科举/票号/律令)。`,
    `**事件频率由你综合判断**: 稀有事件是"数十年一遇"的重大转折, 多数年代是平静的。若这个文明当前确实风平浪静、无值得记载之事, 输出 null(不硬造事件)。切勿每个 tick 都编大新闻。`,
    `要求: 事件必须与区域地形/气候、实体当前数值与制度、已注册维度一致; 与近期事件不重复; 有明确因果。`,
    `输出严格 JSON 单个对象(平静年代输出 null): {type, description, metric_delta?: {population?, food?, economy?, military?, legitimacy?, stability?}, tech_delta?: {<已注册维度名>: 变化量}, severity: "mild"|"severe"}`,
    `description 用中文 2-3 句叙事。metric_delta/tech_delta 里的数字会真实生效, 叙事必须与数字一致(说"人口锐减"就要给负 population delta)。`,
  ].join("\n");

  const user = [
    `# 我（${entity.name}, ${entity.identity.species}）的完整状态`,
    `指标: 人口=${entity.metrics.population} 军力=${entity.metrics.military} 稳定=${entity.metrics.stability} 合法=${entity.metrics.legitimacy} 经济=${entity.metrics.economy ?? 0} 粮食=${entity.metrics.food}`,
    ``,
    `# 近期走势（趋势方向, 事件叙事应与之一致）`,
    ...["population", "food", "stability", "economy"].map((k) => {
      const line = metricTrendLine(entity, k as keyof EntityCard["metrics"]);
      return line ? `- ${line}` : null;
    }).filter(Boolean) as string[],
    `发展维度: ${Object.entries(entity.tech).map(([k, v]) => `${k}=${v}`).join("、") || "(无)"}`,
    `理念: ${Object.entries(entity.values).map(([k, v]) => `${k}=${v}`).join("、")}`,
    `政权: ${entity.identity.political_form} | 意识形态: ${entity.identity.ideology}${entity.identity.religion ? ` | 宗教: ${entity.identity.religion}` : ""}`,
    `领土: ${(entity.territory ?? [entity.geography.region]).join("、")}`,
    entity.regime ? `政体信号: 组织复杂度=${Math.round(entity.regime.organizational_complexity)} 集权度=${Math.round(entity.regime.centralization)} 经济支撑力=${entity.regime.economic_base}` : "",
    ``,
    `# 当前区域「${region.name}」`,
    `地形: ${region.character ?? region.biome} | 气候/生态: ${region.environment ? `${region.environment.climate.temperature}℃/${region.environment.climate.precipitation}mm` : "(未细化)"}`,
    ...((region.shape || region.position) ? [`区域形态: ${[region.shape ? `形状: ${region.shape}` : "", region.position ? `位于: ${region.position}` : ""].filter(Boolean).join("; ")}`] : []),
    `邻接区域: ${(region.neighbors ?? []).join("、") || "(无)"}`,
    ``,
    `# 世界已确定事实（与你/你的区域相关, 不可违反, 只能在其上推演）`,
    ...(() => {
      const relevant = loreFactsFor(session, entity);
      return relevant.length > 0 ? relevant.map((f) => `- ${f.content}`) : ["- (无)"];
    })(),
    ``,
    `# 已注册发展轴`,
    dims,
    ``,
    `# 全球近期事件（tick ${tick - 3}~${tick}）`,
    recent.length ? recent.join("\n") : "(无)",
  ].join("\n");

  const response = await safeCall(llm, { systemPrompt: system, userMessage: user, maxTokens: 700, json: true });
  if (!response) return null;

  let parsed: { type?: string; description?: string; metric_delta?: Record<string, number>; tech_delta?: Record<string, number>; severity?: string };
  try {
    const raw = parseJSONFromLLM<unknown>(response);
    // LLM 判断"平静年代"输出 null → 无事件
    if (raw === null || (typeof raw === "object" && raw !== null && Object.keys(raw as object).length === 0)) {
      return null;
    }
    parsed = raw as typeof parsed;
  } catch {
    return null;
  }

  const desc = typeof parsed?.description === "string" ? parsed.description.trim() : "";
  if (!desc) return null;

  // 从已注册维度里取 tech_delta(只允许调整已注册维度)
  const dim = parsed.tech_delta ? Object.keys(parsed.tech_delta)[0] : undefined;
  const inTech = dim !== undefined && Object.keys(entity.tech).includes(dim);
  const techDelta = dim !== undefined && inTech && typeof parsed.tech_delta?.[dim] === "number"
    ? parsed.tech_delta[dim] : undefined;

  return {
    type: parsed.type ?? "other",
    description: desc,
    dim: inTech ? dim : undefined,
    dimDelta: techDelta,
    metric_delta: parsed.metric_delta && Object.keys(parsed.metric_delta).length > 0 ? parsed.metric_delta : undefined,
    causality: (parsed.severity ?? "mild") === "severe" ? "natural" : "coincidental",
  };
}

/** 便捷：从调度器上下文构造（供 engine.ts 调用） */
export function makeBlackSwanContext(args: {
  laws: WorldLaws;
  entity: EntityCard;
  region: SpaceRegion;
  config: SimulationConfig;
  rng: Rng;
  tick: number;
  techDims: string[];
  valueDims: string[];
  populationPressure: number;
  foodDeficit: boolean;
}): BlackSwanContext {
  return { ...args };
}

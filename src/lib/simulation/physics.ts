/**
 * 物理层数值引擎 (§4.1) — 世界法则派生的确定性数值联动。
 *
 * 核心原则（SIMULATION_DESIGN.md §4.1）：
 * - 法则决定"有哪些物理量"，物理量之间由法则决定联动。
 * - 每个实体的结构化指标由规则驱动更新，先算数值，再让 LLM 叙事化。
 * - 技术/理念（维度）的实际值 ≤ 潜力上限；潜力由空间/法则决定。
 * - 数值引擎是"物理常识"，保证不出现"沙漠里凭空养出千万大军"这种自洽灾难。
 *
 * 本文件只做确定性数值计算，不含 LLM、不含随机（随机由 black-swan 注入）。
 * 纯函数，可单测。
 */

import type {
  EntityCard,
  PhysicsParams,
  RegionResources,
  SpaceRegion,
  WorldLaws,
} from "./types.ts";
import { EARTH_MEASUREMENT } from "./measure.ts";
import { inferBiome } from "./regime.ts";
import { densityPressure, eraDensityCap, populationDensity, regionAreaKm2 } from "./scale.ts";

// ── 常量 ──────────────────────────────────────────────

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** 人口/军力/粮食下限（防负数与零除） */
const MIN_POP = 100;
const MIN_MILITARY = 1;

// ── 生物群系 → 资源潜力推导（§4.0② 空间全景的资源层）──

const BIOME_RESOURCES: Record<string, Omit<RegionResources, "mana_potential" | "qi_potential">> = {
  coast:     { food_capacity: 55, naval_potential: 85, mineral_potential: 35, agriculture_potential: 40 },
  plains:    { food_capacity: 90, naval_potential: 25, mineral_potential: 45, agriculture_potential: 90 },
  mountains: { food_capacity: 30, naval_potential: 15, mineral_potential: 90, agriculture_potential: 30 },
  desert:    { food_capacity: 15, naval_potential: 30, mineral_potential: 40, agriculture_potential: 10 },
  steppe:    { food_capacity: 45, naval_potential: 15, mineral_potential: 35, agriculture_potential: 40 },
  forest:    { food_capacity: 60, naval_potential: 40, mineral_potential: 50, agriculture_potential: 55 },
  tundra:    { food_capacity: 12, naval_potential: 40, mineral_potential: 30, agriculture_potential: 8 },
  ocean:     { food_capacity: 40, naval_potential: 95, mineral_potential: 15, agriculture_potential: 10 },
  space:     { food_capacity: 5,  naval_potential: 80, mineral_potential: 60, agriculture_potential: 5 },
};

/**
 * 推导一个区域在给定世界法则下的资源潜力。
 * mana/qi 潜力由世界的第二物理（metaphysics）决定：法则声明有魔力→按生物群系分布。
 */
export function deriveRegionResources(biome: string, laws: WorldLaws): RegionResources {
  const std = inferBiome(biome);
  const base = BIOME_RESOURCES[std] ?? BIOME_RESOURCES.plains;
  const meta = laws.physics.metaphysics ?? {};
  // 第二物理的强度映射到区域潜力：沿海水系/森林/空间更适合魔力; 山脉/苔原适合灵气淬炼
  const mana = clamp((meta.mana ?? 0) * (std === "coast" || std === "forest" || std === "ocean" || std === "space" ? 1.2 : 0.7));
  const qi = clamp((meta.qi ?? 0) * (std === "mountains" || std === "steppe" || std === "tundra" ? 1.3 : 0.8));
  return { ...base, mana_potential: mana, qi_potential: qi };
}

/** 区域粮食承载 → 人口潜力上限（马尔萨斯约束的底座） */
export function populationCapacity(region: RegionResources, development = 0): number {
  // food_capacity 0-100 → 人口上限。旧映射 10^(fc/50) 上限过小(草原 fc45→7.9万),
  // 导致人口快速触顶停滞。放宽到 10^(fc/25): fc45 草原→63万, fc90 平原→6300万。
  // 实际密度边界由 area × eraDensityCap 兜底, 这里只作物理上限。
  //
  // 复合×时代替换: 食物不再是唯一承载。dev 越高, 经济/产业/组织越能"供养"超出食物承载的人口
  // (工业革命后人口与食物脱钩)。dev=0(部落) → 纯食物承载; dev=100 → 4×食物承载。
  const foodBase = 10_000 * Math.pow(10, region.food_capacity / 25);
  const dev = Math.max(0, Math.min(100, development));
  return Math.round(foodBase * (1 + (dev * 3) / 100));
}

/**
 * 派生"发展水平"(连续 0-100, 软状态)——技术维度加权 + 组织复杂度。
 * 不是枚举/档位, 是连续值: 供物理层做时代替换的软边界 + UI 展示 + 喂给 LLM 判断时代与扩张节奏。
 * 所有维度由 deriveTechPotential 保证存在, 缺省 ?? 0。
 */
export function developmentLevel(entity: EntityCard): number {
  const t = entity.tech;
  const dims = {
    农业: 0.25, 生产: 0.2, 制度: 0.15, 航海: 0.1, 冶金: 0.1,
  };
  let dev = 0;
  for (const [dim, w] of Object.entries(dims)) {
    dev += w * clamp((t[dim] ?? 0) / 100);
  }
  dev += 0.2 * clamp((entity.regime?.organizational_complexity ?? 0) / 100);
  return Math.round(dev * 100);
}

/**
 * 领土治理上限(软门, "不能无限扩张")——随发展水平/组织复杂度/人口规模增长。
 * 部落 dev10/org10/5万人 → ~3 区划; 帝国 dev80/org60/500万 → ~28 区划。宽裕但有限。
 * org 可选覆盖(物理层用本 tick 新算的组织复杂度; prompt/UI 用实体已存值)。
 */
export function adminCapacityFor(entity: EntityCard, orgOverride?: number): number {
  const dev = developmentLevel(entity);
  const org = orgOverride ?? entity.regime?.organizational_complexity ?? 0;
  const pop = entity.metrics.population;
  return 1 + Math.floor(dev * 0.2 + org / 12 + Math.log10(Math.max(pop, 10_000) / 10_000));
}

// ── 每 tick 物理量联动（核心, §4.1）──

export type PhysicsResult = {
  metrics: EntityCard["metrics"];
  // 技术维度潜力上限更新（由区域资源推导; 法则含第二物理时加入对应维度）
  techPotential: Record<string, number>;
  // 技术维度增量（实际值向潜力收敛）
  techDelta: Record<string, number>;
  // 理念维度（价值观）变化：现实需求驱动，与资源/压力相关
  valuesDelta: Record<string, number>;
  // 政体信号（主干链: 经济 → 政体复杂度; 物理层给确定性信号, agent 决策形态）
  regimeDelta: {
    economy: number;                    // 经济/生产力更新
    organizational_complexity: number;  // 组织复杂度
    centralization: number;             // 集权度
    economic_base: number;              // 经济支撑力（能养活的脱产者）
    evolve_signal: boolean;             // 是否支持政体演化
    evolve_reason: string;              // 信号原因
  };
  // 叙事提示：给 LLM 的一句话（先算数值，后叙事化）
  narrative: string[];
  // 每 tick 应用后产生的结构性事件（如"饥荒""人口压力"）
  triggeredEvents: { type: string; description: string; severity: "mild" | "severe" }[];
  // 本 tick 有效人口上限（min(粮食承载, 面积×密度)）与粮食仓限——供 agent/稀有事件 delta clamp
  populationCap: number;
  foodCap: number;
  /** 派生发展水平（连续 0-100, 技术+组织加权）——供 UI/LLM/时代替换 */
  development: number;
  /** 领土治理上限（软门, "不能无限扩张"）: 随 dev/组织复杂度/人口增长 */
  adminCapacity: number;
};

/**
 * 推进一个实体一个 tick 的物理量。
 *
 * 联动链（确定性）：
 *   区域资源(food_capacity) → 人口上限 → 人口 vs 上限（压力）
 *   人口 × 军事转化 → 军力基数; 军力 × 军事技术 → 军力
 *   粮食充足/赤字 → 稳定度 ± ; 过载 → 合法性/稳定下降
 *   稳定/合法性 → 内部投入 → 技术实际值向潜力收敛
 */
export function tickPhysics(
  entity: EntityCard,
  region: SpaceRegion,
  laws: WorldLaws,
): PhysicsResult {
  const p = laws.physics;
  const m = { ...entity.metrics };
  const res = region.resources;
  // 面积与时代密度上限（§4.1 尺度合理性）——函数级, 人口/稳定度复用
  const area = regionAreaKm2(region, laws);
  const densityCap = eraDensityCap(entity.tech["农业"] ?? 0, entity.regime?.organizational_complexity ?? 0);

  // ── 0. 派生发展水平（复合: 技术+组织, 供时代替换 + UI + LLM 扩张判断）──
  const development = developmentLevel(entity);

  // ── 1. 人口（马尔萨斯 + 面积密度约束 + 复合承载）──
  // 有效人口上限 = min(复合粮食承载, 面积 × 时代合理密度上限)。
  // 复合承载: dev 越高, 人口越与食物脱钩(工业革命后人口与食物关系弱)。
  const foodCap = populationCapacity(res, development);
  const areaCap = area * densityCap;
  const cap = Math.min(foodCap, areaCap);
  const pressure = m.population / Math.max(cap, 1);
  // 复合增长率: 食物权重随发展水平下降, 经济/产业/治理成为人口增长的额外驱动力
  // ("工业革命后人口与食物关系弱"——每个时代人口绑定不同因素)。
  const foodSurplus = m.food > 0;
  const foodWeight = clamp(1.2 - development / 100, 0.25, 1.2);   // 高发展→食物权重降(0.25 下限)
  const productionTech = entity.tech["生产"] ?? 0;
  // 经济动量: 经济/产业/稳定共同驱动增长(0-1)
  const momentum = clamp(
    (m.economy ?? 0) / 100 * 0.5 + productionTech / 100 * 0.3 + (m.stability ?? 0) / 100 * 0.2,
  );
  // 食物因子: 盈余时近 1; 赤字时按食物权重——部落赤字→增长崩溃, 工业赤字→近乎持平
  const foodFactor = foodSurplus ? (0.8 + 0.2 * foodWeight) : (0.15 * foodWeight);
  const growthRate = p.pop_growth_base * (1 - pressure * 0.6) * foodFactor * (1 + momentum);
  let population = m.population * (1 + growthRate);
  const narrative: string[] = [];
  const triggered: PhysicsResult["triggeredEvents"] = [];

  // 粮食生产回补（硬物理量, 修复旧 `food*0.9 + (foodSurplus?0:0)` 恒 no-op 单调衰减）:
  // 每 tick 产出 = 人均产量 × 人口, 人均产量随农业技术上升(部落 0.6 → 精耕 ~2.0),
  // 并受区域承载系数(food_capacity/100)放大。产出超过消耗则盈余, 不足则吃老本/赤字。
  const agriTech = entity.tech["农业"] ?? 0;
  // 人均产量围绕 1.0(维持生存)波动: 贫瘠山地部落(fc30, 农业低)略亏 ~0.99, 平原部落略盈 ~1.09,
  // 精耕农业(fc90)显著盈余 ~1.9。低农业不是崩塌, 只是薄储备+慢增长。
  const perCapitaHarvest = p.food_per_capita * (0.92 + (agriTech / 100) * 0.45) * (0.8 + region.resources.food_capacity / 150);
  const harvest = population * perCapitaHarvest;
  const consumption = population * p.food_per_capita;
  // 本季净粮: 上季剩余 80% + 产出 - 消耗。存储下限为人口比例(-0.04P)——
  // 慢性小赤字(draw ≈ -0.01P/tick)把储备压到下限即止, 不触发饥荒(阈值 -0.05P),
  // 避免"赤字社会永续 8% 饿死"的失控坍塌(旧数据矮人 110k→65k 即此)。
  // 真正的饥荒由大幅负粮(天灾/agent 决策)触发: 一次性 8% 人口损失, 随后粮食清零回正。
  const rawFood = m.food * 0.8 + harvest - consumption;
  let food: number;
  if (rawFood < -p.food_per_capita * m.population * 0.05) {
    const starvationRate = 0.08;
    population *= 1 - starvationRate;
    food = 0;
    triggered.push({
      type: "disaster",
      description: `严重粮食短缺，人口减少了约 ${Math.round(starvationRate * 100)}%。`,
      severity: "severe",
    });
  } else {
    food = clamp(rawFood, -population * 0.04, foodCap);
  }

  // ── 2. 稳定度 / 合法性（受人口压力 + 密度压力 + 粮食 + 内部投入）──
  // 密度压力: 人口/面积 超时代合理上限 → 拥挤/资源争抢 → 稳定下降(软约束, §4.1 尺度合理性)
  const density = populationDensity(entity, region, laws);
  const densityPressureVal = densityPressure(density, densityCap);
  const stability = clamp(
    m.stability
      + p.stability_recovery * (foodSurplus ? 1 : -0.5)
      - p.overpopulation_pressure * Math.max(0, pressure - 1)
      - 0.02 * densityPressureVal,
  );
  // 合法性受稳定度牵引
  const legitimacy = clamp(m.legitimacy + (stability - m.stability) * 0.3);

  // ── 3. 军力（人口 × 转化 × 军事技术）──
  const militaryTech = entity.tech["军事"] ?? 0;
  let military = Math.max(
    MIN_MILITARY,
    m.military * 0.9 + population * p.military_per_pop * (1 + militaryTech / 100 * p.military_tech_mult),
  );
  military = Math.min(military, population * 0.2); // 军队不能超过人口的 20%（物理约束）

  // ── 3.5 主干链：地理 → 资源 → 人口 → 经济 → 政体（确定性, §: 物理常识）──
  // 经济 = 粮食盈余 × 生产技术(农业) → 可养活的脱产者数
  const agricultureTech = entity.tech["农业"] ?? 0;
  // 脱产者比例 = 农业技术决定的剩余率（§4.1 物理常识）:
  // 农业 0 → 5%(几乎全在种地), 农业 100 → 55%(精耕能养大量脱产者)。
  // 前工业化社会农业劳动力占 60-90%, 脱产率 10-40%; 部落时代更低。
  const surplusRatio = 0.05 + (agricultureTech / 100) * 0.5;
  // 经济基础：可养活的脱产者数 = 人口 × 剩余率 × 生产力加成 × 区域承载系数
  const economicBase = Math.max(0, Math.round(
    population * surplusRatio * (1 + productionTech / 200)
    * (0.5 + region.resources.food_capacity / 200),
  ));
  // 经济 = 脱产者占人口比例（§4.1 物理常识）:
  // 部落时代(剩余率~10%)→ economy ~10; 精耕帝国(剩余率~50%+)→ economy ~50-70。
  // 不是数量级 log10, 而是比例——避免小人口文明也满 100。
  const economy = clamp(surplusRatio * 100 * (1 + productionTech / 200) * (0.5 + region.resources.food_capacity / 200), 0, 100);
  // 组织复杂度：由经济支撑力驱动（能养脱产者 → 能支撑复杂层级）
  const orgComplexity = clamp(economy * 1.4 + (entity.values["组织倾向"] ?? 50) * 0.2);
  // 集权度：随政体演化变化, 受组织复杂度牵引
  const centralization = clamp(entity.regime.centralization + (orgComplexity - entity.regime.organizational_complexity) * 0.15);
  // ── 3.6 领土治理上限（软状态, "不能无限扩张"）──
  // 随发展水平/组织复杂度/人口规模增长(用本 tick 新算的组织复杂度)。
  const adminCapacity = adminCapacityFor(entity, orgComplexity);

  // 政体演化压力：软约束提示, 不设阈值不设公式（§4.1 先给数值, agent 结合历史自由判断是否演化）。
  // 物理层只持续报告"组织复杂度 vs 经济支撑力 vs 当前政体"状态, 不判是否该演化——
  // 是否及如何演化完全由 agent 结合历史/现状判断(部落时代不必急于封建化)。
  const prevComplexity = entity.regime.organizational_complexity;
  const evolveReason = `当前组织复杂度 ${Math.round(orgComplexity)}（此前 ${Math.round(prevComplexity)}）, 经济支撑力 ${Math.round(economy)}。若你的治理形态已难以承载当前发展, 可考虑演化; 否则保持现状亦可——由你结合历史与现状判断, 不急于改变。`;
  // 演化信号 = 组织复杂度本 tick 是否实际在增长(动态信号, 非恒 true)。
  // 部落稳定期 org 不涨 → 无演化压力, 不骚扰 agent(旧实现恒 true 导致 reform 每 2 tick 刷屏)。
  const evolveSignal = orgComplexity > prevComplexity;

  // ── 4. 技术维度：实际值向潜力收敛（内部投入驱动）──
  // 潜力由区域资源推导；真实世界 → 航海/农业/冶金/制度/生产
  const techPotential = deriveTechPotential(res, laws);
  const invest = clamp((legitimacy / 100) * 0.5 + (stability / 100) * 0.5); // 0-1 内部投入
  // 政体 → 技术耦合（§: 组织越复杂, 越能组织大规模技术工程）:
  // 组织复杂度作为内部投入的加成（复杂组织能动员更多资源投入技术）
  const orgBonus = clamp((entity.regime.organizational_complexity ?? 0) / 100) * 0.3;
  const cultureFit = clamp(0.5 + (entity.values["探索欲"] ?? 50) / 200);    // 理念适配（默认 0.75）
  const techDelta: Record<string, number> = {};
  for (const [dim, pot] of Object.entries(techPotential)) {
    const current = entity.tech[dim] ?? 0;
    if (pot <= current) {
      techDelta[dim] = 0; // 已达上限
      continue;
    }
    // 向潜力收敛：投入越高、文化越适配、离上限越远，涨得越快
    // 制度/生产维度额外受政体组织复杂度加成（复杂组织催生制度/生产）
    const dimOrgBonus = (dim === "制度" || dim === "生产") ? orgBonus : 0;
    const speed = 0.02 * (invest + dimOrgBonus) * cultureFit * (1 + (pot - current) / 100);
    const next = clamp(current + pot * speed);
    techDelta[dim] = Math.round((next - current) * 10) / 10;
  }

  // ── 5. 理念维度（价值观）：受历史压力影响（轻微漂移）──
  const valuesDelta: Record<string, number> = {};
  if (entity.values["探索欲"]) {
    // 人口压力/资源受限 → 倾向对外探索；稳定富足 → 倾向保守
    const drift = pressure > 1.1 ? 1 : pressure < 0.6 ? -0.5 : 0;
    if (drift !== 0) valuesDelta["探索欲"] = drift;
  }
  if (entity.values["组织倾向"]) {
    // 长期战乱/高压 → 组织倾向上升（抱团求生）
    if (pressure > 1.2) valuesDelta["组织倾向"] = 1;
  }

  return {
    metrics: {
      population: Math.round(population),
      food: Math.round(food * 100) / 100,
      economy: Math.round(economy * 10) / 10,
      military: Math.round(military * 10) / 10,
      legitimacy: Math.round(legitimacy * 10) / 10,
      stability: Math.round(stability * 10) / 10,
    },
    techPotential,
    techDelta,
    valuesDelta,
    populationCap: cap,
    foodCap,
    development,
    adminCapacity,
    regimeDelta: {
      economy: Math.round(economy * 10) / 10,
      organizational_complexity: Math.round(orgComplexity * 10) / 10,
      centralization: Math.round(centralization * 10) / 10,
      economic_base: economicBase,
      evolve_signal: evolveSignal,
      evolve_reason: evolveReason,
    },
    narrative,
    triggeredEvents: triggered,
  };
}

/** 由区域资源 + 世界法则推导技术维度潜力上限（§4.1 差异性底座） */
export function deriveTechPotential(res: RegionResources, laws: WorldLaws): Record<string, number> {
  const meta = laws.physics.metaphysics ?? {};
  const out: Record<string, number> = {
    "航海": res.naval_potential,
    "农业": res.agriculture_potential,
    "冶金": res.mineral_potential,
  };
  // 第二物理维度（魔法世界 → 魔力掌控; 真气世界 → 修为）
  if ((meta.mana ?? 0) > 0) out["魔力掌控"] = res.mana_potential;
  if ((meta.qi ?? 0) > 0) out["修为"] = res.qi_potential;
  // 制度/生产：与文明复杂度相关，受资源总量影响
  const total = (res.food_capacity + res.mineral_potential + res.agriculture_potential) / 3;
  out["制度"] = clamp(total * 0.7);
  out["生产"] = clamp(total * 0.6);
  return out;
}

// ── 内置世界法则（Phase 0 验证用：真实/魔法/真气）──

/** 类地球世界：遵循宇宙空间规律, 无第二物理 */
export const EARTH_LAWS: WorldLaws = {
  id: "earth",
  name: "真实世界",
  physics: {
    food_per_capita: 1,
    pop_growth_base: 0.02,
    military_per_pop: 0.002,
    military_tech_mult: 0.5,
    stability_recovery: 0.02,
    stability_decay: 0.05,
    overpopulation_pressure: 0.05,
  },
  rules: [
    "起死回生不可能发生。",
    "任何事物都必须遵守物理守恒。",
    "跨海军事行动需要造船与补给。",
  ],
  narrative: ["文明在物理法则下演化，无超自然干预。"],
  ontology: ["可观测宇宙为空间边界。", "能量/质量守恒。", "光速为信息传播上限。"],
  spatial_scale: "类地球大陆",
  measurement_system: EARTH_MEASUREMENT,
};

/** 魔法世界：在物理之上叠加魔力本体规则 */
export const MAGIC_LAWS: WorldLaws = {
  id: "magic",
  name: "魔法世界",
  physics: {
    food_per_capita: 1,
    pop_growth_base: 0.02,
    military_per_pop: 0.002,
    military_tech_mult: 0.5,
    stability_recovery: 0.02,
    stability_decay: 0.05,
    overpopulation_pressure: 0.05,
    metaphysics: { mana: 70 },
  },
  rules: [
    "魔法的使用必须消耗等价能量（魔力）。",
    "起死回生不可能发生。",
    "魔力浓度随距离灵脉衰减。",
  ],
  narrative: ["魔力是这个世界除物理外的第二力量，施法者地位取决于对魔力的掌控。"],
  ontology: ["魔网覆盖大陆，节点处浓度高。", "魔力消耗等价能量。", "存在禁忌咒术。"],
  spatial_scale: "类地球大陆",
  measurement_system: EARTH_MEASUREMENT,
};

/** 真气世界：修仙/修真体系, 灵气为本体规则 */
export const QI_LAWS: WorldLaws = {
  id: "qi",
  name: "真气世界",
  physics: {
    food_per_capita: 1,
    pop_growth_base: 0.015,
    military_per_pop: 0.002,
    military_tech_mult: 0.5,
    stability_recovery: 0.02,
    stability_decay: 0.05,
    overpopulation_pressure: 0.05,
    metaphysics: { qi: 80 },
  },
  rules: [
    "修炼需要天地灵气。",
    "境界越高寿命越长，但突破有失败代价。",
    "灵气枯竭之地无法修炼。",
  ],
  narrative: ["凡人之上是修士，宗门掌握灵气福地，主宰世俗权力。"],
  ontology: ["天地灵气潮汐存在。", "境界体系：炼气→筑基→金丹→元婴。", "灵气福地稀缺。"],
  spatial_scale: "类地球大陆",
  measurement_system: EARTH_MEASUREMENT,
};

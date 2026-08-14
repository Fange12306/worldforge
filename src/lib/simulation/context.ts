/**
 * 信息传播延迟 (§5.1) + 注意力分层 (§6) — agent 看到什么、推演多深。
 *
 * 对应 SIMULATION_DESIGN.md：
 * - §5.1 同步广播：不是全知广播。每个实体 agent 收到的"世界信息"是**延迟 + 局部**的。
 *   - 邻接实体：近实时（延迟 ≈ 1-2 tick）。
 *   - 全球事件：延迟 infoDelay tick，且只广播结构性事件。
 *   - 远方：只有"传闻级"摘要，可信度低。
 *   - 信息延迟 ≠ 不知道自己实体的历史：自身已锁定历史始终完整注入。
 * - §6 注意力分层：没有硬性数量上限，但推理资源不平均分配。
 *   active_score = f(内部动荡, 冲突强度, 技术/制度变化率, 与热点邻接)
 *   hotspot=4x / regular=1x / longtail=0.2x
 */

import { naturalizeDecree } from "./decree.ts";
import { eraDensityCap, marchTicksTo, populationDensity, regionAreaKm2 } from "./scale.ts";
import { adminCapacityFor, developmentLevel } from "./physics.ts";
import { awareness, awarenessTier, tierLabel, type AwarenessTier } from "./space.ts";
import { nameFor } from "./geography.ts";
import { loreFactsFor } from "./lore.ts";
import type {
  ActiveLevel,
  EntityCard,
  SimulationConfig,
  SimulationEvent,
  SimulationSession,
} from "./types.ts";

// ── 信息传播延迟 (§5.1) ───────────────────────────────

export type EntityKnowledge = {
  /** 自身已锁定历史（始终完整, §5.1） */
  ownHistory: SimulationEvent[];
  /** 邻接实体近实时动态（延迟 ≈ 1-2 tick） */
  neighborNews: { event: SimulationEvent; entity: string; delay: number }[];
  /** 全球事件（延迟 infoDelay tick, 只广播结构性事件） */
  globalNews: SimulationEvent[];
  /** 远方传闻（延迟更久, 可信度低） */
  distantRumors: SimulationEvent[];
  /** 我方对其他实体的感知认知（传递性, §5.1 距离衰减） */
  awareEntities: { entity: string; awareness: number; tier: AwarenessTier }[];
};

/**
 * 为单个实体装配其"可见的世界"。
 * 按 infoDelay 截取事件窗口，按邻接关系过滤，自身历史完整注入。
 */
export function buildEntityKnowledge(
  session: SimulationSession,
  entity: EntityCard,
): EntityKnowledge {
  const config = session.config;
  const now = session.current_tick;

  // 自身历史：该实体参与的所有已发生事件（完整, 不受延迟影响）
  const ownHistory = session.events.filter(
    (e) => e.participants.includes(entity.id) && e.tick <= now,
  );

  // 邻接实体：近实时（1-2 tick 延迟）——保留近 2 tick 内的事件
  const neighborIds = new Set(entity.geography.neighbors);
  const neighborNews: EntityKnowledge["neighborNews"] = [];
  for (const ev of session.events) {
    if (ev.tick > now || ev.tick < now - 2) continue; // 只保留近 2 tick 内的邻接事件
    const neighborParticipant = ev.participants.find((p) => neighborIds.has(p));
    if (neighborParticipant) {
      neighborNews.push({ event: ev, entity: neighborParticipant, delay: now - ev.tick });
    }
  }

  // 全球事件：延迟 infoDelay tick。广播哪些事件由事件的 major 语义标志决定（LLM/生成器判断,
  // 引擎不预设类型表）——major=true 的结构性/重大事件进全球广播, 其余进远方传闻。
  const globalNews = session.events.filter(
    (e) => e.tick <= now - config.infoDelay && e.major === true,
  );

  // 远方传闻：延迟更久（infoDelay * 2），非 major 事件的摘要
  const distantRumors = session.events.filter(
    (e) => e.tick <= now - config.infoDelay * 2 && e.major !== true,
  ).slice(-10);

  // 感知认知（传递性, §5.1 距离衰减）：我方对其他实体的感知强度 + 分层
  const awareEntities: EntityKnowledge["awareEntities"] = [];
  for (const [tid, t] of Object.entries(session.entities)) {
    if (tid === entity.id) continue;
    if (t.status !== "active") continue;
    const a = awareness(entity, tid, session);
    if (a >= 0.03) {
      awareEntities.push({ entity: tid, awareness: Math.round(a * 100) / 100, tier: awarenessTier(a) });
    }
  }
  awareEntities.sort((x, y) => y.awareness - x.awareness);

  return { ownHistory, neighborNews, globalNews, distantRumors, awareEntities };
}

// ── 注意力分层 (§6) ──────────────────────────────────

export type AttentionBudget = {
  level: ActiveLevel;
  activeScore: number;
  /** 相对 token 预算（hotspot=4x, regular=1x, longtail=0.2x） */
  tokenMultiplier: number;
};

/**
 * 计算实体活跃度评分（§6）：
 * active_score = f(内部动荡, 冲突强度, 技术/制度变化率, 与热点邻接)
 */
export function computeActiveScore(
  entity: EntityCard,
  session: SimulationSession,
): number {
  // 内部动荡：稳定度/合法性越低越动荡
  const instability = (100 - entity.metrics.stability) / 100;
  const illegitimacy = (100 - entity.metrics.legitimacy) / 100;
  const internal = instability * 0.4 + illegitimacy * 0.3;

  // 冲突强度：由关系上的 hostility(0-1, LLM 判定) 均值估计, 不靠 stance 枚举
  const hostilities = entity.relations.map((r) => r.hostility ?? 0);
  const avgHostility = hostilities.length ? hostilities.reduce((a, b) => a + b, 0) / hostilities.length : 0;
  const conflict = Math.min(1, avgHostility) * 0.3;

  // 技术/制度变化率：近期 tech 增量（通过 recent_events 判断）
  const hasChange = entity.internal.recent_events.length > 0 ? 0.1 : 0;

  // 与热点邻接
  const neighborHot = entity.geography.neighbors
    .map((n) => session.entities[n])
    .filter((e) => e && e.active_level === "hotspot").length;
  const adjacency = Math.min(1, neighborHot / 2) * 0.2;

  return Math.min(1, internal + conflict + hasChange + adjacency);
}

/**
 * 按活跃度分档（§6）：
 * - hotspot: activeScore >= 0.5
 * - regular: activeScore >= 0.2
 * - longtail: < 0.2
 */
export function classifyAttention(score: number): AttentionBudget {
  if (score >= 0.5) return { level: "hotspot", activeScore: score, tokenMultiplier: 4 };
  if (score >= 0.2) return { level: "regular", activeScore: score, tokenMultiplier: 1 };
  return { level: "longtail", activeScore: score, tokenMultiplier: 0.2 };
}

/** 为实体分配 token 预算（§6: perEntity × 档位倍率; hotspot 用 config 的 hotspotMultiplier） */
export function entityTokenBudget(config: SimulationConfig, attention: AttentionBudget): number {
  // §3.4 hotspotMultiplier 生效: hotspot 倍率来自 config, 而非硬编码 4
  const multiplier = attention.level === "hotspot"
    ? (config.budget.hotspotMultiplier ?? 4)
    : attention.tokenMultiplier;
  return Math.round(config.budget.perEntity * multiplier);
}

/** 全局每 tick token 预算是否超限 */
export function checkGlobalBudget(config: SimulationConfig, used: number): boolean {
  return used <= config.budget.perTickGlobal;
}

// ── agent 输入装配 (§5.2) ─────────────────────────────

export type AgentInput = {
  system: string;
  user: string;
};

/** 把某指标的环形历史压成一行走势描述: "人口 120万→118万→115万 (近3年 -4%)"。
 * 供 agent/稀有事件看到趋势而非当前快照。 */
export function metricTrendLine(
  entity: EntityCard,
  key: keyof EntityCard["metrics"],
  n = 10,
): string {
  const hist = entity.history ?? [];
  const window = hist.slice(-n);
  if (window.length < 2) return ""; // 不足 2 个快照, 无趋势可谈
  const label: Record<string, string> = {
    population: "人口", food: "粮食", economy: "经济", military: "军力",
    legitimacy: "合法", stability: "稳定",
  };
  const name = label[key] ?? key;
  const first = window[0].metrics[key] as number;
  const last = window[window.length - 1].metrics[key] as number;
  const trend = last - first;
  const dir = trend > 0 ? "上升" : trend < 0 ? "下降" : "持平";
  const pct = first !== 0 ? Math.round((trend / Math.abs(first)) * 100) : 0;
  const series = window.map((s) => formatMetric(key, s.metrics[key] as number)).join("→");
  return `${name} ${series} (近${window.length}个记录, ${dir} ${pct >= 0 ? "+" : ""}${pct}%)`;
}

function formatMetric(key: keyof EntityCard["metrics"], v: number): string {
  if (key === "population") return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`;
  if (key === "military") return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`;
  return `${v}`;
}

/**
 * 装配一个实体的 agent 输入（§5.2）：
 * System = 世界模型全景摘要 + 推演参数 + 输出契约
 * User = 实体卡片 + 邻接关系 + 延迟窗口事件 + 上次产出 + 未决议题 + 已生效干预
 */
export function buildAgentInput(
  session: SimulationSession,
  entity: EntityCard,
  knowledge: EntityKnowledge,
  attention: AttentionBudget,
): AgentInput {
  const system = [
    `你是 ${entity.name} 的执政者/历史推演器。`,
    `世界模型：${session.laws.name}（${session.laws.spatial_scale}）。`,
    ...(entity.identity.era ? [`时代：${entity.identity.era}——你的一切决策必须符合该时代的技术与制度水平。`] : []),
    `世界法则：${session.laws.rules.join("；")}`,
    `推演参数：randomness=${session.config.randomness}, surprise=${session.config.surprise}, rigor=${session.config.rigor}, 档位=${attention.level}。`,
    `输出格式契约：严格 JSON（decisions/events/metric_delta/tech_delta/values_delta/territory_claim/propose_dim/notes）。`,
    `**事件契约**: 每个事件 {type, description, major?: bool, target?, changes?}。type 是**自由文本标签**(1-4 字词概括事件类别, 如"边境会盟""运河开凿""王室决裂"), **结合时代与实体状态综合判断, 不预设类别**; 不要用"war/disaster/other"这类泛泛标签。major=true 表示结构性/重大事件(战争·征服·灭亡·分裂·建国·大迁移), 会被全文明知晓; 日常事务(农事/祭祀/小纠纷)major=false 或省略。changes 里若要表达"吞并某文明"用 absorbed_by, "建国/分裂"用 founded {name, from}, "灭亡"用 collapsed: true, "关系变化"用 stance(自由文本)+hostility(0-1 敌意)。`,
    `**数值一致性**: metric_delta/tech_delta/values_delta 里的数字会真实生效, 你的事件叙事必须与数字一致——说"人口锐减"就应给出对应的负 population delta; 说"丰收"就给正 food delta。不要只讲故事不改数字。`,
    `**发展维度约束**: 下方实体卡片列出你当前拥有的发展维度（tech 键）。tech_delta 的键**只能来自这些已存在维度**, 不要发明新维度名。新的技术/制度/手法写进事件叙事即可, 若你认为某个方向已反复塑造你的发展、值得长期追踪, 用 propose_dim 提议（LLM 综合判断, 单次提议即可注册, 但**只在确需长期追踪时才提议**, 不要随手造新轴）。`,
    `**领土扩张**: 你可通过 territory_claim 扩张领土（迁居/拓荒/殖民/征服）。只能占「已领区划的相邻区域」或「你感知到的实体所在区域」; 区域 id 须用下方地理信息里给出的。若想在一个已领区划内细分出新地方, 提供 region=父区划 id + name=新地方名 + character=一句地形描述。扩张是历史性大动作, 不应每 tick 都发生。**治理上限约束**: 你的治理能力有限（下方「治理负载 X/Y 区划」, Y=你的发展水平决定的治理上限）。领土数达到上限后**不可继续扩张**, 应优先内部整合/深耕, 随发展水平提升上限才放宽——部落时代不可能统治几十个区划。`,
    `政体演化：当「政体演化关口」信号出现时, 你可通过 regime_evolution 决策——new_form 自由描述演化后的治理形态（不必套用任何既有的政体类别）, centralization_delta 表示集权度变化。**这是罕见的重大决策, 不是每 tick 都演化**: 大多数 tick 政体保持现状, 仅在组织/经济确实支撑质变时才演化。部落/氏族阶段即使信号出现也可选择不演化或小幅调整。`,
    `时间粒度：当前每 tick ${session.config.yearsPerTick ?? 10} 年。若你的文明发展节奏已明显变化（如从部落大跨度进入王朝频繁更迭/密集事件的时期, 或反之进入长期稳定）, 可通过 suggest_years_per_tick 建议新的每 tick 年数（正整数）——节奏越快粒度越细, 稳定期可粗。由你结合世界状态判断, 无固定规则。`,
    `**一致性约束（你的所有产出必须与下列状态严格一致, 不可冲突）**:
- 累计历史(我方已发生历史): 事件必须建立在已发生历史上, 不能与已确定事实矛盾。
- 当前状态(指标/组织复杂度/领土/制度): 制度与技术必须与你当前的组织复杂度相称——低组织复杂度(如 30)的部落不能出现"专营司/铸造厂/学术机构/立法会"这类需要复杂官僚支撑的制度; 事件描述的现实设施应与你当前组织能力匹配。
- **时代语言(严格)**: 你的事件描述、术语、设施必须**完全契合当前时代**。部落/氏族时代只能用符合该时代的技术与词汇——石斧/骨器/陶器/聚落/祭坛/氏族/长老/巫师, 不能用任何后世才有的东西(文字法典/铸币/盐引/印刷/火炮/宫殿/职业官僚/科举/票号/典当行/律令)。衡量标准: 你描述的任何设施或制度, 都必须能在你当前的组织复杂度下真实存在。若你不确定, 用更朴素、更早的措辞。
- 地理现实(你的领土/当前区域): 事件必须发生在你控制的地理范围内, 与区域地形相符——沙漠不能出现船厂, 内陆不能出现海港, 你控制的范围决定你能发生什么。
- 感知范围(我方对其他实体的认知): 你**只能**与认知列表中列出的实体互动。未列出的文明对你而言不存在, 不得在事件中凭空引入"使团/学者/贸易接触/联姻"等未感知实体的互动。若要与某实体互动, 事件的 target 必须是认知列表中实体的 id。`,
  ].join("\n");

  const user = [
    `# 我的实体卡片（当前完整状态）`,
    `名称: ${entity.name} | 种族: ${entity.identity.species} | 政权: ${entity.identity.political_form}`,
    `指标: 人口=${entity.metrics.population} 军力=${entity.metrics.military} 稳定=${entity.metrics.stability} 合法=${entity.metrics.legitimacy} 经济=${entity.metrics.economy ?? 0} 粮食=${entity.metrics.food}`,
    ``,
    `# 近期走势（过去 ${Math.min((entity.history ?? []).length, 10) || 1} 个记录, 趋势方向, 事件叙事应与之一致）`,
    ...["population", "food", "stability", "economy"].map((k) => {
      const line = metricTrendLine(entity, k as keyof EntityCard["metrics"]);
      return line ? `- ${line}` : null;
    }).filter(Boolean) as string[],
    `发展维度（仅这些可调整, 不要新增维度键）: ${Object.keys(entity.tech).join("、") || "(无)"}`,
    `维度数值: ${JSON.stringify(entity.tech)}`,
    `理念: ${JSON.stringify(entity.values)}`,
    `发展水平: ${developmentLevel(entity)}（0-100, 综合技术+组织）· 治理负载 ${(entity.territory ?? [entity.geography.region]).length}/${adminCapacityFor(entity)} 区划`,
    ...scaleSummary(entity, session),
    entity.regime ? `政体信号: 组织复杂度=${Math.round(entity.regime.organizational_complexity)} 集权度=${Math.round(entity.regime.centralization)} 经济支撑力=${entity.regime.economic_base}` : "",
    entity.regime?.evolve_signal ? `⚠ 政体演化关口: ${entity.regime.evolve_reason}（可决策是否演化, 及演化成什么形态——自由描述, 不必套用任何既有的政体类别）` : "",
    ``,
    `# 世界已确定事实（与你/你的区域相关, 不可违反, 只能在其上推演）`,
    ...(() => {
      const relevant = loreFactsFor(session, entity);
      return relevant.length > 0 ? relevant.map((f) => `- ${f.content}`) : ["- (无)"];
    })(),
    ``,
    `# 我方对其他实体的认知（空间传递性, 距离越远感知越弱）`,
    ...knowledge.awareEntities.map((a) => {
      const name = session.entities[a.entity]?.name ?? a.entity;
      return `- ${name}: ${tierLabel(a.tier)}`;
    }),
    ...(knowledge.awareEntities.length === 0 ? ["- (除自身外, 尚未感知到任何其他文明)"] : []),
    ``,
    `# 邻接实体动态（近实时）`,
    ...knowledge.neighborNews.map((n) => `- ${n.entity}: ${n.event.description}`),
    ``,
    `# 全球事件（延迟 ${session.config.infoDelay} tick）`,
    ...knowledge.globalNews.slice(-8).map((e) => `- [${e.type}] ${e.description}`),
    ``,
    `# 我方已发生历史（始终完整）`,
    ...knowledge.ownHistory.slice(-10).map((e) => `- [${e.type}] ${e.description}`),
    ``,
    `# 上次 tick 我的产出`,
    ...(entity.internal.recent_events.length ? entity.internal.recent_events.map((r) => `- ${r}`) : ["- (无)"]),
    ``,
    `# 待解决的未决议题`,
    ...entity.internal.active_issues.map((i) => `- ${i}`),
    ``,
    `# 已生效的用户干预（自然化为外部力量/天命, §5.5）`,
    ...session.decrees
      .filter((d) => d.verdict && ["accepted", "adjusted", "twisted"].includes(d.verdict!))
      .map((d) => `- ${naturalizeDecree(d)}`),
  ].join("\n");

  return { system, user };
}

/** 尺度摘要（§4.1 尺度合理性）— 让 agent 感知世界尺度: 面积/密度/行军时间 */
function scaleSummary(entity: EntityCard, session: SimulationSession): string[] {
  const region = session.regions?.[entity.geography.region];
  if (!region) return [];
  const world = session.laws;
  const area = regionAreaKm2(region, world);
  const density = populationDensity(entity, region, world);
  const cap = eraDensityCap(entity.tech["农业"] ?? 0, entity.regime?.organizational_complexity ?? 0);
  const militaryTech = entity.tech["军事"] ?? 0;
  // 领土: 控制区划 + 层级路径
  const territory = entity.territory ?? [entity.geography.region];
  const terrNames = territory.map((tid) => {
    const path = [tid];
    let p = session.geography?.[tid]?.parent ?? session.regions?.[tid]?.parent;
    const guard = new Set<string>();
    while (p && (session.geography?.[p] || session.regions?.[p]) && !guard.has(p)) {
      guard.add(p);
      path.unshift(p);
      p = session.geography?.[p]?.parent ?? session.regions?.[p]?.parent;
    }
    return path.map((uid) => nameFor(session, uid, entity.id)).join(" / ");
  });
  // 当前区域地形(character)
  const terrainDesc = region.character
    ? `内部地形: ${region.character}`
    : `地形: ${region.biome}`;
  const lines = [
    ``,
    `# 地理信息（当前所处世界, 事件必须与此一致）`,
    `你的领土: ${terrNames.join("、") || entity.geography.region}`,
    `当前所在区域「${nameFor(session, region.id, entity.id)}」: ${terrainDesc}`,
    `尺度: 面积约 ${Math.round(area).toLocaleString()} 平方公里, 人口密度约 ${Math.round(density)} 人/km²（该时代合理上限约 ${cap} 人/km²${density > cap ? ", 已超载" : ""}）。`,
  ];
  // 区域形态（shape/position, 自然语言, 不代入公式）——让 agent 感知"狭长河谷/半岛"与"位于父级何处"
  const shapeBits: string[] = [];
  if (region.shape) shapeBits.push(`形状: ${region.shape}`);
  if (region.position) shapeBits.push(`位于: ${region.position}`);
  if (region.parent) {
    const pname = nameFor(session, region.parent, entity.id);
    if (!region.position) shapeBits.push(`属于: ${pname}`);
    else shapeBits[shapeBits.length - 1] = `${shapeBits[shapeBits.length - 1]}, 属${pname}`;
  }
  if (shapeBits.length > 0) lines.push(`区域形态: ${shapeBits.join("; ")}`);
  // 相邻区域: 方位 + 连接通道 + 行军（用区域级邻居, 不依赖实体邻居过滤）。
  // 海洋邻居标注"海洋"; 海洋区域本身标注相邻陆地(borders_land)。
  const nbrs = (region.neighbors ?? [])
    .map((nid) => {
      const nregion = session.regions?.[nid];
      // biome 直接含 ocean/海/洋 → 海洋(不能用 inferBiome, 它把 ocean 归一化成 coast)
      const isOcean = !!nregion?.biome && /ocean|海|洋|sea|bay|island|岛|湾/.test(String(nregion.biome).toLowerCase());
      const conn = region.connections?.[nid];
      const pos = conn
        ? `${conn.direction ? `${conn.direction}侧` : ""}${conn.via ? `, 经${conn.via}` : ""}`
        : "";
      const ticks = marchTicksTo(region, nid, world, militaryTech, session.config.yearsPerTick);
      const dist = ticks === Infinity ? "距离未知" : `约 ${ticks < 1 ? ticks.toFixed(2) : Math.round(ticks)} tick 行军`;
      const kind = isOcean ? "（海洋）" : "";
      return `- ${nameFor(session, nid, entity.id)}${kind}${pos ? `(${pos.trim()})` : ""}: ${dist}`;
    });
  if (nbrs.length > 0) lines.push(`相邻区域（含方位与连接通道）:`, ...nbrs);
  // 当前区域是海洋 → 标注相邻陆地
  if (/ocean|海|洋|sea/.test(String(region.biome).toLowerCase()) && (region.borders_land?.length ?? 0) > 0) {
    const landNames = region.borders_land!.map((lid) => nameFor(session, lid, entity.id)).join("、");
    lines.push(`海域相邻陆地: ${landNames}`);
  }
  return lines;
}

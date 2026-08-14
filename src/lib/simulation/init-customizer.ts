/**
 * 初始状态定制器 — 用户自由文本指定任意要素 → 解析 → 冲突检测 → 补全。
 *
 * 流程（用户确认的设计）：
 * 1. 用户自由文本描述想要的要素（大陆/区域/种族/文明/信仰/关系/关键设定...）。
 * 2. LLM 解析 → 结构化初始状态（实体/区域/法则/关系）。
 * 3. 确定性冲突检测 → 硬冲突（重叠区域/矛盾法则/超越尺度）报给用户或让 LLM 调整。
 * 4. LLM 补全 → 用户没定的部分（其他区域/种族/气候/生态/度量）自动生成。
 * 5. 生成完整世界；用户指定的要素锁定（进背景规则库, 细化即锁定）。
 *
 * 关键: 用户指定优先且锁定, LLM 只在空隙补全。
 */

import { parseJSONFromLLM, safeCall, type LLMBindings } from "./llm.ts";
import { makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { generateWorldLanguages } from "./culture.ts";
import { derivePoliticalForm, deriveReligion, deriveIdeology } from "./regime.ts";
import { awareness } from "./space.ts";
import type { Culture, EntityCard, LanguageSystem, SimulationSession, SpaceRegion, Stance, WorldLaws } from "./types.ts";
import type { Rng } from "./random.ts";

// ── 初始化链路可观测（trace）───────────────────────────
// 每次初始化把每一步 LLM 调用的输入/原始返回/解析结果/统计写盘(init-trace.jsonl),
// 供排查"区域平铺/实体挤一区/多出物种"等初始化问题——不再黑盒静默降级。

export type InitTraceEntry = {
  step: string;                        // parse / world / regions / entities / toSession
  time: string;
  ok: boolean;
  /** LLM 调用是否真实发生 */
  calledLLM: boolean;
  /** 该步骤的输入摘要（用户文本 / parsed 局部） */
  inputExcerpt: string;
  /** LLM 原始返回（截断, 含完整对排查最重要） */
  responseExcerpt: string;
  error?: string;
  /** 结果统计: 供判断"区域平铺/分层/实体绑定" */
  stats?: {
    regions?: number;
    layer0?: number;          // 顶层区域数
    leaf?: number;            // 叶子(有 parent)区域数
    entities?: number;
    boundToLeaf?: number;     // regionId 指向叶子的实体数
    invalidRegionId?: number; // regionId 非法/缺失的实体数
    relations?: number;
    measurement?: boolean;
  };
};

export type InitTraceCb = (entry: InitTraceEntry) => void;

/** 截断字符串到 N 字符（含省略标记） */
const excerpt = (s: string | undefined, n = 200): string => {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/** 完整响应（不截断, 对排查解析错误最关键——截断会把完整 JSON 变成残片导致误导） */
const full = (s: string | null | undefined): string => s ?? "(无返回/调用失败)";

// ── 结构化初始状态 ────────────────────────────────────

export type ParsedInitialState = {
  /** 用户指定的世界法则（rules/narrative） */
  laws: {
    rules: string[];
    narrative: string[];
    ontology: string[];
  };
  /** 用户指定的区域 */
  regions: Array<{
    id: string;
    name: string;
    biome: string;
    /** 相邻区域 id（基于空间全景的邻接, §4.0②）——补全时建立完整空间拓扑 */
    neighbors?: string[];
    /** 位置关系: neighborId → 方位(direction: 东/西/南/北/东北...) + 连接通道(via: 山谷/山口/河流/海峡/陆桥...) */
    connections?: Record<string, { direction?: string; via?: string }>;
    /** 父区划 id（层级: 次大陆→恒河平原→中游。不设 = 顶层区划） */
    parent?: string;
    /** 一句话自然语言描述内部地形混合("主体冲积平原, 东北丘陵"——非百分比) */
    character?: string;
    /** 占父级比例(0-1, LLM 综合判断)。顶层=占世界大陆比例。部落文明所辖区域占比明显小 */
    share?: number;
    /** 大概形状(自然语言): "狭长河谷/盆地/半岛" */
    shape?: string;
    /** 位于父级的位置(自然语言): "华北平原东部" */
    position?: string;
    /** 海洋区域的相邻陆地区域 id（LLM 补全海洋层级时给出） */
    borders_land?: string[];
    /** 用户指定的关键地理特征 */
    description?: string;
  }>;
  /** 用户指定的实体（文明/种族） */
  entities: Array<{
    name: string;
    species: string;
    regionId?: string;
    politicalForm?: string;
    religion?: string;
    ideology?: string;
    /** 与其他实体的结构化关系（target=实体名, stance 见 design §3.1） */
    relations?: Array<{ target: string; stance: string; note?: string; hostility?: number }>;
    /** 关键设定（约束） */
    constraints?: string[];
    /** 初始人口（LLM 结合时代/区域承载/文明规模综合判断, 非公式）——部落时代通常数千到数十万 */
    population?: number;
  }>;
  /** 用户指定的度量单位 */
  measurement?: {
    lengthUnit?: string;
    lengthToSI?: number;
    worldWidth?: number;
    worldHeight?: number;
  };
  /** 用户指定的文化/语言偏好 */
  cultures?: Array<{
    name: string;
    languageName?: string;
    script?: string;
  }>;
  /** 用户明确提到要排除的（如"没有魔法"） */
  exclusions?: string[];
};

// ── 1. LLM 解析 ───────────────────────────────────────

const PARSE_SYSTEM = `你是架空世界的初始设定解析器。用户会用自由文本描述他想要的世界要素（大陆、区域、种族、文明、信仰、关系、关键设定等）。

把用户描述解析成严格 JSON（ParsedInitialState），遵循：
- 只提取用户明确说的内容，不要自己编造补全（补全在后续步骤）。
- regions: 每个被提到的区域一个条目。id 用英文 slug。若用户提到相邻关系（"东部接海""与兽人领地相邻"），填入 neighbors（区域 id 数组）。若用户提到某区域是大区划的一部分（如"恒河平原在印度""恒河三角洲是恒河平原的下游"），填入 parent（父区划 id）。
- entities: 每个被提到的文明/种族/实体一个条目。
  - **用户明确列举的物种（如"演化出人类、精灵、兽人、矮人"）必须每个提取为一个 entity**——即使没有具体文明名, 每个物种名就是一条 entity（name=物种名, species=物种名）。**绝不能把它们当泛指分类丢弃, 绝不能返回空 entities 数组**。
  - name: 实体/文明的名称（如"精灵""兽人国""森林精灵部族"）。
  - species: 种族（人类/精灵/兽人/矮人/龙裔…）——**必须填**。若用户只说了种族名（如"精灵"），species 和 name 都填该种族名。
  - politicalForm: 政权形态——**自由描述, 不预设枚举**。从用户文本推断（如"部落""部族议事会""长老议会""游牧联盟""散居氏族"）。用户没说政体时省略（由后续默认）。
  - relations: 若用户描述了实体间关系（"与北方兽人常年战争""向精灵纳贡"），转成结构化数组 {target: 对方实体名, stance: 自由文本立场("战争""同盟""朝贡""敌对"...不预设枚举), hostility: 0-1 敌意(可选, 由你结合描述综合判断), note: 一句话说明}。
- laws.rules: 用户说的硬性规则（"必须""不能""禁止"）。narrative: 风格/价值观描述。ontology: 世界本体设定。
- measurement: **必填**——用户提到的度量单位/尺度（如"大陆宽 3000 公里"）。从用户描述推导尺度, 与世界的描述一致（类地行星/地球大小 → 行星尺度; 小世界 → 小尺度）。不要写死数值, 一切从用户描述推导。
- exclusions: 用户明确排除的东西（如"没有魔法""没有兽人"）。
- 若用户没提某个字段, 留空/省略。

输出严格 JSON 对象，不要 markdown 包裹外的内容。`;

/**
 * 用 LLM 把用户自由文本解析成结构化初始状态。
 * LLM 失败 → 返回 null（调用方降级为纯随机生成）。
 */
export async function parseUserDescription(
  text: string,
  llm: LLMBindings,
  onTrace?: InitTraceCb,
): Promise<ParsedInitialState | null> {
  const entry: InitTraceEntry = { step: "parse", time: new Date().toISOString(), ok: false, calledLLM: false, inputExcerpt: excerpt(text, 120), responseExcerpt: "" };
  const response = await safeCall(llm, {
    systemPrompt: PARSE_SYSTEM,
    userMessage: text,
    maxTokens: 2048,
    json: true,
  });
  entry.calledLLM = true;
  entry.responseExcerpt = excerpt(response ?? "(无返回/调用失败)", 400);
  if (!response) { entry.error = "LLM 无返回"; onTrace?.(entry); return null; }
  try {
    const parsed = parseJSONFromLLM<ParsedInitialState>(response);
    entry.ok = true;
    entry.stats = {
      regions: parsed.regions?.length,
      entities: parsed.entities?.length,
      relations: (parsed.entities ?? []).reduce((a, e) => a + (e.relations?.length ?? 0), 0),
      measurement: !!parsed.measurement,
    };
    onTrace?.(entry);
    return parsed;
  } catch (e) {
    entry.error = `解析失败: ${e instanceof Error ? e.message : String(e)}`;
    onTrace?.(entry);
    return null;
  }
}

// ── 2. 确定性冲突检测 ─────────────────────────────────

export type Conflict = {
  severity: "hard" | "soft";
  kind: string;
  description: string;
};

/**
 * 确定性冲突检测（不依赖 LLM, 硬校验）。
 * 硬冲突: 阻挡生成, 需用户/LLM 调整。
 * 软冲突: 提示但不阻挡（补全时处理）。
 */
export function detectInitialConflicts(parsed: ParsedInitialState): Conflict[] {
  const conflicts: Conflict[] = [];

  // 1. 实体区域重叠：两个实体占同一区域
  const regionUsers = new Map<string, string[]>();
  for (const e of parsed.entities) {
    if (!e.regionId) continue;
    const list = regionUsers.get(e.regionId) ?? [];
    list.push(e.name);
    regionUsers.set(e.regionId, list);
  }
  for (const [regionId, users] of regionUsers) {
    if (users.length > 1) {
      conflicts.push({
        severity: "hard",
        kind: "region_overlap",
        description: `区域「${regionId}」被多个实体占用: ${users.join("、")}（同一区域不应有多个主权实体）`,
      });
    }
  }

  // 2. 排除项与实体冲突：用户排除了某种族, 但指定了该种族
  for (const excl of parsed.exclusions ?? []) {
    for (const e of parsed.entities) {
      if (e.species.includes(excl) || excl.includes(e.species)) {
        conflicts.push({
          severity: "hard",
          kind: "exclusion_conflict",
          description: `用户排除了「${excl}」但指定了实体「${e.name}」（${e.species}）`,
        });
      }
    }
    for (const r of parsed.regions) {
      if (r.biome.includes(excl) || excl.includes(r.biome)) {
        conflicts.push({
          severity: "soft",
          kind: "exclusion_biome",
          description: `用户排除了「${excl}」但指定了区域「${r.name}」（${r.biome}）`,
        });
      }
    }
  }

  // 3. 法则矛盾：同一现象的两条规则互相矛盾（简化: 包含反义词的规则对）
  for (let i = 0; i < (parsed.laws.rules ?? []).length; i++) {
    for (let j = i + 1; j < (parsed.laws.rules ?? []).length; j++) {
      const a = parsed.laws.rules[i];
      const b = parsed.laws.rules[j];
      if (ruleContradicts(a, b)) {
        conflicts.push({
          severity: "hard",
          kind: "law_contradiction",
          description: `法则互相矛盾: 「${a}」 vs 「${b}」`,
        });
      }
    }
  }

  // 4. 尺度合理性：指定了尺度但明显不合理
  if (parsed.measurement?.worldWidth && parsed.measurement.worldWidth < 100) {
    conflicts.push({
      severity: "soft",
      kind: "scale_unrealistic",
      description: `大陆宽度 ${parsed.measurement.worldWidth}（单位？）过小, 可能不现实`,
    });
  }

  return conflicts;
}

/** 两条规则是否矛盾（含反义词对） */
function ruleContradicts(a: string, b: string): boolean {
  const antonymPairs: Array<[string, string]> = [
    ["有魔法", "没有魔法"], ["魔法存在", "没有魔法"], ["存在", "不存在"], ["允许", "禁止"],
    ["永生", "不能永生"], ["可以", "不可以"],
  ];
  return antonymPairs.some(([x, y]) =>
    (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)),
  );
}

// ── 3. LLM 补全 ───────────────────────────────────────

// ── 3. LLM 补全（单次调用, 一次成型, 与 LLM 输出完全一致）──
// 用户要求"完全一致的效果"——不拆步、不拼接、不降级。
// 单次 LLM 调用补全完整世界(区域分层+实体+法则+尺度), LLM 返回什么就是什么。
// 用健壮的括号匹配解析(parseJSONFromLLM)处理 LLM 各种输出格式(代码块/嵌套数组/对象包裹)。

// ── 分层生成: 按依赖拆 4 层, 每层输出小不截断, 层间传上一层实际输出 ──
// 用户洞察: "为什么不分层返回? 看哪些能最先生成、哪些依赖之前生成的和上下文。"
// 每层 prompt 都带 JSON 示例(DeepSeek 硬性要求: prompt 缺 "json"/示例会卡住请求)。

const COMMON_RULES = `**用户原文是唯一权威输入。** 用户明确指定的内容（物种、大陆、尺度、时代、法则）必须**原样保留、不得替换、不得丢弃、不得凭空新增替代品**。
一切从用户原文推导, 推出来的世界必须彼此自洽、与原文一致。
**区域 id 用英文 slug, name 用中文**（如 {id: "silverbirch-forest", name: "银桦森林"}）。**禁用中文 id**。
**区域 name 用纯自然地理名, 禁止政治/政权含义**: 叫"银桦森林""恒河平原", 不叫"北境王国"。
**name 用具体地理名, 禁用"平原腹地/东域"这类泛称**。
**character 一句话描述内部地形混合**(自由文本, 禁百分比): "主体冲积平原, 东北丘陵, 沿河沼泽"。
**share 给相对父级的占比(0-1)**: 顶层给占世界的比例, 有父给占父级比例, 父子自洽(子 share 和 ≤ 1, 顶层含海洋全部区域 share 和 = 1)。**share 从用户描述推导**——海洋占世界的比例、大陆的大小、文明占据区划的份额, 都从用户描述与文明规模推导, 不自造数值。
**shape 一句大概形状**; **position 位于父级何处**; **connections 记录相邻区域方位与连接通道**。
**海洋分层级**(若世界有海洋): 大洋(layer0, biome="ocean") → 边缘海(layer1) → 海域(layer2)。每个海洋给 **borders_land**(相邻陆地区域 id 数组)。
**岛屿归陆邻海**: 岛的 parent 指向所属陆地大区划, 但 neighbors 指向海洋区域; 岛 biome 用实际地形(forest/plains/coast 等)。
**类地行星/地球大小 → 多大陆 + 海洋 + 区域分层**: 推导出多个大陆(非单大陆平铺), 大陆间有海洋, 每个大陆内按文明规模分层(大陆→大区划→子区划)。一切从用户描述推导。`;

const SKELETON_SYSTEM = `你是架空世界的缔造者。用户给出世界的种子（原始设定文本）。你**从这颗种子推导世界骨架**: 世界法则、尺度、以及大陆/海洋顶层区域（layer 0）。

${COMMON_RULES}

本层只输出**顶层大陆/海洋**(layer 0, parent 为 null) + 法则 + 尺度。**子区划和实体在后续步骤生成, 本层不做。**
- laws: 从原文推导 rules(硬规则)/narrative(风格价值观)/ontology(本体设定)。
- measurement: 必填。从用户描述推导世界尺度（类地行星/地球大小 → 行星尺度; 大陆世界 → 大陆尺度; 小世界 → 小尺度）。**一切从用户描述推导, 不自造数值。**
- regions: 只输出 layer0(大陆/海洋), 每个含 id/name/biome/share/shape/position/connections/borders_land。多大陆之间用海洋隔开。**陆地与海洋的比例、大陆的数量与大小, 完全从用户描述推导并自洽**——若用户说"类地行星、地球大小", 应参考真实地球的陆地海洋比例与大陆尺度; 若用户说"单块大陆", 则无海洋或仅沿海。

输出严格 JSON 对象, 不要 markdown 包裹。示例:
{"laws":{"rules":["起死回生不可能发生。"],"narrative":["多种族并存的部落时代"],"ontology":["类地行星"]},"measurement":{"lengthUnit":"公里","worldWidth":2000,"worldHeight":1500},"regions":[{"id":"aurelia","name":"奥雷利亚大陆","biome":"mixed","share":0.6,"shape":"不规则大陆","position":"大陆中部","connections":{},"borders_land":[]},{"id":"endor-sea","name":"恩多尔海","biome":"ocean","share":0.4,"shape":"沿海水体","position":"大陆东侧","connections":{},"borders_land":["aurelia"]}]}`;

const SUBREGIONS_SYSTEM = `你是架空世界的缔造者。用户给出世界种子, 并已生成**顶层大陆/海洋**(下方列出)。你在这些顶层区域下**补充分区划**(layer 1+), 按文明规模分层。

${COMMON_RULES}

- 每个子区划的 **parent 必须是下方已存在区域的 id**, 不得引用不存在的区域。
- 在顶层区域下生成子区划, **层级深度与区域划分完全从用户描述推导**——用户说"类地行星、地球大小、部落时代", 就据此推导出合理的分层与文明地盘大小。不预设固定层数, 一切从用户描述推导。
- 岛屿(parent 归陆, neighbors 邻海)也在此层生成。
- 顶层区域本身不要重复输出。

输出严格 JSON 对象。示例: {"regions":[{"id":"aurelia-central","name":"晨曦平原","parent":"aurelia","biome":"plains","share":0.2,"shape":"冲积平原","position":"大陆中部","connections":{},"borders_land":[]}]}`;

const ENTITIES_SYSTEM = `你是架空世界的缔造者。用户给出世界种子, 并已生成**完整区域树**(下方列出)。你在这些区域上生成**文明/种族实体**。

${COMMON_RULES}

- **用户原文中明确提到的物种必须出现**（用户说"演化出人类、精灵、兽人、矮人", 这四个物种就都要出现在最终实体里, species 用原文物种名）。**实体数量、每个实体控制哪块区域, 完全从用户描述与文明规模推导**——不预设个数, 不机械复制, 一切从用户输入出发。
- **若下方 regionId 列表为空但原文提到物种, 也必须从原文恢复这些物种为实体**。
- 每个实体: name(文明/种族名), species(从原文推断的种族名, 如"人类"; 若实体名就是物种名则二者相同), regionId(**只能从下方已生成区域里选, 不得引用不存在的区域**), population(正整数), politicalForm(自由描述)。

输出严格 JSON 对象。示例: {"entities":[{"name":"晨曦部族","species":"人类","regionId":"aurelia-central","politicalForm":"部落","population":50000},{"name":"精灵","species":"精灵","regionId":"silverbirch-forest","politicalForm":"部族议会","population":30000}]}`;

const RELATIONS_SYSTEM = `你是架空世界的缔造者。用户给出世界种子, 并已生成**实体列表**(下方列出)。你为这些实体建立**相互关系**。

${COMMON_RULES}

- 关系必须基于**下方已存在的实体**（target 用实体 name）, 不得引用不存在的实体。
- 相邻文明间有往来/冲突; 每个实体给 1-3 条关系, 与时代/空间自洽（部落时代: 资源争夺/古老盟约/贸易网络）。
- stance 自由文本(战争/同盟/朝贡/敌对/互市...); hostility 0-1 敌意。

输出严格 JSON 对象。示例: {"relations":[{"from":"晨曦部族","target":"精灵","stance":"互市","note":"交换盐与木材","hostility":0.2}]}`;

/**
 * 每层自洽校验: 把(用户原文 + 该层输出)喂给校验 LLM, 让它对照原文检查该层是否自洽
 * （同名实体、文明规模vs地盘、区域层级、引用一致性、share自洽）, 输出修正版。
 * 返回修正后的同结构对象; 校验失败 → 返回原输出（不阻塞）。
 */
async function verifyLayer<T>(
  step: string,
  seedText: string,
  layerOutput: T,
  llm: LLMBindings,
  schemaHint: string,
  onTrace?: InitTraceCb,
): Promise<T> {
  const verifySystem = `你是架空世界的自洽校验者。用户给出世界种子, 并已生成某一层（${schemaHint}）。你**对照用户原文, 检查该层输出是否自洽**, 若发现问题就修正。

检查点（结合用户原文判断, 不预设死规则）:
- 同名实体/区域: 多个实体同名（如多个"人类"）→ 区分命名。
- 文明规模 vs 地盘: 几万人口的部落不应占据庞大区域 → 与文明规模相称。
- 区域层级: 是否足够深以承载文明地盘。
- 引用一致性: regionId/parent/target 必须指向真实存在。
- share/面积自洽: 父子 share 和, 陆地+海洋比例。

**若发现问题, 输出修正后的完整该层 JSON（同结构）; 若无问题, 原样输出。** 不要解释, 只输出 JSON。`;

  const response = await safeCall(llm, {
    systemPrompt: verifySystem,
    userMessage: `# 用户原文（权威, 一切以其为准）\n${seedText}\n\n# 该层输出（检查是否自洽, 修正则输出修正版）\n${JSON.stringify(layerOutput, null, 2)}`,
    maxTokens: 4000,
    json: true,
  });
  if (!response) return layerOutput;
  try {
    const verified = parseJSONFromLLM<T>(response);
    onTrace?.({
      step: `verify-${step}`,
      time: new Date().toISOString(), ok: true, calledLLM: true,
      inputExcerpt: `verify ${step}`, responseExcerpt: response.slice(0, 800),
    });
    return verified;
  } catch {
    return layerOutput; // 校验 LLM 输出非法 → 用原输出
  }
}

/**
 * 分层生成完整世界（4 层依赖感知, 每层小不截断）。
 * Step1 骨架(法则+尺度+大陆/海洋) → Step2 区域分层 → Step3 实体 → Step4 关系。
 * 每层用上一层实际输出作输入, 层间自洽; 每层失败降级(不阻塞整体)。
 * 每层生成后过一遍 LLM 自洽校验(verifyLayer)。
 * 返回合并后的完整 ParsedInitialState。
 */
export async function completeInitialState(
  parsed: ParsedInitialState,
  llm: LLMBindings,
  seedText?: string,
  onProgress?: (stage: string) => void,
  onTrace?: InitTraceCb,
): Promise<ParsedInitialState> {
  const seed = seedText?.trim() || "（无原始设定, 请按通用架空世界推导）";
  const seedBlock = `# 用户原始设定（唯一权威——整个世界必须从这里推导, 不得与之矛盾）\n${seed}\n`;
  const parsedBlock = `# 解析出的结构化参考（仅参考; 若与原文冲突, 以原文为准）\n${JSON.stringify(parsed, null, 2)}`;

  // Step 1: 世界骨架（法则 + 尺度 + 大陆/海洋顶层）
  onProgress?.("① 生成世界骨架（法则/尺度/大陆/海洋）...");
  const skeletonRaw = await safeCall(llm, { systemPrompt: SKELETON_SYSTEM, userMessage: `${seedBlock}\n\n${parsedBlock}`, maxTokens: 4000, json: true });
  onTrace?.({
    step: "complete-skeleton",
    time: new Date().toISOString(), ok: !!skeletonRaw, calledLLM: true,
    inputExcerpt: `seed: ${seed.slice(0, 60)}`, responseExcerpt: skeletonRaw?.slice(0, 1200) ?? "(无返回)", error: skeletonRaw ? undefined : "LLM 无返回",
  });
  let skeleton: Partial<ParsedInitialState> = {};
  if (skeletonRaw) { try { skeleton = parseJSONFromLLM<ParsedInitialState>(skeletonRaw); } catch { skeleton = {}; } }
  // 骨架自洽校验: 对照用户原文检查(大陆/海洋比例, share 自洽), LLM 输出修正版
  if (skeleton.regions?.length) {
    skeleton = await verifyLayer("skeleton", seed, skeleton, llm, "区域(大陆/海洋)+法则+尺度", onTrace);
  }
  const laws = skeleton.laws ?? parsed.laws ?? { rules: [], narrative: [], ontology: [] };
  const measurement = skeleton.measurement ?? parsed.measurement;
  // 骨架失败 → 回退用户已指定的区域（不留空, 不静默清空）
  const topRegions = (skeleton.regions?.length ? skeleton.regions : parsed.regions) ?? [];
  const skeletonStats = { regions: topRegions.length, layer0: topRegions.filter((r) => !r.parent).length };

  // Step 2: 区域分层（在已生成大陆/海洋下补子区划）
  onProgress?.("② 区域分层（按文明规模细分子区划）...");
  let subregions: NonNullable<ParsedInitialState["regions"]> = [];
  if (topRegions.length > 0) {
    const subRaw = await safeCall(llm, { systemPrompt: SUBREGIONS_SYSTEM, userMessage: `${seedBlock}\n\n# 已生成的大陆/海洋（parent 只能从这里选）\n${JSON.stringify(topRegions, null, 2)}`, maxTokens: 3000, json: true });
    onTrace?.({
      step: "complete-subregions",
      time: new Date().toISOString(), ok: !!subRaw, calledLLM: true,
      inputExcerpt: `topRegions: ${topRegions.length}`, responseExcerpt: subRaw?.slice(0, 1200) ?? "(无返回)", error: subRaw ? undefined : "LLM 无返回",
    });
    if (subRaw) { try { const p = parseJSONFromLLM<{ regions: NonNullable<ParsedInitialState["regions"]> }>(subRaw); subregions = p.regions ?? []; } catch { subregions = []; } }
  }
  // 合并区域树: 顶层 + 子区划
  let allRegions = mergeRegions(topRegions, subregions);
  // 区域自洽校验: 对照用户原文检查(层级深度/引用一致性/share), LLM 输出修正版
  if (allRegions.length) {
    const verified = await verifyLayer<{ regions: NonNullable<ParsedInitialState["regions"]> }>("regions", seed, { regions: allRegions }, llm, "区域树(含parent层级)", onTrace);
    if (verified.regions?.length) allRegions = verified.regions;
  }

  // Step 3: 实体（regionId 只能从已生成区域选）
  onProgress?.("③ 生成文明/种族...");
  let entities: NonNullable<ParsedInitialState["entities"]> = parsed.entities ?? [];
  const entRaw = await safeCall(llm, { systemPrompt: ENTITIES_SYSTEM, userMessage: `${seedBlock}\n\n# 已生成区域树（regionId 只能从这里选, 不存在的区域不可引用）\n${JSON.stringify(allRegions.map((r) => ({ id: r.id, name: r.name, parent: r.parent })), null, 2)}`, maxTokens: 3000, json: true });
  onTrace?.({
    step: "complete-entities",
    time: new Date().toISOString(), ok: !!entRaw, calledLLM: true,
    inputExcerpt: `regions: ${allRegions.length}`, responseExcerpt: entRaw?.slice(0, 1500) ?? "(无返回)", error: entRaw ? undefined : "LLM 无返回",
  });
  if (entRaw) { try { const p = parseJSONFromLLM<{ entities: NonNullable<ParsedInitialState["entities"]> }>(entRaw); entities = mergeEntities(entities, p.entities ?? []); } catch { /* 保留已解析实体 */ } }
  // 实体自洽校验: 对照用户原文检查(同名实体/文明规模vs地盘), LLM 输出修正版
  if (entities.length) {
    const verified = await verifyLayer<{ entities: NonNullable<ParsedInitialState["entities"]> }>("entities", seed, { entities }, llm, "实体(文明/种族, 含regionId/population)", onTrace);
    if (verified.entities?.length) entities = verified.entities;
  }

  // Step 4: 关系（基于已生成实体）
  onProgress?.("④ 建立文明间关系...");
  if (entities.length >= 2) {
    const relRaw = await safeCall(llm, { systemPrompt: RELATIONS_SYSTEM, userMessage: `${seedBlock}\n\n# 已生成实体（关系只能指向这些）\n${JSON.stringify(entities.map((e) => ({ name: e.name, species: e.species })), null, 2)}`, maxTokens: 2000, json: true });
    onTrace?.({
      step: "complete-relations",
      time: new Date().toISOString(), ok: !!relRaw, calledLLM: true,
      inputExcerpt: `entities: ${entities.length}`, responseExcerpt: relRaw?.slice(0, 1200) ?? "(无返回)", error: relRaw ? undefined : "LLM 无返回",
    });
    if (relRaw) {
      try {
        const p = parseJSONFromLLM<{ relations: Array<{ from: string; target: string; stance: string; note?: string; hostility?: number }> }>(relRaw);
        const rels = p.relations ?? [];
        const nameToId = new Map(entities.map((e) => [e.name, e]));
        for (const r of rels) {
          const from = nameToId.get(r.from);
          const target = nameToId.get(r.target);
          if (from && target && from.name !== target.name) {
            from.relations = from.relations ?? [];
            from.relations.push({ target: r.target, stance: r.stance, note: r.note, hostility: r.hostility });
          }
        }
      } catch { /* 关系失败不阻塞 */ }
    }
  }

  // 合并结果
  const finalStats = {
    regions: allRegions.length,
    layer0: allRegions.filter((r) => !r.parent).length,
    leaf: allRegions.filter((r) => r.parent).length,
    entities: entities.length,
    relations: entities.reduce((a, e) => a + (e.relations?.length ?? 0), 0),
    measurement: !!measurement,
  };
  onTrace?.({
    step: "complete-parsed",
    time: new Date().toISOString(), ok: true, calledLLM: false,
    inputExcerpt: "all layers done", responseExcerpt: "",
    stats: finalStats,
  });
  return {
    laws,
    regions: allRegions,
    entities,
    measurement,
    cultures: parsed.cultures,
    exclusions: parsed.exclusions,
  };
}

/** 合并区域: 用户区域优先(id 匹配保留用户定义), 补全邻接/连接/character; 新区域追加 */
function mergeRegions(
  user: ParsedInitialState["regions"],
  completed: ParsedInitialState["regions"],
): ParsedInitialState["regions"] {
  const userMap = new Map((user ?? []).map((r) => [r.id, r]));
  const out = [...(user ?? [])];
  for (const r of completed ?? []) {
    const existing = userMap.get(r.id);
    if (existing) {
      const idx = out.findIndex((x) => x.id === r.id);
      out[idx] = {
        ...existing,
        neighbors: existing.neighbors?.length ? existing.neighbors : (r.neighbors ?? existing.neighbors),
        connections: existing.connections ?? r.connections,
        character: existing.character ?? r.character,
        parent: existing.parent ?? r.parent,
        share: existing.share ?? r.share,
        shape: existing.shape ?? r.shape,
        position: existing.position ?? r.position,
        borders_land: existing.borders_land ?? r.borders_land,
      };
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * 合并实体: 按 species 匹配——parse 提取的物种实体(如"人类"无 population)
 * 吸收 LLM 补全的同物种实体(如"索利亚部落", species=人类, 有 population/regionId)的完整字段。
 * 这样用户明确的物种(人类/精灵/兽人/矮人)保留, 但拿的是 LLM 的完整版本,
 * 不会出现"parse 的'人类'缺 population"导致 initialStateToSession 抛错。
 * 名字不同的同物种实体, 用 LLM 的完整版本 + 用户指定的 name。
 */
function mergeEntities(
  user: ParsedInitialState["entities"],
  completed: ParsedInitialState["entities"],
): ParsedInitialState["entities"] {
  const userList = user ?? [];
  const compList = completed ?? [];
  const userMap = new Map(userList.map((e) => [e.name, e]));
  const out: ParsedInitialState["entities"] = [];
  const used = new Set<string>();

  // 优先: completed 实体(LLM 完整版)按 species 吸收用户字段
  for (const e of compList) {
    const existing = [...userList].find((u) =>
      u.name === e.name || (u.species && e.species && u.species === e.species),
    );
    used.add(existing?.name ?? e.name);
    if (existing) {
      out.push({
        ...existing,
        // LLM 的完整字段优先(有 population/regionId), 用户明确的字段保留
        name: existing.name ?? e.name,
        species: existing.species ?? e.species,
        regionId: e.regionId ?? existing.regionId,
        population: e.population ?? existing.population,
        relations: existing.relations?.length ? existing.relations : (e.relations ?? existing.relations),
        politicalForm: existing.politicalForm ?? e.politicalForm,
        religion: existing.religion ?? e.religion,
        ideology: existing.ideology ?? e.ideology,
      });
    } else {
      out.push(e);
    }
  }
  // 未被 completed 覆盖的用户实体(LLM 没生成该物种)→ 保留(可能缺 population, 由后续补)
  for (const u of userList) {
    if (!used.has(u.name)) out.push(u);
  }
  return out;
}

// ── 4. 应用到会话 ─────────────────────────────────────

export type CustomizedInitResult = {
  laws: WorldLaws;
  regions: Record<string, SpaceRegion>;
  entities: EntityCard[];
  languages: Record<string, LanguageSystem>;
  cultures: Record<string, Culture>;
  /** 用户指定的锁定要素（进背景规则库）。entityScope 让实体事实能被按实体 id 回读 */
  userSpecified: { scope: string; content: string; entityScope?: string }[];
  conflicts: Conflict[];
};

/**
 * 把补全后的初始状态转换为 createSession 可用的输入。
 * 纯确定性转换（不依赖 LLM）。
 * 完整保留用户指定要素: 区域邻接(§4.0②) + 实体邻居映射 + 关系/信仰/意识形态 + 约束锁定。
 */
export function initialStateToSession(
  completed: ParsedInitialState,
  rng: Rng,
  baseLaws: WorldLaws,
): CustomizedInitResult {
  // 区域: 用户指定的 + 补全的。补全区域邻接（空间拓扑, §4.0②）
  const regions: Record<string, SpaceRegion> = {};
  const regionDefs = completed.regions ?? [];
  if (regionDefs.length === 0) {
    // 用户没指定区域 → 用默认布局, 但应用用户可能的尺度
    const base = defaultRegions();
    for (const [id, r] of Object.entries(base)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, baseLaws) };
  } else {
    // 空间拓扑完全由初始化输入决定(用户/LLM 描述的邻接+层级), 不做硬编码补边
    // 先建全部区域(含 parent), 再算 layer(父 layer+1)
    const built: Record<string, SpaceRegion> = {};
    for (const r of regionDefs) {
      // biome 必须由 LLM 提供——引擎不做任何推断/兜底(否则初始化条件不同就错, 且掩盖 LLM 真实输出)。
      // 缺失 → 报错, 强制 LLM 补全, 而不是引擎猜。
      const biome = (r.biome as string)?.trim();
      if (!biome) {
        throw new Error(`LLM 补全的区域「${r.name || r.id}」缺少 biome——不允许引擎兜底推断, 请 LLM 明确给出 biome`);
      }
      built[r.id] = {
        id: r.id, name: r.name, biome: biome as SpaceRegion["biome"],
        resources: deriveRegionResources(biome, baseLaws),
        neighbors: r.neighbors?.filter((n) => n !== r.id) ?? [],
        connections: r.connections,
        parent: r.parent, layer: 0, refined: false,
        character: r.description || r.character,
        share: r.share, shape: r.shape, position: r.position,
        borders_land: r.borders_land,
      };
    }
    // layer 按父深度: 顶层 0, 子区划 1, 更深 2...
    for (const r of regionDefs) {
      let layer = 0;
      let p = r.parent;
      const guard = new Set<string>();
      while (p && built[p] && !guard.has(p)) {
        guard.add(p);
        layer += 1;
        p = built[p].parent;
      }
      built[r.id].layer = layer;
    }
    // 由 parent 反向补 children(有名有姓的子区划)
    for (const r of regionDefs) {
      if (r.parent && built[r.parent]) {
        built[r.parent].children = [...(built[r.parent].children ?? []), r.id];
      }
    }
    Object.assign(regions, built);
  }

  // 实体: 用户/LLM 指定的 regionId 必须落在空间全景内（否则挂空）。
  // 兜底只做基础校验: regionId 不存在时才 fallback 到第一个区域。
  // **不做任何预设**(物种→地形映射/层级下钻/规模限制)——一切由 LLM 按初始化指令综合判断,
  // 引擎不硬编码"精灵在哪/部落多大/区域多细", 否则初始化条件不同就错。
  const validRegionIds = new Set(Object.keys(regions));
  const fallbackRegion = Object.keys(regions)[0] ?? "plains-mid";
  const entities: EntityCard[] = (completed.entities ?? []).map((e, i) => {
    const rid = e.regionId && validRegionIds.has(e.regionId) ? e.regionId : fallbackRegion;
    const region = regions[rid];
    // 初始人口: 必须由 LLM 给出(结合时代/区域/文明规模综合判断)。引擎不做任何兜底公式——
    // 缺失则报错, 强制 LLM 补全, 不允许引擎猜。
    const startPop = typeof e.population === "number" && Number.isFinite(e.population) && e.population > 0
      ? Math.round(e.population)
      : (() => { throw new Error(`LLM 补全的实体「${e.name}」缺少有效的 population——不允许引擎兜底推断, 请 LLM 明确给出初始人口`); })();
    const metrics = { population: startPop, food: 500, military: 400, legitimacy: 60, stability: 60 };
    // species 优先用 LLM 给的种族名; 缺省时: 若实体名明显是组织名(氏族/部落/王国/联盟/国/公国 等词缀),
    // 说明实体名是文明名而非物种名, 回退"人类"(通用); 否则实体名本身就是物种名(如"精灵"), 用之。
    const orgSuffix = /氏族|部落|王国|联盟|帝国|公国|王国|共和国|王朝|国$/;
    const species = e.species?.trim()
      || (orgSuffix.test(e.name) ? "人类" : e.name);
    const form = (e.politicalForm as string)?.trim() || derivePoliticalForm(
      {
        id: `user-${i}`, name: e.name, kind: "entity", status: "active",
        metrics: { ...metrics, economy: 0 }, tech: { "农业": 15, "制度": 10 },
        values: { "探索欲": 50, "组织倾向": 50, "信仰强度": 40 },
        identity: { species, ethnicity: species, culture: species, political_form: "", ideology: "传统", origin_story: "" },
        geography: { region: rid, neighbors: [], capital: "" }, relations: [],
        internal: { recent_events: [], active_issues: [] },
        regime: { organizational_complexity: 10, centralization: 20, economic_base: 0 },
        active_level: "regular", last_tick: 0, created_at: 0, updated_at: 0,
      },
      regions[rid],
      { cultures: {}, languages: {} } as unknown as SimulationSession,
      rng,
    );
    const ent = makeEntity(
      `user-${i}`, e.name, rid,
      species, form,
      metrics,
      { "农业": 15, "制度": 10 },
      { "探索欲": 50, "组织倾向": 50, "信仰强度": 40 },
      species,
    );
    // 宗教/意识形态: 用户指定优先, 缺省用数据驱动推导（信号剖面 + 环境 + 历史, §4.1）
    const tmpSession = { cultures: {}, languages: {} } as unknown as SimulationSession;
    ent.identity.religion = e.religion?.trim() || deriveReligion(ent, regions[rid], tmpSession);
    ent.identity.ideology = e.ideology?.trim() || deriveIdeology(ent, regions[rid], tmpSession);
    return ent;
  });

  // 实体邻居: 区域邻接 → 实体 id, 但过 awareness 距离过滤（§5.1 空间传递性）:
  // 相距过远(感知过低)的实体即使区域邻接也不互为邻居(如部落时代跨洲的文明互不相邻)。
  const byRegion = new Map<string, EntityCard[]>();
  for (const e of entities) {
    if (!byRegion.has(e.geography.region)) byRegion.set(e.geography.region, []);
    byRegion.get(e.geography.region)!.push(e);
  }
  for (const e of entities) {
    const nbrIds = new Set<string>();
    for (const nid of regions[e.geography.region]?.neighbors ?? []) {
      for (const nbr of byRegion.get(nid) ?? []) {
        if (nbr.id === e.id) continue;
        // 与 relations 同阈值: 感知 < 0.15 → 不相邻(尚未接触)
        const aw = computeAwareness(e, nbr.id, entities, regions, baseLaws);
        if (aw >= 0.15) nbrIds.add(nbr.id);
      }
    }
    e.geography.neighbors = [...nbrIds];
  }

  // 实体关系: 实体名 → id 映射, 用户指定的关系进入 relations（§3.1 Board）
  const nameToId = new Map(entities.map((e) => [e.name, e.id]));
  for (const spec of completed.entities ?? []) {
    const ent = entities.find((x) => x.name === spec.name);
    if (!ent) continue;
    for (const rel of spec.relations ?? []) {
      const targetId = nameToId.get(rel.target);
      if (targetId && targetId !== ent.id) {
        // 空间传递性过滤: 感知 < 0.15 的目标关系丢弃（尚未接触）, 0.15-0.35 降级为试探性
        const awarenessVal = computeAwareness(ent, targetId, entities, regions, baseLaws);
        if (awarenessVal < 0.15) {
          continue; // 相距过远, 双方尚未接触, 不建立关系
        }
        if (awarenessVal < 0.35) {
          // 间接接触 → 关系存在但淡化（敌意压低, 立场降级为试探性, 叙事保留"仅间接接触"）
          ent.relations.push({
            target: targetId,
            stance: rel.stance || "试探接触",
            note: `${rel.note ?? ""}（双方仅有间接接触, 关系尚不确定）`.trim(),
            hostility: Math.min(0.4, rel.hostility ?? (rel.stance ? 0.3 : 0.1)),
          });
          continue;
        }
        ent.relations.push({ target: targetId, stance: rel.stance || "中立", note: rel.note, hostility: rel.hostility });
      }
    }
  }

  // 语言: 从实体生成
  let languages: Record<string, LanguageSystem> = {};
  let cultures: Record<string, Culture> = {};
  if (entities.length > 0) {
    const gen = generateWorldLanguages({
      seed: Math.floor(rng() * 10000),
      entities: entities.map((e) => ({
        species: e.identity.species,
        regionBiome: regions[e.geography.region]?.biome,
        cultureName: e.identity.ethnicity || e.identity.species,
      })),
    });
    languages = gen.languages;
    cultures = gen.cultures;
  }

  // 法则: 用户规则 + 实体约束（含"必须/不能/禁止"者升级为硬约束, 其余作背景事实锁定） + base 法则
  const userRules = completed.laws?.rules ?? [];
  const ruleLike = ["必须", "不能", "禁止", "不得", "不可能", "无法"];
  const isRuleLike = (c: string) => ruleLike.some((k) => c.includes(k));
  const hardConstraints = (completed.entities ?? []).flatMap((e) =>
    (e.constraints ?? []).filter(isRuleLike),
  );
  const laws: WorldLaws = {
    ...baseLaws,
    rules: [...(baseLaws.rules ?? []), ...userRules, ...hardConstraints],
    narrative: [...(baseLaws.narrative ?? []), ...(completed.laws?.narrative ?? [])],
    ontology: [...(baseLaws.ontology ?? []), ...(completed.laws?.ontology ?? [])],
  };
  // 用户指定的世界尺度写入 measurement_system.worldScale（§4.0② 空间全景按真实尺度铺全）
  if (completed.measurement?.worldWidth && completed.measurement?.worldHeight && laws.measurement_system) {
    laws.measurement_system = {
      ...laws.measurement_system,
      worldScale: {
        width: completed.measurement.worldWidth,
        height: completed.measurement.worldHeight,
        description: `用户定义的大陆尺度 ${completed.measurement.worldWidth}×${completed.measurement.worldHeight} ${completed.measurement.lengthUnit ?? "公里"}`,
      },
    };
  }

  // 用户指定要素全部锁定进背景规则库（细化即锁定, §3.6/§4.0）。
  // scope 命名与 loreFactsFor 的匹配规则一致, 保证被回读:
  // - 区域事实 scope 用裸 region id(与 addInitialRegionFact 一致, 可被按 region 匹配)
  // - 实体事实 scope 用裸实体 id(新增 entityScope, 可被按实体 id 匹配)
  //   ——否则 scope 带前缀(region:/entity:)永远匹配不到, 用户锁定"锁了个寂寞"。
  const entityScopeOf = (name: string): string | undefined => {
    const ent = entities.find((x) => x.name === name);
    return ent?.id;
  };
  // 只锁定"实际存活进 relations"的用户关系（含降级后的立场）。
  // 否则被 awareness 过滤丢弃的关系(感知<0.15 尚未接触)仍锁进 lore, 与 relations 说法矛盾
  // （relations 无此关系, lore 却说世代战争）。存活判定 = 实体 relations 里存在指向该目标的关系。
  const survivedRel = new Set<string>(); // `${entId}->${targetId}`
  for (const ent of entities) {
    for (const rel of ent.relations) {
      survivedRel.add(`${ent.id}->${rel.target}`);
    }
  }
  const userSpecified: { scope: string; content: string; entityScope?: string }[] = [
    ...userRules.map((r) => ({ scope: "world-law", content: r })),
    ...(completed.regions ?? []).map((r) => ({ scope: r.id, content: r.description ?? `${r.name}(${r.biome})` })),
    ...(completed.entities ?? []).map((e) => ({ scope: `entity:${e.name}`, entityScope: entityScopeOf(e.name), content: `${e.species} ${e.name}${e.ideology ? `, ${e.ideology}` : ""}` })),
    ...(completed.entities ?? []).flatMap((e) =>
      (e.constraints ?? []).filter((c) => !isRuleLike(c))
        .map((c) => ({ scope: `entity:${e.name}`, entityScope: entityScopeOf(e.name), content: c })),
    ),
    ...(completed.entities ?? []).flatMap((e) => {
      const ent = entities.find((x) => x.name === e.name);
      return (e.relations ?? [])
        .filter((r) => {
          const targetId = nameToId.get(r.target);
          return ent && targetId && survivedRel.has(`${ent.id}->${targetId}`);
        })
        .map((r) => {
          // 用实际存活的 relation（含降级立场/备注）——若被降级为试探接触, lore 也如实记录
          const actual = ent?.relations.find((x) => x.target === nameToId.get(r.target));
          const stance = actual?.stance ?? r.stance;
          const note = actual?.note ?? r.note;
          return { scope: `entity:${e.name}`, entityScope: entityScopeOf(e.name), content: `与 ${r.target}: ${stance}${note ? ` (${note})` : ""}` };
        });
    }),
  ];

  return {
    laws,
    regions,
    entities,
    languages,
    cultures,
    userSpecified,
    conflicts: [],
  };
}

/** 计算 A 对 B 的感知强度（空间传递性, 供关系过滤） */
function computeAwareness(
  a: EntityCard,
  bId: string,
  entities: EntityCard[],
  regions: Record<string, SpaceRegion>,
  laws: WorldLaws,
): number {
  const entitiesMap: Record<string, EntityCard> = {};
  for (const e of entities) entitiesMap[e.id] = e;
  const tmpSession = {
    entities: entitiesMap,
    regions,
    laws,
    events: [],
    config: {},
  } as unknown as SimulationSession;
  try {
    return awareness(a, bId, tmpSession);
  } catch {
    return 1; // 计算失败 → 保留关系(宽松)
  }
}

// (空间拓扑完全由初始化输入决定, 不做硬编码补边)

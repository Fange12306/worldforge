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
    /** 时代（推导枢纽, §: 时代 → 政体/人口规模/区域面积）。"部落时代"/"青铜时代"/"古典城邦时代"... */
    era?: string;
    /** 地盘规模（时代+人口+文明形态 → 决定初始化细化层级深度）: 聚落级/区域级/大区级 */
    realm_scale?: "settlement" | "region" | "subcontinent";
    /** 地盘面积（与 worldWidth/worldHeight 同单位², 如公里→平方公里）——面积比驱动层级: 顶层面积/地盘面积 → 层级数 */
    realm_area?: number;
    /** 实体占据的顶层区域 id（先绑定顶层, 细化步骤再回填最细子区划 regionId） */
    topRegionId?: string;
    /** 起源叙事（从用户指令推出的隐含信息: 共同祖先/分化/迁徙——写入 identity.origin_story） */
    origin?: string;
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

  // 5. 发源地分离（软冲突）: 不同物种的实体不应以同一区域为发源地（除非用户明确说共居）。
  //    "四个类人亚种" → 各自发源地应分离——同一 species 的多个实体(一国分裂/同族多邦)可以共享区域
  const regionSpecies = new Map<string, Set<string>>();
  for (const e of parsed.entities) {
    const rid = e.topRegionId ?? e.regionId;
    if (!rid) continue;
    if (!regionSpecies.has(rid)) regionSpecies.set(rid, new Set());
    regionSpecies.get(rid)!.add(e.species || e.name);
  }
  for (const [rid, sps] of regionSpecies) {
    if (sps.size > 1) {
      conflicts.push({
        severity: "soft",
        kind: "origin_separation",
        description: `区域「${rid}」被多个物种作为发源地: ${[...sps].join("、")}（不同物种的发源地通常分离——除非用户明确说共居）`,
      });
    }
  }

  // 6. 时代一致性（软冲突）: 同一世界的初始实体时代应一致（除非用户明确说明存在发展差异）
  const eras = new Set(parsed.entities.map((e) => e.era).filter(Boolean) as string[]);
  if (eras.size > 1) {
    conflicts.push({
      severity: "soft",
      kind: "era_mismatch",
      description: `实体时代不一致: ${[...eras].join(" / ")}（同一世界的初始时代应一致, 除非用户明确说明存在发展差异）`,
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
**区域 name 用纯自然地理名——铁律: 禁止任何政权/种族/文明含义**:
  - 禁政权词: 王国/帝国/公国/共和国/王朝/部落/联盟/氏族/城邦/联邦/汗国/酋长国/国——叫"银桦森林""恒河平原", 绝不叫"矮人王国大陆""精灵联盟""兽人部落平原"。
  - 禁种族词: 矮人/精灵/兽人/人类/龙裔/侏儒等——"精灵森林"也不行, 用该森林本身的自然名(如"银桦森林")。
  - 区域名只描述"这片土地是什么"(地形/水文/植被/气候/方位所指的专名), 不描述"谁住在这里"。
**name 用具体专名, 禁用"平原腹地/东域/中央低地/东部海岸"这类方位+地形的泛称**——用真实地名式命名(如"华北平原""黄河流域""巴尔干半岛"): 即使架空, 名字也要像"一个真实存在的地方"。
**层级命名体现地理层级概念**(每级都有与层级相称的命名模式):
  - 顶层大陆(layer 0): "XX大陆"或大陆级地名(如"奥雷利亚大陆");
  - 次大陆级(layer 1): "XX次大陆" / "XX半岛" / "XX高原" / "XX大区"(如"东亚次大陆""中南半岛""青藏高原");
  - 大区级(layer 2): "XX地区" / "XX盆地" / "XX平原" / "XX山脉"(如"华北平原""四川盆地");
  - 地区级(layer 3): "XX流域" / "XX谷地" / "XX丘陵" / "XX三角洲"(如"黄河流域""汾河谷地");
  - 核心级(layer 4+): 具体小地名(如"中游河湾""出山口""冲积扇")。
  **禁止**用"中央/东部/北部+地形"这类以方位为主体的命名——方位可以出现在 position 字段, 不进入 name。
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
- measurement: 必填。从用户描述推导世界尺度。**换算锚点（真实地球数据, 一切缩放以它为基准）**: 地球直径≈12742 公里, 地球表面积≈5.1 亿 km², 地球陆地面积≈1.5 亿 km²。
  **语义换算规则（严格按面积/倍率换算, 不得偷懒忽略缩放）**:
  - "地球一半大/只有地球一半" = 面积减半 → 直径 ×√0.5≈×0.707（≈9000 km）;
  - "陆地面积是地球大陆的 1/N" = 陆地面积 = 1.5亿/N km²;
  - "行星比地球大 2 倍/3 倍" = 面积 ×2/×3 → 直径 ×√2/×√3;
  - "大陆宽 X 公里/方圆 X" = 直接用。
  - worldWidth/worldHeight 是行星/大陆的尺寸（宽×高）, 乘积 ≈ 推算的面积（含海洋的投影面）; **不同尺度必须给出不同数值**——地球级≈12742, 一半≈9000, 陆地1/5 的世界总投影≈5400, 陆地1/10≈3870, 大陆世界 2000-5000, 微型世界 <1000。禁止所有尺度都写 12742。
  - **用户给出大陆面积时按大陆算**: "一块大陆, 面积约 X 平方公里" → 世界尺寸由该大陆反推: 若单大陆世界, worldWidth ≈ √(X ÷ 陆地占比)（陆地占比按用户描述, 无描述默认 ~0.3 陆地 0.7 海洋; 全陆地世界占比 1）。例: 大陆 300 万 km² → 单大陆世界 ≈ 3873×3873（若占比 0.2）或 1732×1732（若全陆地）。**禁止把"大陆 300 万"写成行星级 12742**。
  - **世界越小, 顶层区域越少**: 地球级=多大陆+多海洋; 半地球级=2-4 大陆+海洋; 陆地1/5~1/10=1-3 块大陆(可单大陆+沿海); 微型=单大陆或群岛。陆地/海洋比例也从用户描述推导。
- regions: 只输出 layer0(大陆/海洋), 每个含 id/name/biome/share/shape/position/connections/borders_land。多大陆之间用海洋隔开。**陆地与海洋的比例、大陆的数量与大小, 完全从用户描述推导并自洽**——若用户说"类地行星、地球大小", 应参考真实地球的陆地海洋比例与大陆尺度; 若用户说"单块大陆", 则无海洋或仅沿海。

输出严格 JSON 对象, 不要 markdown 包裹。示例:
{"laws":{"rules":["起死回生不可能发生。"],"narrative":["多种族并存的部落时代"],"ontology":["类地行星"]},"measurement":{"lengthUnit":"公里","worldWidth":2000,"worldHeight":1500},"regions":[{"id":"aurelia","name":"奥雷利亚大陆","biome":"mixed","share":0.6,"shape":"不规则大陆","position":"大陆中部","connections":{},"borders_land":[]},{"id":"endor-sea","name":"恩多尔海","biome":"ocean","share":0.4,"shape":"沿海水体","position":"大陆东侧","connections":{},"borders_land":["aurelia"]}]}`;

const SUBREGIONS_SYSTEM = `你是架空世界的缔造者。用户给出世界种子, 已生成**顶层大陆/海洋**与**文明实体清单**(下方列出, 含各实体的地盘面积 realm_area)。你**只为实体占据的顶层区域**生成**完整的多级子区划链**(layer 1, 2, 3...), 把每个实体绑定到最合适的核心区划。

${COMMON_RULES}

- **有的放矢(关键)**: 只为下方实体 topRegionId 指向的顶层区域细化子区划。**未被任何实体占据的顶层区域一律不枚举子区划**——它们保持概略(layer 0), 推演中涉及时才动态细化(细化即锁定)。**禁止为无实体的区域生成子区划。**
- **层级深度由面积比决定(核心机制)**: 每个实体的层级链深度 = 顶层区域面积 ÷ 实体地盘面积(realm_area) 的比值。参考规则: 面积每缩小约 3-10 倍为一级(地理分层惯例: 大陆→次大陆→大区→地区→核心区), 层级数 N ≈ log(顶层面积/realm_area) / log(5)。
  - **必须生成完整层级链, 直到最细一级的面积接近(不超过 ~10 倍)实体的 realm_area**——实体绑定最细一级。
  - 现实参考(行星级世界): 亚洲(4400万 km²) → 东亚次大陆(~1000万, share≈0.25) → 华北地区(~150万, share≈0.15) → 黄河流域中游(~30万, share≈0.2) → 核心地带。一个部落文明从"大陆"到"它的河谷"通常需要 **3-4 级**子区划; 一个帝国从"大陆"到"核心省"需要 2-3 级。
  - **每级都命名**: 次大陆/大区/地区都要有自然地理名(如"华北平原""黄河流域"), 不允许跳过级(不得从大陆直接跳到河谷)。
  - 下方输入会给出每个顶层区域的估算面积与每个实体的"建议层级深度"——**以此为参考, 但最终由你综合判断**。
- **每个实体必须绑定**: 在输出的 entities 数组里给出每个实体的最终 regionId（name 与实体清单一致, regionId 必须存在且是**最细一级**子区划）。
- 子区划的 **parent 必须指向下方已存在区域**(顶层区域或本批新子区划), 不得引用不存在的区域; **每个子区划给 share(占父级比例, 0-1)**——父子面积链自洽: 同一父级的子区划 share 和 ≤ 1。
- 岛屿(parent 归陆, neighbors 邻海)也在此层生成(仅当实体占用的顶层区域含岛屿时)。
- 顶层区域本身不要重复输出。

输出严格 JSON 对象。示例: {"regions":[{"id":"aurelia-east-asia","name":"东晨曦次大陆","parent":"aurelia","biome":"mixed","share":0.3,"shape":"半岛状次大陆","position":"大陆东部","connections":{}},{"id":"aurelia-yellow-valley","name":"晨曦河平原","parent":"aurelia-east-asia","biome":"plains","share":0.5,"shape":"冲积平原","position":"次大陆中部","character":"两岸冲积平原, 北岸丘陵","connections":{}},{"id":"aurelia-mid-reach","name":"晨曦河中游","parent":"aurelia-yellow-valley","biome":"plains","share":0.4,"shape":"带状河谷","position":"平原中段","connections":{}}],"entities":[{"name":"晨曦部族","regionId":"aurelia-mid-reach"},{"name":"精灵","regionId":"silverbirch-forest"}]}`;

const ENTITIES_SYSTEM = `你是架空世界的缔造者。用户给出世界种子, 已生成**顶层大陆/海洋**、**世界法则**与**世界尺度**(下方列出)。你先推断**哪些文明/种族实体存在**, 为每个实体推断**时代/政体/人口/地盘**, 绑定到顶层区域, 并给出**起源叙事**。

${COMMON_RULES}

- **用户原文中明确提到的物种必须全部出现**（用户说"演化出人类、精灵、兽人、矮人", 这四个物种就都要出现在最终实体里, species 用原文物种名）。**实体数量、每个实体在哪块区域, 完全从用户描述与文明规模推导**——不预设个数, 不机械复制, 一切从用户输入出发。**若顶层区域列表为空但原文提到物种, 也必须从原文恢复这些物种为实体**。
- **"林立/诸国/列国/群雄/并存/若干/多个王国"是实体拆分信号(关键)**: 用户说"多个王国与帝国林立""诸国并立""众多城邦", 就必须**拆成多个实体**——每个政权/城邦/王国一个实体（如"北境王国""河间帝国""南方城邦联盟"）, 每个实体有自己的 name/population/topRegionId/realm_area。**禁止**合并成一个 form="多个封建王国"的实体。政权数量从用户描述推断（"多个"=3-6 个,"众多"=5-10 个）。
- **发源地分离(关键合理性, 分两层)**:
  - 不同物种: 发源地应**分离**——每个物种绑定不同的顶层区域（四个类人亚种 → 分布在大陆的不同方向/不同大区）;**仅当用户原文明确说共居/同源一城时**才可共享。
  - 同物种的多个政权（如多个人类王国）: **可以同顶层区域甚至相邻**——"河间帝国"与"北境王国"同在一块大陆上完全合理, 只是应分布在不同的子区划（由细化步骤处理）。**不要为了分离而把同一大陆的多个政权拆到不同大陆。**
- **环境适配(关键合理性)**: 实体绑定的顶层区域环境必须与其生活方式相配——矮人/矿工→多山多矿的区域, 精灵→森林, 兽人/游牧→草原/荒野, 人类→平原/海岸, 海洋文明→群岛/海岸带。**用户原文指定了环境则以用户为准**（用户说"精灵住在沙漠"就按沙漠）。同时结合**世界法则**: 魔法世界的高魔力区域、真气世界的灵脉福地, 更可能孕育相应文明。
- **时代同步(关键合理性)**: 同一世界的初始实体处于**同一时代**(era 一致或相近)。仅当用户明确说明存在发展差异时才可错开（如"偏远地区仍处于部落时代"）。
- **每个实体推断时代 era**(自由文本: "部落时代"/"青铜时代"/"古典城邦时代"/"中世纪王国"/"魔法纪元"…): 从用户原文推断; 原文没提时代时, 从文明形态与描述反推（部落联盟→部落时代; 城邦→古典时代; 帝国→古代帝国时代...）。
- **时代决定文明量级**(综合判断, 给合理数值, 不套公式): 部落时代人口数千~数十万、政体多为部落/氏族/部族议事会; 城邦时代数万~百万、政体多为城邦/王国; 王国/帝国时代百万级、政体为王国/帝国/联邦。politicalForm 自由描述, 不预设枚举。
- **realm_scale 地盘规模**(三选一, 由时代+人口+文明形态推断):
  - "settlement" 聚落级: 部落/氏族, 占据一个聚落/河谷/湖岸;
  - "region" 区域级: 城邦/小王国, 占据一块平原/盆地/海岸带;
  - "subcontinent" 大区级: 王国/帝国, 占据整个大区或跨多个区。
- **realm_area 地盘面积(必填, 关键)**——与 worldWidth/worldHeight 同单位²（若世界宽 4000 公里 → 面积单位即平方公里）。由**人口 × 时代密度**反推 + 文明形态综合判断, 并对照下方世界尺度:
  - 部落时代(粗放农业/游牧): 密度约 1-10 人/km² → 5 万人口 → 数千~数万 km²;
  - 城邦时代(精耕农业): 密度约 10-50 人/km² → 50 万人口 → 1-5 万 km²;
  - 王国/帝国: 密度约 20-100 人/km² → 500 万人口 → 5-25 万 km²。
  - 参考现实: 黄河流域中游(一个部落文明的核心地带)约 30 万 km²; 华北平原约 15 万 km²; 一个城邦的腹地约 1-5 万 km²。
  - **对照世界尺度自洽**: 世界是行星级(数十万 km 周长)时, 部落的地盘应为世界陆地面积的十万分之一到千分之一级; 世界是小世界(数千 km)时, 地盘相对占比大得多。realm_area 与 topRegionId 指向的顶层区域面积之比, 将决定该实体的区域细化层级数——比值越大层级越深。
- **origin 起源叙事(一句话)**: 从用户原文推出**尽可能多的隐含信息**——"四个类人亚种"→ 共同祖先、分化/迁徙的历史; "与世隔绝的群岛"→ 孤立演化。origin 写进实体的起源叙事, 供后代 agent 引用。用户没给线索时给简短的合理起源（"起源于 X 的河谷"）, 不过度脑补。
- **topRegionId**: 该实体占据的**顶层区域 id**（必须从下方列表选, 不得引用不存在的区域）。实体所在顶层区域会在下一步被细化出子区划, 因此**此时不填 regionId**（下一步细化后回填）。
- population: 正整数（与 era/realm_scale 自洽）。

输出严格 JSON 对象。示例: {"entities":[{"name":"晨曦部族","species":"人类","era":"部落时代","realm_scale":"settlement","topRegionId":"aurelia","politicalForm":"部落","population":50000,"origin":"最早迁徙到晨曦平原的类人分支, 与精灵同源于大陆腹地"},{"name":"精灵","species":"精灵","era":"部落时代","realm_scale":"settlement","topRegionId":"endor-forest","politicalForm":"部族议会","population":30000,"origin":"类人亚种中最早进入森林的一支, 与人类共享远古祖先"}]}`;

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
  /** 额外提示(如命名违规清单): 追加到校验输入, 让 LLM 针对性修正 */
  extraNotes?: string,
): Promise<T> {
  const verifySystem = `你是架空世界的自洽校验者。用户给出世界种子, 并已生成某一层（${schemaHint}）。你**对照用户原文, 检查该层输出是否自洽**, 若发现问题就修正。

检查点（结合用户原文判断, 不预设死规则）:
- 同名实体/区域: 多个实体同名（如多个"人类"）→ 区分命名。
- 文明规模 vs 地盘: 几万人口的部落不应占据庞大区域 → 与文明规模相称。
- 区域层级: 是否足够深以承载文明地盘。
- 引用一致性: regionId/parent/target 必须指向真实存在。
- share/面积自洽: 父子 share 和, 陆地+海洋比例。

**硬性约束（最重要）**:
- **绝对禁止修改任何 id 与 name**——输入里存在的 id/name 必须原样保留, 不得改名、不得换 id、不得重写区域集。引用一致性检查只针对"引用了不存在的 id"这类问题, 修正方式是调整**引用方**指向输入中已存在的 id, 而不是发明新 id。
- 允许修正: 数值(population/share 不合理)、缺失字段的补全(如 realm_area 按时代密度估算)、引用调整、多余的同名实体合并。
- **若无问题, 原样输出。** 不要解释, 只输出 JSON。`;

  const extraBlock = extraNotes ? `\n\n# 需修正的问题（逐条处理, 只修这些, 其余保持原样）\n${extraNotes}` : "";
  const response = await safeCall(llm, {
    systemPrompt: verifySystem,
    userMessage: `# 用户原文（权威, 一切以其为准）\n${seedText}\n\n# 该层输出（检查是否自洽, 修正则输出修正版）\n${JSON.stringify(layerOutput, null, 2)}${extraBlock}`,
    maxTokens: 4000,
    json: true,
  });
  if (!response) return layerOutput;
  try {
    const verified = parseJSONFromLLM<T>(response);
    // §: id/name 一致性保护——校验版不得重写结构/换区域 id:
    // - regions: id 集合必须与输入完全一致(区域 id 绝不允许改)
    // - entities: name 集合必须一致,**除非**输入存在同名实体(同名冲突允许校验版区分命名)
    // 违反 → 判定校验版越权, 丢弃用原版
    if (!identityGuard(layerOutput, verified)) {
      onTrace?.({
        step: `verify-${step}`,
        time: new Date().toISOString(), ok: false, calledLLM: true,
        inputExcerpt: `verify ${step} 越权(id/name 集合不一致), 丢弃校验版`,
        responseExcerpt: response.slice(0, 400),
      });
      return layerOutput;
    }
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
 * §: 校验版身份一致性保护。
 * - regions: id 集合必须与输入完全一致（区域 id 绝不允许改, 引用检查只能调整引用方）
 * - entities: name 集合必须一致, **除非**输入存在同名实体（同名冲突允许校验版区分命名）
 * 返回 false = 校验版越权, 应丢弃。
 */
function identityGuard(orig: unknown, verified: unknown): boolean {
  if (!orig || typeof orig !== "object") return true;
  const o = orig as Record<string, unknown>;
  const v = (verified && typeof verified === "object" ? verified : {}) as Record<string, unknown>;
  // 区域 id 严格一致
  const oRegions = collectIds(o.regions, "id");
  const vRegions = collectIds(v.regions, "id");
  if (oRegions.size > 0) {
    if (vRegions.size === 0 || !setsEqual(oRegions, vRegions)) return false;
  }
  // 实体 name: 无同名冲突时必须一致
  const oEntNames = collectIds(o.entities, "name");
  const vEntNames = collectIds(v.entities, "name");
  if (oEntNames.size > 0) {
    if (vEntNames.size === 0) return false;
    const hasDupName = Array.isArray(o.entities) && oEntNames.size !== (o.entities as unknown[]).length;
    if (!hasDupName && !setsEqual(oEntNames, vEntNames)) return false;
  }
  return true;
}

/** 取数组字段的身份集合（field: "id" 或 "name"） */
function collectIds(arr: unknown, field: "id" | "name"): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>)[field] === "string") {
      out.add((item as Record<string, string>)[field]);
    }
  }
  return out;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * 分层生成完整世界（4 层依赖感知, 每层小不截断）。
 * Step1 骨架(法则+尺度+大陆/海洋) → Step2 区域分层 → Step3 实体 → Step4 关系。
 * 每层用上一层实际输出作输入, 层间自洽; 每层失败降级(不阻塞整体)。
 * 每层生成后过一遍 LLM 自洽校验(verifyLayer)。
 * 返回合并后的完整 ParsedInitialState。
 */
export async function completeInitialState(
  parsed: ParsedInitialState | null,
  llm: LLMBindings,
  seedText?: string,
  onProgress?: (stage: string) => void,
  onTrace?: InitTraceCb,
): Promise<ParsedInitialState> {
  // parse 失败(null)时用空底座, 不让后续步骤崩溃——LLM 层失败降级, 不静默丢用户内容
  if (!parsed) {
    parsed = { laws: { rules: [], narrative: [], ontology: [] }, regions: [], entities: [] };
  }
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
  let topRegions = (skeleton.regions?.length ? skeleton.regions : parsed.regions) ?? [];
  // 骨架与用户都无顶层区域 → 确定性兜底（一块大陆的物理布局）: 保证 entities 步骤有真实区域可选、
  // focused-regions 有 parent 可用——防"LLM 编造区域 id / 实体全部 fallback 挤进第一个区域"
  if (topRegions.length === 0) {
    onTrace?.({
      step: "skeleton-fallback",
      time: new Date().toISOString(), ok: false, calledLLM: false,
      inputExcerpt: "骨架层未产出顶层区域", responseExcerpt: "回退确定性默认大陆布局(6 区域)",
    });
    topRegions = deterministicTopRegions();
  }
  const skeletonStats = { regions: topRegions.length, layer0: topRegions.filter((r) => !r.parent).length };

  // Step 2: 实体先行（§: 先推断"有哪些实体/什么时代/多大地盘", 绑定顶层区域——有的放矢的前提）
  // 输入 = 顶层区域 + 世界法则 + 世界尺度: 让实体选址同时考虑环境适配与世界法则(魔法浓度/灵脉福地)
  onProgress?.("② 推断文明实体（时代/政体/人口/发源地）...");
  let entities: NonNullable<ParsedInitialState["entities"]> = parsed.entities ?? [];
  const entRaw = await safeCall(llm, { systemPrompt: ENTITIES_SYSTEM, userMessage: `${seedBlock}\n\n# 世界法则\n${JSON.stringify(laws, null, 2)}\n\n# 世界尺度\n${JSON.stringify(measurement ?? {}, null, 2)}\n\n# 已生成的顶层大陆/海洋（topRegionId 只能从这里选, 不存在的区域不可引用）\n${JSON.stringify(topRegions.map((r) => ({ id: r.id, name: r.name, biome: r.biome, parent: r.parent })), null, 2)}`, maxTokens: 3000, json: true });
  onTrace?.({
    step: "complete-entities",
    time: new Date().toISOString(), ok: !!entRaw, calledLLM: true,
    inputExcerpt: `topRegions: ${topRegions.length}`, responseExcerpt: entRaw?.slice(0, 1500) ?? "(无返回)", error: entRaw ? undefined : "LLM 无返回",
  });
  if (entRaw) { try { const p = parseJSONFromLLM<{ entities: NonNullable<ParsedInitialState["entities"]> }>(entRaw); entities = mergeEntities(entities, p.entities ?? []); } catch { /* 保留已解析实体 */ } }
  // 实体自洽校验: 对照用户原文检查(同名实体/发源地分离/文明规模vs地盘/时代), LLM 输出修正版
  if (entities.length) {
    const verified = await verifyLayer<{ entities: NonNullable<ParsedInitialState["entities"]> }>("entities", seed, { entities }, llm, "实体(文明/种族, 含topRegionId/population/era)", onTrace);
    if (verified.entities?.length) entities = verified.entities;
  }
  // §: realm_area 确定性兜底——LLM 未给地盘面积时按 人口 × 时代密度 估算
  //（面积比 → 层级深度的关键输入, 缺了就无法计算层级链深度）
  for (const e of entities) {
    if (e.realm_area != null && e.realm_area > 0) continue;
    if (typeof e.population !== "number" || e.population <= 0) continue;
    e.realm_area = estimateRealmArea(e.population, e.era);
  }

  // Step 3: 聚焦区域细化（§: 有的放矢——只细化实体占据的顶层区域, 其余保持概略, 推演中动态细化）
  // 输出 regions(实体区域下的子区划) + entities(每个实体的最终 regionId 绑定回填)
  // 实现: 按顶层区域分组, 每组独立调用(每次只生成一条层级链, 输出小不截断、指令聚焦——LLM 单次大输出常截断/敷衍成 1 级)
  onProgress?.("③ 聚焦区域细化（只细化文明所在区域）...");
  let subregions: NonNullable<ParsedInitialState["regions"]> = [];
  if (topRegions.length > 0 && entities.length > 0) {
    const entitiesByTop = new Map<string, NonNullable<ParsedInitialState["entities"]>>();
    for (const e of entities) {
      const top = e.topRegionId ?? "";
      if (!entitiesByTop.has(top)) entitiesByTop.set(top, []);
      entitiesByTop.get(top)!.push(e);
    }
    const topById = new Map(topRegions.map((r) => [r.id, r]));
    const bindMap = new Map<string, string>(); // 实体名 → 最细 regionId
    let groupIdx = 0;
    for (const [topId, group] of entitiesByTop) {
      const top = topById.get(topId);
      if (!top) continue;
      groupIdx += 1;
      // §: 面积比 → 层级深度参考（确定性计算: 顶层面积/实体地盘面积 → 建议层级数）
      const areaRef = buildAreaDepthReference([top], group, measurement);
      const subRaw = await safeCall(llm, { systemPrompt: SUBREGIONS_SYSTEM, userMessage: `${seedBlock}\n\n# 世界尺度\n${JSON.stringify(measurement ?? {}, null, 2)}\n\n# 面积与层级参考（建议层级深度 = 顶层面积/地盘面积, 生成层级链时以此为参考）\n${areaRef}\n\n# 本组顶层区域（parent 只能从这里选, 只细化这一块）\n${JSON.stringify([top], null, 2)}\n\n# 本组文明实体（为每个实体生成完整层级链并回填最终 regionId; realm_area 为地盘面积）\n${JSON.stringify(group.map((e) => ({ name: e.name, species: e.species, era: e.era, realm_scale: e.realm_scale, realm_area: e.realm_area, topRegionId: e.topRegionId, population: e.population })), null, 2)}`, maxTokens: 6000, json: true });
      onTrace?.({
        step: "complete-subregions",
        time: new Date().toISOString(), ok: !!subRaw, calledLLM: true,
        inputExcerpt: `group ${groupIdx}/${entitiesByTop.size}: top=${topId}, entities=${group.length}`, responseExcerpt: subRaw?.slice(0, 1200) ?? "(无返回)", error: subRaw ? undefined : "LLM 无返回",
      });
      if (subRaw) {
        try {
          const p = parseJSONFromLLM<{ regions: NonNullable<ParsedInitialState["regions"]>; entities?: Array<{ name: string; regionId?: string }> }>(subRaw);
          const newRegions = (p.regions ?? []).filter((r) => !subregions.some((x) => x.id === r.id));
          subregions.push(...newRegions);
          for (const b of p.entities ?? []) {
            if (b.regionId) bindMap.set(b.name, b.regionId);
          }
        } catch { /* 该组失败, 实体绑定由兜底处理 */ }
      }
      // 深度不足重试一次: 建议层级深度 ≥ 2 但实体仍绑定在本组顶层(LLM 敷衍成 1 级或没生成链)
      const deepNeed = depthReferenceFor([top], group, measurement);
      const shallow = group.filter((e) => {
        const bound = bindMap.get(e.name);
        return !bound || bound === topId;
      });
      if (deepNeed >= 2 && shallow.length > 0) {
        const retryRaw = await safeCall(llm, { systemPrompt: SUBREGIONS_SYSTEM, userMessage: `${seedBlock}\n\n# 世界尺度\n${JSON.stringify(measurement ?? {}, null, 2)}\n\n# 面积与层级参考\n${areaRef}\n\n# 注意: 上一轮你没有为这些实体生成足够的层级链。它们的建议深度 ≥ 2 级——需要生成完整的多级链(如 大陆→次大陆→地区→核心), 直到最细一级面积接近实体地盘面积, 并把实体绑定到最细一级。\n\n# 本组顶层区域\n${JSON.stringify([top], null, 2)}\n\n# 需要深化的实体\n${JSON.stringify(shallow.map((e) => ({ name: e.name, realm_area: e.realm_area, population: e.population })), null, 2)}`, maxTokens: 6000, json: true });
        onTrace?.({
          step: "complete-subregions-retry",
          time: new Date().toISOString(), ok: !!retryRaw, calledLLM: true,
          inputExcerpt: `retry: top=${topId}, entities=${shallow.length}`, responseExcerpt: retryRaw?.slice(0, 1200) ?? "(无返回)",
        });
        if (retryRaw) {
          try {
            const p = parseJSONFromLLM<{ regions: NonNullable<ParsedInitialState["regions"]>; entities?: Array<{ name: string; regionId?: string }> }>(retryRaw);
            const newRegions = (p.regions ?? []).filter((r) => !subregions.some((x) => x.id === r.id));
            subregions.push(...newRegions);
            for (const b of p.entities ?? []) {
              if (b.regionId) bindMap.set(b.name, b.regionId);
            }
          } catch { /* 重试失败则接受现状 */ }
        }
      }
    }
    // 绑定回填: 实体 → 最细子区划（regionId 只指向已存在区域）
    const validSubIds = new Set([...topRegions.map((r) => r.id), ...subregions.map((r) => r.id)]);
    for (const e of entities) {
      const rid = bindMap.get(e.name);
      if (rid && validSubIds.has(rid)) e.regionId = rid;
    }
  }
  // 合并区域树: 顶层 + 聚焦子区划
  let allRegions = mergeRegions(topRegions, subregions);
  // 区域自洽校验: 对照用户原文检查(层级深度/引用一致性/share/实体区域分离), LLM 输出修正版
  // §: 命名违规清单注入——LLM 常把政权/种族词写进区域名("矮人王国大陆"), 或层级命名不体现地理层级
  //（次大陆级叫"中央低地"）。确定性检测后交给校验层改名(id 不变, identityGuard 允许 name 修正)。
  if (allRegions.length) {
    const namingNotes = regionNameViolations(allRegions);
    const verified = await verifyLayer<{ regions: NonNullable<ParsedInitialState["regions"]> }>(
      "regions", seed, { regions: allRegions }, llm, "区域树(含parent层级)", onTrace,
      namingNotes.length > 0 ? namingNotes.join("\n") : undefined,
    );
    if (verified.regions?.length) allRegions = verified.regions;
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

/**
 * §: 单个实体的建议层级深度（供"深度不足重试"判定）: ceil(log(顶层面积/地盘面积)/log(5)), clamp [1,5]。
 */
function depthReferenceFor(
  topRegions: NonNullable<ParsedInitialState["regions"]>,
  entities: NonNullable<ParsedInitialState["entities"]>,
  measurement: ParsedInitialState["measurement"],
): number {
  const w = measurement?.worldWidth;
  const h = measurement?.worldHeight;
  if (!w || !h || w <= 0 || h <= 0) return 1;
  const worldArea = w * h;
  const nTop = Math.max(1, topRegions.length);
  let maxDepth = 1;
  for (const e of entities) {
    const top = topRegions.find((x) => x.id === e.topRegionId);
    if (!top || !e.realm_area || e.realm_area <= 0) continue;
    const share = typeof top.share === "number" && top.share > 0 ? top.share : 1 / nTop;
    const ratio = (worldArea * share) / e.realm_area;
    maxDepth = Math.max(maxDepth, Math.max(1, Math.min(5, Math.ceil(Math.log(ratio) / Math.log(5)))));
  }
  return maxDepth;
}

/**
 * §: 初始人口兜底估算（LLM 漏给 population 时用, 不再抛错）:
 * 有 realm_area → 面积 × 时代密度(与 estimateRealmArea 同一密度表, 反向自洽);
 * 否则按时代典型人口。
 */
function estimateInitialPopulation(e: { era?: string; realm_area?: number }): number {
  const eraText = e.era ?? "";
  const density = estimateEraDensity(eraText);
  if (e.realm_area && e.realm_area > 0) {
    return Math.max(1000, Math.round(e.realm_area * density));
  }
  if (eraText.includes("部落") || eraText.includes("石器") || eraText.includes("史前") || eraText.includes("狩猎")) return 50000;
  if (eraText.includes("城邦") || eraText.includes("古典")) return 200000;
  if (eraText.includes("王国") || eraText.includes("中世纪") || eraText.includes("封建")) return 800000;
  if (eraText.includes("帝国") || eraText.includes("近代") || eraText.includes("工业")) return 2000000;
  if (eraText.includes("魔法") || eraText.includes("真气") || eraText.includes("修真")) return 100000;
  return 50000;
}

/** 时代密度（与 estimateRealmArea 同一张表） */
function estimateEraDensity(eraText: string): number {
  if (eraText.includes("部落") || eraText.includes("原始") || eraText.includes("史前") || eraText.includes("狩猎")) return 3;
  if (eraText.includes("城邦") || eraText.includes("古典")) return 15;
  if (eraText.includes("王国") || eraText.includes("中世纪") || eraText.includes("封建")) return 30;
  if (eraText.includes("帝国") || eraText.includes("近代") || eraText.includes("工业")) return 60;
  if (eraText.includes("魔法") || eraText.includes("真气") || eraText.includes("修真")) return 8;
  return 10;
}

/**
 * §: realm_area 确定性估算（LLM 未给出地盘面积时兜底）: 人口 ÷ 时代密度。
 * 密度参考: 部落(粗放农业/游牧) ~3 人/km²; 城邦 ~15; 王国 ~30; 帝国 ~60; 未知 ~10。
 * 只作层级深度计算输入, 不写入实体卡片。
 */
function estimateRealmArea(population: number, era?: string): number {
  let density = 10; // 未知时代默认
  const eraText = era ?? "";
  if (eraText.includes("部落") || eraText.includes("原始") || eraText.includes("史前") || eraText.includes("狩猎")) density = 3;
  else if (eraText.includes("城邦") || eraText.includes("古典")) density = 15;
  else if (eraText.includes("王国") || eraText.includes("中世纪")) density = 30;
  else if (eraText.includes("帝国") || eraText.includes("近代") || eraText.includes("工业")) density = 60;
  else if (eraText.includes("魔法") || eraText.includes("真气") || eraText.includes("修真")) density = 8;
  return Math.max(100, Math.round(population / density));
}

/**
 * §: 区域命名合法性校验（确定性）——LLM 常违反"纯自然地理名"铁律:
 * 政权词(王国/帝国/部落...)与种族词(矮人/精灵...)不得进入区域名;
 * 层级名不得是"方位+地形"泛称("中央低地"→ 应叫具体地名)。
 * 返回违规清单(供 verifyLayer 注入修正), 空 = 全部合规。
 */
export function regionNameViolations(regions: NonNullable<ParsedInitialState["regions"]>): string[] {
  const POLITICAL_WORDS = ["王国", "帝国", "公国", "共和国", "王朝", "部落", "联盟", "氏族", "城邦", "联邦", "汗国", "酋长国", "王国"];
  const SPECIES_WORDS = ["矮人", "精灵", "兽人", "人类", "龙裔", "侏儒", "半身人", "精灵族", "兽人族", "人聚", "族聚"];
  const DIRECTION_WORDS = ["中央", "东部", "西部", "南部", "北部", "中部", "东境", "西境", "南境", "北境", "腹地", "地带", "区域"];
  const out: string[] = [];
  for (const r of regions ?? []) {
    const name = r.name ?? "";
    const layer = r.parent ? "子区划" : "顶层";
    const pol = POLITICAL_WORDS.find((w) => name.includes(w));
    if (pol) {
      out.push("- 「" + name + "」(" + r.id + ", " + layer + ") 含政权词「" + pol + "」——区域名必须纯自然地理名, 请改为该地的自然名(如" + (r.parent ? "恒河平原" : "奥雷利亚大陆") + ")");
      continue;
    }
    const sp = SPECIES_WORDS.find((w) => name.includes(w));
    if (sp) {
      out.push("- 「" + name + "」(" + r.id + ", " + layer + ") 含种族词「" + sp + "」——区域名不得带居住者身份, 请改为该地本身的自然名");
      continue;
    }
    // 方位+地形泛称检查: 以方位词开头的层级名(次大陆/大区级尤其常见)
    if (r.parent && DIRECTION_WORDS.some((w) => name.startsWith(w))) {
      out.push("- 「" + name + "」(" + r.id + ", " + layer + ") 是以方位词为主体的泛称——层级命名应体现地理层级概念(次大陆级: XX次大陆/XX半岛; 大区级: XX平原/XX盆地; 地区级: XX流域/XX谷地), 请给具体地名");
    }
  }
  return out;
}

/**
 * §: 面积比 → 层级深度参考（确定性计算, 注入 focused-regions 步骤供 LLM 参考）。
 * 世界面积 = worldWidth × worldHeight; 顶层面积 = 世界面积 × share(缺省均分);
 * 建议层级数 N = ceil(log(顶层面积/realm_area) / log(5)), clamp [1, 5]。
 * 面积每缩小约 5 倍为一级（大陆→次大陆→大区→地区→核心区）。
 * 只作参考, 不强制——最终层级链由 LLM 综合判断（地理/命名自洽优先）。
 */
function buildAreaDepthReference(
  topRegions: NonNullable<ParsedInitialState["regions"]>,
  entities: NonNullable<ParsedInitialState["entities"]>,
  measurement: ParsedInitialState["measurement"],
): string {
  const w = measurement?.worldWidth;
  const h = measurement?.worldHeight;
  if (!w || !h || w <= 0 || h <= 0) {
    return "(未给出世界尺度, 无法计算面积比; 请按文明规模自行判断层级深度)";
  }
  const worldArea = w * h;
  const nTop = Math.max(1, topRegions.length);
  const topAreaOf = (id: string): number => {
    const r = topRegions.find((x) => x.id === id);
    const share = typeof r?.share === "number" && r.share > 0 ? r.share : 1 / nTop;
    return worldArea * share;
  };
  const lines = ["世界总面积 ≈ " + formatArea(worldArea) + "（" + w + " × " + h + "）"];
  for (const e of entities) {
    const topId = e.topRegionId;
    const area = e.realm_area;
    if (!topId || !area || area <= 0) {
      lines.push("- " + e.name + ": 缺 realm_area/topRegionId, 无法计算层级参考");
      continue;
    }
    const topArea = topAreaOf(topId);
    const ratio = topArea / area;
    const depth = Math.max(1, Math.min(5, Math.ceil(Math.log(ratio) / Math.log(5))));
    lines.push("- " + e.name + ": 顶层「" + topId + "」≈ " + formatArea(topArea) + ", 地盘 ≈ " + formatArea(area) + " → 面积比 " + Math.round(ratio) + " 倍 → 建议层级深度 " + depth + " 级");
  }
  return lines.join("\n");
}

/** 面积格式化: 万/亿/万亿 */
function formatArea(a: number): string {
  if (a >= 1e12) return (a / 1e12).toFixed(1) + " 万亿";
  if (a >= 1e8) return (a / 1e8).toFixed(1) + " 亿";
  if (a >= 1e4) return (a / 1e4).toFixed(1) + " 万";
  return Math.round(a).toLocaleString();
}

/**
 * 确定性兜底顶层区域（骨架层失败时用）: 一块大陆的物理布局（生物群系网格）。
 * 只在"LLM 骨架与用户都未给出顶层区域"时兜底——保证后续 entities/focused-regions 步骤有真实区域可用。
 */
function deterministicTopRegions(): NonNullable<ParsedInitialState["regions"]> {
  const defs = [
    { id: "coast-east", name: "东部海岸带", biome: "coast", shape: "弧形海岸" },
    { id: "plains-mid", name: "中部平原", biome: "plains", shape: "开阔平原" },
    { id: "mountains-north", name: "北部山地", biome: "mountains", shape: "山链" },
    { id: "desert-south", name: "南部荒漠", biome: "desert", shape: "沙海盆地" },
    { id: "steppe-west", name: "西部草原", biome: "steppe", shape: "起伏草原" },
    { id: "forest-valley", name: "森林谷地", biome: "forest", shape: "河谷林地" },
  ];
  return defs.map((r) => ({ id: r.id, name: r.name, biome: r.biome, shape: r.shape, neighbors: [], connections: {} }));
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
      // 同名 / 同物种 / 近似名(一个 name 包含另一个, 如"沙族"⊂"沙族游牧联盟")都算同一实体——
      // 防 LLM 把同一实体拆成"沙族"+"沙族游牧联盟"两个、其中一个缺 population 导致初始化崩溃
      u.name === e.name || (u.species && e.species && u.species === e.species)
      || (u.name && e.name && (u.name.includes(e.name) || e.name.includes(u.name))),
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
        era: e.era ?? existing.era,
        realm_scale: e.realm_scale ?? existing.realm_scale,
        realm_area: e.realm_area ?? existing.realm_area,
        topRegionId: e.topRegionId ?? existing.topRegionId,
        origin: e.origin ?? existing.origin,
      });
    } else {
      out.push(e);
    }
  }
  // 未被 completed 覆盖的用户实体(LLM 没生成该物种)→ 保留(可能缺 population, 由后续补)。
  // 近似名去重: 已合并实体的 name 包含该用户实体名(或反之, 如"沙族"⊂"沙族游牧联盟")→ 视为同一实体, 不补漏
  for (const u of userList) {
    if (used.has(u.name)) continue;
    const approx = [...used].some((n) => n.includes(u.name) || u.name.includes(n));
    if (approx) continue;
    out.push(u);
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
  // fallback 分配: 实体 regionId 落空时, 按处理顺序优先分到"尚未被其他实体占用"的区域
  //（不同实体不应全挤进第一个区域——尤其不同物种的发源地应分离, §: 发源地分离合理性）
  const usedFallback = new Set<string>();
  const pickFallback = (): string => {
    const free = Object.keys(regions).find((id) => !usedFallback.has(id));
    const chosen = free ?? Object.keys(regions)[0] ?? "plains-mid";
    usedFallback.add(chosen);
    return chosen;
  };
  const entities: EntityCard[] = (completed.entities ?? []).map((e, i) => {
    // 绑定优先级: 最细子区划 regionId → 顶层 topRegionId → 未占用区域 fallback
    //（focused 步骤未回填时, 保证实体至少绑在自己选的顶层, 不会随机错绑到其他大陆）
    const rid = e.regionId && validRegionIds.has(e.regionId) ? e.regionId
      : (e.topRegionId && validRegionIds.has(e.topRegionId) ? e.topRegionId : pickFallback());
    const region = regions[rid];
    // 初始人口: 优先 LLM 给出(结合时代/区域/文明规模综合判断); 缺失时按时代兜底估算——
    // LLM 波动(拆分/合并/漏字段)不应让整个初始化崩溃, 用户要求适配任意指令
    const startPop = typeof e.population === "number" && Number.isFinite(e.population) && e.population > 0
      ? Math.round(e.population)
      : estimateInitialPopulation(e);
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
    // 时代（推导枢纽）: 从初始化指令推断, 供 agent 提示词注入
    if (e.era?.trim()) ent.identity.era = e.era.trim();
    // 起源叙事: LLM 从用户指令推出的隐含信息(共同祖先/分化/迁徙), 替代弱兜底"X起源于Y"
    if (e.origin?.trim()) ent.identity.origin_story = e.origin.trim();
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
    // 邻居候选: 区域邻接 ∪ 同父级兄弟区域 ∪ 父级邻居 ∪ 同顶层其他区域——
    // LLM 常不给子区划填 neighbors, 若无兜底, 同一大陆的多个政权/文明会互不相邻(封建世界"多个王国"错成孤岛)
    const candidateRegionIds = neighborCandidates(e.geography.region, regions);
    for (const nid of candidateRegionIds) {
      for (const nbr of byRegion.get(nid) ?? []) {
        if (nbr.id === e.id) continue;
        // 同顶层(同一大陆)实体默认互为邻居——初始化阶段区域邻接/距离信息常缺失
        //（dimensions 在 createSession 才派生, awareness 无距离可判会返回 0 → 同大陆文明错成孤岛）;
        // 跨顶层(不同大陆)才过 awareness 距离过滤(远隔重洋互不相知, 部落时代跨洲不相邻)。
        const aw = computeAwareness(e, nbr.id, entities, regions, baseLaws);
        const sameTop = sameTopRegionId(e.geography.region, nbr.geography.region, regions);
        if (sameTop || aw >= 0.15) nbrIds.add(nbr.id);
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

/**
 * §: 邻居候选区域集合（含兜底）——区域邻接 ∪ 同父级兄弟 ∪ 父级邻居 ∪ 同顶层其他区域。
 * LLM 生成的子区划常缺 neighbors; 兜底保证同一大陆的实体默认互为邻居候选（最终由 awareness 过滤）。
 */
function neighborCandidates(regionId: string, regions: Record<string, SpaceRegion>): string[] {
  const my = regions[regionId];
  if (!my) return [];
  const out = new Set<string>(my.neighbors ?? []);
  // 父链回溯: 同父兄弟 + 父级邻居
  let parentId: string | undefined = my.parent;
  let guard = new Set<string>();
  while (parentId && regions[parentId] && !guard.has(parentId)) {
    guard.add(parentId);
    const parent = regions[parentId];
    for (const nid of parent.neighbors ?? []) out.add(nid);
    for (const r of Object.values(regions)) {
      if (r.id !== regionId && r.parent === parentId) out.add(r.id);
    }
    parentId = parent.parent;
  }
  // 顶层兜底: 同顶层区域（父链回溯到顶层后, 该顶层下的所有区域）
  let topId = regionId;
  guard = new Set<string>();
  while (regions[topId]?.parent && !guard.has(topId)) { guard.add(topId); topId = regions[topId].parent!; }
  if (topId !== regionId) {
    for (const r of Object.values(regions)) {
      let p = r.parent;
      const g = new Set<string>();
      while (p && regions[p] && !g.has(p)) {
        g.add(p);
        if (p === topId) { out.add(r.id); break; }
        p = regions[p].parent;
      }
    }
  }
  return [...out];
}

/** 两个区域是否同属一个顶层区域（父链回溯到顶层比较）——同顶层 = 同一大陆 */
function sameTopRegionId(a: string, b: string, regions: Record<string, SpaceRegion>): boolean {
  if (!a || !b || !regions[a] || !regions[b]) return false;
  const topOf = (id: string): string => {
    let cur = id;
    const guard = new Set<string>();
    while (regions[cur]?.parent && !guard.has(cur)) { guard.add(cur); cur = regions[cur].parent!; }
    return cur;
  };
  return topOf(a) === topOf(b);
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

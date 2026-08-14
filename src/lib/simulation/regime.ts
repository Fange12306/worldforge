/**
 * 数据驱动的政体推导 (§3.1/§4.1) — 政体形态由确定性数据推导, 而非预设枚举或 LLM 拍脑袋。
 *
 * 核心模型: 政体 = f(当前信号剖面, 历史路径, 世界法则)
 * - 信号剖面: 军事/宗教/经济/组织/航海/探索/集权/农业 各 0-100, 从已有数据算。
 * - 主导维度组合: 取最强的 2 个信号定形态(不是求和), 第 3、4 信号修正。
 * - 历史路径: 从 session.events 读该实体参与的事件, 修正形态(革命→共和, 宗教→神权, 征服→军事)。
 *
 * SIMULATION_DESIGN.md §4.1 "先算数值, 再让 LLM 叙事化"：
 * 推导结果是"数据驱动的合理起点", agent 可在演化关口细化成更细描述(§5.2)。
 * 纯函数, 无 LLM, 可单测。
 */

import type { EntityCard, SimulationSession, SpaceRegion, SimulationEvent } from "./types.ts";
import { mulberry32, type Rng } from "./random.ts";
import { generateLanguageFromWorld, rootFor } from "./culture.ts";

// ── biome 推断（未知 biome → 名称子串 → 标准 biome, 供 physics/measure/black-swan 复用）──

export function inferBiome(biome: string): string {
  const b = (biome ?? "").toLowerCase();
  if (["coast", "ocean", "sea", "island", "海", "岛", "湾"].some((k) => b.includes(k))) return "coast";
  if (["mountain", "hill", "矿", "山", "elevated"].some((k) => b.includes(k))) return "mountains";
  if (["steppe", "grass", "草原", "草", "savanna"].some((k) => b.includes(k))) return "steppe";
  if (["forest", "jungle", "wood", "林", "森", "沼泽", "swamp", "wetland", "marsh", "湿地"].some((k) => b.includes(k))) return "forest";
  if (["desert", "sand", "沙", "漠", "waste"].some((k) => b.includes(k))) return "desert";
  if (["tundra", "ice", "snow", "雪", "冰", "polar"].some((k) => b.includes(k))) return "tundra";
  if (["space", "orbit", "star", "星"].some((k) => b.includes(k))) return "space";
  if (b === "plains" || b.includes("plain")) return "plains";
  return "plains";
}

// ── 物种/biome 偏好语义 ────────────────────────────────

/** 种族 → 偏好语义（映射到 ROOT_MEANINGS, 经 rootFor 取词根） */
const SPECIES_SEMANTICS: Record<string, string[]> = {
  "精灵": ["林", "谷"],
  "兽人": ["火", "石"],
  "矮人": ["山", "石"],
  "人类": ["城", "王", "大地"],
};
const DEFAULT_SEMANTIC = "王";

/** biome → 偏好语义 */
const BIOME_SEMANTICS: Record<string, string[]> = {
  coast: ["海"],
  steppe: ["原"],
  mountains: ["山", "石"],
  forest: ["林"],
  desert: ["大地"],
  tundra: ["石"],
};

/** biome → 高复杂度政体的环境形态修正（草原→游牧, 沿海→海邦, 山地→矿脉城邦, 沙漠→绿洲城邦） */
const BIOME_CATEGORY_FIX: Record<string, { category: string; flavor: string }> = {
  steppe: { category: "游牧联盟", flavor: "汗国" },
  coast: { category: "海邦", flavor: "城邦联盟" },
  mountains: { category: "山地城邦", flavor: "矿脉" },
  desert: { category: "绿洲城邦", flavor: "绿洲" },
};

// ── 信号剖面 ───────────────────────────────────────────

export type PolitySignals = {
  military: number;
  religion: number;
  economy: number;
  organization: number;
  naval: number;
  exploration: number;
  centralization: number;
  agriculture: number;
};

/** 从实体已有数据计算信号剖面（0-100） */
export function computePolitySignals(
  entity: EntityCard,
  region: SpaceRegion,
): PolitySignals {
  const pop = Math.max(entity.metrics.population, 1);
  const military = Math.min(100, Math.round(
    (entity.metrics.military / pop) * 2000
    + (entity.tech["军事"] ?? 0) * 0.5
  ));
  const religion = Math.round(entity.values["信仰强度"] ?? 20);
  const economy = Math.round(entity.metrics.economy ?? 0);
  const organization = Math.round(entity.regime?.organizational_complexity ?? 0);
  const naval = Math.min(100, Math.round(
    (entity.tech["航海"] ?? 0)
    + (inferBiome(region?.biome ?? "") === "coast" ? 25 : 0)
  ));
  const exploration = Math.round(entity.values["探索欲"] ?? 50);
  const centralization = Math.round(entity.regime?.centralization ?? 20);
  const agriculture = Math.round(entity.tech["农业"] ?? 10);

  return { military, religion, economy, organization, naval, exploration, centralization, agriculture };
}

// ── 历史路径（从事件流推导）────────────────────────────

type HistorySignals = {
  revolution: boolean;   // 近期革命/政变/改革 → 共和/过渡
  religious: boolean;    // 近期宗教复兴 → 神权化
  conquest: boolean;     // 近期征服战争 → 军事化
  founding: boolean;     // 新建立
};

/** 从实体参与的历史事件推导路径信号（用 session.events） */
export function deriveHistorySignals(
  entity: EntityCard,
  events: SimulationEvent[],
  recentWindow = 15,
): HistorySignals {
  const mine = events.filter((ev) => ev.participants.includes(entity.id));
  const recent = mine.slice(-recentWindow);
  return {
    // 信号由结构化结果/语义推断, 不由 type 枚举:
    // 灭亡/分裂 → 革命动荡; 吞并 → 征服; 建国 → 新政权; 文化/信仰 → 宗教色彩
    revolution: recent.some((ev) => ev.changes?.some((c) => c.collapsed) || (ev.changes?.some((c) => c.founded))),
    religious: recent.some((ev) => /宗教|信仰|祭祀|神|圣|灵/.test(ev.type + ev.description)),
    conquest: recent.some((ev) => ev.changes?.some((c) => c.absorbed_by)),
    founding: recent.some((ev) => ev.changes?.some((c) => c.founded)),
  };
}

// ── 主导维度组合 → 政体形态 ───────────────────────────

/**
 * 由信号剖面推导政体形态（不带历史修正, 供测试/初始用）。
 * 主导组合（最强 2 信号）定形态, 第 3/4 信号修正, biome 修正（草原→游牧, 沿海→海邦）。
 */
export function derivePolityShape(signals: PolitySignals, biome = "plains"): string {
  const std = inferBiome(biome);
  const fix = BIOME_CATEGORY_FIX[std];
  // 排序最强的 4 个信号
  const ranked = Object.entries(signals)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k as keyof PolitySignals);
  const [top1, top2, top3] = ranked;
  const v = (k: keyof PolitySignals) => signals[k];
  // 主导度: top1 是否显著高于 top2（压倒性主导才走专属形态, 否则平衡 → 官僚/联邦）
  const dominance = v(top1) - v(top2);

  // 低复杂度底座（org < 25）: 部落/氏族为主, 由第 2 信号定偏好
  if (v("organization") < 25) {
    if (top1 === "military" && v("military") > 45) return "军事部落";
    if (top1 === "religion" && v("religion") > 45) return "祭司氏族";
    if (top1 === "economy" || top1 === "naval") return "渔猎氏族";
    if (v("centralization") >= 70) return "酋长制部落";
    return "部落";
  }

  // 中复杂度（org 25-55）: 议事会/联盟, 由主导信号分化
  if (v("organization") < 55) {
    if (top1 === "military" && v("military") > 50) return "战团";
    if (top1 === "religion" && v("religion") > 50) return "神庙联盟";
    if (top1 === "economy" && v("economy") > 40) return "商业同盟";
    if (top1 === "naval" && v("naval") > 45) return "海港城邦联盟";
    if (std === "steppe") return "游牧部落联盟";
    if (std === "coast") return "海港城邦联盟";
    if (v("centralization") >= 70) return "长老议事会";
    return "部落联盟";
  }

  // 高复杂度（org ≥ 55）: 王国/帝国。只有信号压倒性主导才走专属形态,
  // 否则是"均衡发达" → 官僚帝国/联邦/王国（避免经济一高全变商业帝国）。
  // 主导判据: top1 是最高信号, 且显著高于 top2（绝对值≥20; 极端高值≥80时仅需≥10）。
  const dominate = (k: keyof PolitySignals, min: number) =>
    top1 === k && v(k) > min && (dominance >= 20 || (v(k) >= 80 && dominance >= 10));

  // 环境强修正优先（草原/沿海/山地/沙漠的高复杂度文明, 环境塑造政体; 不要求信号主导）
  if (fix && (std === "steppe" || std === "coast" || std === "mountains" || std === "desert") && v(top1) > 40) {
    return fix.category;
  }
  if (dominate("military", 50)) {
    return v("centralization") >= 60 ? "军事帝国" : "征服王国";
  }
  if (dominate("religion", 50)) {
    return v("centralization") >= 60 ? "神权帝国" : "教权王国";
  }
  if (dominate("naval", 45)) {
    return "海上帝国";
  }
  if (dominate("economy", 55) || (top1 === "economy" && v("economy") >= 70 && dominance >= 10)) {
    return "商业帝国";
  }
  if (dominate("exploration", 60)) {
    return "殖民帝国";
  }
  if (v("agriculture") > 60 && v("centralization") > 55 && dominance >= 15) {
    return "农耕帝国";
  }
  if (v("centralization") >= 70) return "中央集权王国";
  if (v("centralization") < 40) return "联邦";
  if (top3 === "economy" && v("economy") > 40) return "城邦联盟";
  return "官僚王国";
}

// ── 历史路径修正 ───────────────────────────────────────

/** 用历史路径修正政体形态（革命→共和, 宗教→神权, 征服→军事）。
 * 优先级: 革命(推翻旧政体) > 宗教 > 征服。 */
export function applyHistoryToPolity(shape: string, history: HistorySignals): string {
  if (history.revolution) {
    // 革命/政变推翻旧政体 → 共和/过渡（无论是否伴随征服）
    if (shape.includes("帝国") || shape.includes("王国") || shape.includes("王朝")) {
      return history.religious ? "神权共和" : "共和国";
    }
    if (shape.includes("部落") || shape.includes("联盟")) {
      return "公民大会制";
    }
    return `${shape}·革命政府`;
  }
  if (history.religious && !shape.includes("神权") && !shape.includes("祭司") && !shape.includes("神庙")) {
    return shape.includes("帝国") ? "神权帝国" : shape.includes("王国") ? "教权王国" : `${shape}·神权化`;
  }
  if (history.conquest && !shape.includes("军事") && !shape.includes("征服") && !shape.includes("战团")) {
    return shape.includes("帝国") ? "军事帝国" : shape.includes("王国") ? "征服王朝" : shape;
  }
  if (history.founding && shape.includes("部落")) {
    return "新生的" + shape;
  }
  return shape;
}

// ── 命名（文化语言组合）────────────────────────────────

/** 哈希字符串 → seed（供 rng 兜底） */
function hashSeed(str: string): number {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function resolveLanguage(
  entity: EntityCard,
  region: SpaceRegion,
  session: SimulationSession,
): NonNullable<SimulationSession["languages"][string]> {
  const culture = entity.identity.culture ? session.cultures?.[entity.identity.culture] : undefined;
  const lang = culture?.languageId && session.languages?.[culture.languageId]
    ? session.languages[culture.languageId]
    : undefined;
  if (lang) return lang;
  return generateLanguageFromWorld({
    seed: hashSeed(entity.id),
    species: entity.identity.species,
    regionBiome: inferBiome(region?.biome ?? ""),
    cultureName: entity.identity.culture,
  });
}

/**
 * 数据驱动的政体推导。
 * 输入实体 + 区域 + 会话, 输出政体形态（自由字符串, 如"北境三河同盟"）。
 * 信号剖面 + 历史路径(事件流) → 形态 → 文化语言命名。
 * 确定性: 同输入 → 同输出（rng 由 entity.id + org 派生）。
 */
export function derivePoliticalForm(
  entity: EntityCard,
  region: SpaceRegion,
  session: SimulationSession,
  rng?: Rng,
): string {
  const signals = computePolitySignals(entity, region);
  const shape = derivePolityShape(signals, region?.biome ?? "");
  const history = deriveHistorySignals(entity, session.events ?? []);
  const form = applyHistoryToPolity(shape, history);
  const r = rng ?? mulberry32(hashSeed(entity.id) ^ Math.round(signals.organization * 1000));

  const lang = resolveLanguage(entity, region, session);
  const stdBiome = inferBiome(region?.biome ?? "");

  // 词根池: 物种偏好 + 环境偏好 + 地理限定（河）
  const semanticPool: string[] = [
    ...(SPECIES_SEMANTICS[entity.identity.species] ?? [DEFAULT_SEMANTIC]),
    ...(BIOME_SEMANTICS[stdBiome] ?? [DEFAULT_SEMANTIC]),
  ];
  if ((region?.environment?.geography?.rivers ?? 0) > 0) semanticPool.push("河");
  const uniq = [...new Set(semanticPool)];
  const roots = uniq
    .map((sem) => rootFor(lang, sem))
    .filter((w): w is string => !!w && w.length > 0);

  const picked: string[] = [];
  if (roots.length > 0) {
    const n = r() < 0.6 ? 1 : 2;
    const pool = [...roots];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = Math.floor(r() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
  }
  const head = picked.join("") || form;

  // 后缀池: 部落/联盟层 → 城/邦; 王国/帝国层 → 国/帝国
  const isComplex = form.includes("帝国") || form.includes("王国") || form.includes("王朝") || form.includes("霸权");
  const suffixPool = isComplex ? lang.morphology.nationSuffixes : lang.morphology.placeSuffixes;
  const suffix = suffixPool[Math.floor(r() * suffixPool.length)] ?? "";

  // 组合: 头 + 形态 + (后缀)
  const composed = suffix
    ? `${head}${form}·${suffix}`
    : `${head}${form}`;
  return composed.trim();
}

/** 便捷: 政体是否已超出部落时代（供 bridge 等按组织复杂度判断用） */
export function isComplexPolity(entity: EntityCard): boolean {
  return (entity.regime?.organizational_complexity ?? 0) >= 40;
}

// ── 宗教/信仰体系推导（§4.1 数据驱动, 非预设）──────────────

/** biome → 自然崇拜倾向（环境塑造宗教） */
const BIOME_DEITY: Record<string, string[]> = {
  coast: ["海神", "潮汐"],
  steppe: ["苍天", "马神"],
  mountains: ["山灵", "矿脉"],
  forest: ["林神", "祖灵"],
  desert: ["烈日", "风沙"],
  tundra: ["冰川", "极夜"],
  plains: ["大地", "丰饶"],
};

/**
 * 数据驱动的宗教/信仰体系推导。
 * 宗教 = f(信仰强度, 环境, 组织度, 历史宗教事件)。
 * - 信仰强度极低 → 无系统宗教(世俗/淡薄)
 * - 信仰强度高 + 组织度高 → 制度化神系(教廷/祭司团)
 * - 信仰强度高 + 组织度低 → 自然崇拜/万物有灵
 * - 环境决定崇拜对象(海神/山灵/林神…)
 * - 历史宗教事件/改革 → 一神教/异端分裂修正
 */
export function deriveReligion(
  entity: EntityCard,
  region: SpaceRegion,
  session: SimulationSession,
): string {
  const faith = entity.values["信仰强度"] ?? 20;
  const org = entity.regime?.organizational_complexity ?? 10;
  const stdBiome = inferBiome(region?.biome ?? "");
  const deities = BIOME_DEITY[stdBiome] ?? ["大地", "祖灵"];

  // 历史宗教事件: 按语义文本判断(宗教/信仰/祭祀/神/圣/灵), 不靠 type 枚举
  const religionEvents = (session.events ?? []).filter((ev) =>
    ev.participants.includes(entity.id) && /宗教|信仰|祭祀|神|圣|灵/.test(ev.type + ev.description),
  );

  // 低信仰 → 无系统宗教
  if (faith < 15) {
    return religionEvents.length > 0 ? "淡薄的祖灵记忆" : "世俗";
  }

  // 信仰高 + 组织高 → 制度化神系
  if (faith > 60 && org > 50) {
    if (religionEvents.length >= 2) return `${deities[0]}一神教（祭司团）`;
    if (religionEvents.length >= 1) return `${deities[0]}正教（教廷）`;
    return `${deities[0]}神系（祭司团）`;
  }

  // 信仰高 + 组织低 → 自然崇拜/万物有灵
  if (faith > 40) {
    return `${deities[1]}崇拜（万物有灵）`;
  }

  // 中信仰 → 朴素信仰
  return `${deities[0]}信仰`;
}

// ── 意识形态推导（§4.1 数据驱动, 非预设）──────────────────

/**
 * 数据驱动的意识形态推导。
 * 意识形态 = f(信号剖面, 政体形态, 环境)。
 * - 军事主导 → 尚武/扩张主义
 * - 商业主导 → 重商/实用主义
 * - 宗教主导 → 神权/原教旨
 * - 探索主导 → 探险/开放
 * - 组织高+集权低 → 共和/民主思潮
 * - 集权高 → 威权/中央集权
 * - 均衡 → 传统/保守
 */
export function deriveIdeology(
  entity: EntityCard,
  region: SpaceRegion,
  session: SimulationSession,
): string {
  const sig = computePolitySignals(entity, region);
  const shape = derivePolityShape(sig, region?.biome ?? "");

  // 由政体形态直接推断主导意识形态
  if (shape.includes("军事") || shape.includes("战团") || shape.includes("征服")) return "尚武扩张主义";
  if (shape.includes("商业") || shape.includes("城邦") || shape.includes("商")) return "重商实用主义";
  if (shape.includes("神权") || shape.includes("教权") || shape.includes("祭司") || shape.includes("神庙")) return "神权正统主义";
  if (shape.includes("殖民") || shape.includes("探险")) return "探险殖民主义";
  if (shape.includes("共和") || shape.includes("联邦") || shape.includes("大会")) return "共和民主主义";

  // 非政体推断 → 用信号
  if (sig.centralization >= 70) return "威权集权主义";
  if (sig.exploration > 60) return "进取革新思潮";
  if (sig.organization >= 55 && sig.centralization < 40) return "共和思潮";
  if (sig.religion > 50) return "传统虔诚";
  return "传统保守";
}

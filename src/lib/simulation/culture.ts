/**
 * 文化-语言系统 — 命名与文化强相关 + 随历史演化。
 *
 * 对应设计讨论：
 * - 推演中的任何名称（地区/国度/城市/人名）必须和该实体的文化、语言、文字体系强相关。
 * - 不是套模板的"西部大陆""南部王国"，而是从文化的音系/词根/构词规则里"长出来"。
 * - 语言文化既约束命名，又随历史演化（征服→借词, 分裂→方言分化, 宗教/技术→文字改革），
 *   历史推演影响它、也被它影响（双向）。
 *
 * 本模块：
 * 1. 命名生成器 — 从 LanguageSystem 音系/词根/构词规则生成地名/国名/人名/城市名。
 * 2. 语言演化 — 征服→借词, 分裂→方言分化, 随 tick 演化。
 * 3. 预设语言系统（中原/北欧/斯拉夫/阿拉伯/埃及 等文化风格的词根与音系）。
 */

import type { Culture, LanguageSystem } from "./types.ts";
import { mulberry32, type Rng } from "./random.ts";

// ── 命名生成器 ────────────────────────────────────────

export type NameKind = "place" | "nation" | "person" | "city";

/**
 * 从语言系统生成一个符合该文化音系/构词规则的名字。
 * 用 seeded rng 保证确定性（可复现测试）。
 */
export function generateName(
  lang: LanguageSystem,
  kind: NameKind,
  rng: Rng,
  culture?: Culture,
): string {
  // 词根 + 后缀组合（复合命名）
  const rootPool = Object.values(lang.roots);
  // 文化偏好词根优先（§: 命名与文化的 favoredRoots 相关）
  let preferred = rootPool;
  if (culture?.namingStyle?.favoredRoots?.length) {
    const favored = culture.namingStyle.favoredRoots
      .map((sem) => lang.roots[sem])
      .filter(Boolean) as string[];
    if (favored.length) preferred = [...favored, ...rootPool];
  }

  switch (kind) {
    case "place": {
      const root = pick(preferred, rng);
      const suffix = pick(lang.morphology.placeSuffixes, rng);
      return compose(root, suffix, lang);
    }
    case "nation": {
      const root = pick(preferred, rng);
      const suffix = pick(lang.morphology.nationSuffixes, rng);
      return compose(root, suffix, lang);
    }
    case "city": {
      const root = pick(preferred, rng);
      const suffix = pick(lang.morphology.placeSuffixes, rng);
      const name = compose(root, suffix, lang);
      return name;
    }
    case "person": {
      const pattern = lang.morphology.namePatterns;
      const root = pick(rootPool, rng);
      // 父名制（patronymic）或 前缀/中缀/后缀组合
      if (lang.morphology.patronymic && pattern.suffix?.length) {
        const fatherRoot = pick(rootPool, rng);
        const patr = pick(pattern.suffix, rng);
        return compose(fatherRoot, patr, lang);
      }
      const prefix = pattern.prefix?.length ? pick(pattern.prefix, rng) : "";
      const suffix = pattern.suffix?.length ? pick(pattern.suffix, rng) : "";
      return `${prefix}${root}${suffix}` || root;
    }
  }
}

/** 组合词根与后缀（处理中间音变，如 "burg" + "-grad" 或避免叠音） */
export function compose(root: string, suffix: string, lang: LanguageSystem): string {
  if (!suffix) return root;
  // 避免词根与后缀重复音素（如 "burg-burg"）
  for (const f of lang.phonology.forbidden) {
    if (root.endsWith(f) && suffix.startsWith(f)) {
      suffix = suffix.slice(f.length);
      break;
    }
  }
  return root + suffix;
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── 语言演化 ──────────────────────────────────────────

/**
 * 语言接触演化（征服/贸易 → 借词）。
 * 征服者语言从被征服文化借入词汇，或反向（被征服者留下底层词）。
 * 返回演化后的语言 + 借词事件描述。
 */
export function evolveLanguageBorrowing(
  conquerorLang: LanguageSystem,
  conqueredLang: LanguageSystem,
  meaning: string,
  tick: number,
  rng?: Rng,
): { lang: LanguageSystem; loanword: string } {
  // 借入一个词根（表示新接触的概念，如地名/物产）
  const roots = Object.values(conqueredLang.roots);
  const r = rng ?? mulberry32(tick * 2654435761);
  const borrowedRoot = roots[Math.floor(r() * roots.length)] ?? "";
  if (!borrowedRoot) return { lang: conquerorLang, loanword: "" };

  const loanword = borrowedRoot;
  const updated: LanguageSystem = {
    ...conquerorLang,
    loanwords: [
      ...conquerorLang.loanwords,
      { from: conqueredLang.name, word: loanword, meaning, tick },
    ],
    roots: { ...conquerorLang.roots, [meaning]: loanword },
    updated_at: tick,
  };
  return { lang: updated, loanword };
}

/**
 * 方言分化（文化分裂/地理隔绝 → 方言 → 独立语言）。
 * 返回一个从原语言派生、音系略有偏移的新语言（方言变体）。
 */
export function divergeLanguage(
  parent: LanguageSystem,
  newName: string,
  tick: number,
  rng: Rng,
): LanguageSystem {
  // 方言：词根保留大部分，音系轻微偏移（去掉/增加一两个音素）
  const consonants = [...parent.phonology.consonants];
  const shift = pick(consonants, rng);
  // 轻微音变：替换一个辅音（模拟语音演变）
  const shiftedConsonants = consonants.map((c) => (c === shift && rng() < 0.5 ? pick(consonants, rng) : c));
  const dialects = [...parent.dialects, newName];

  return {
    ...parent,
    id: `${parent.id}-dialect-${tick}`,
    name: newName,
    phonology: { ...parent.phonology, consonants: shiftedConsonants },
    loanwords: [...parent.loanwords],
    dialects,
    first_tick: tick,
    updated_at: tick,
  };
}

/**
 * 文字体系演化（§: 宗教/技术变革 → 文字改革）。
 * 返回演化后的文字体系描述。
 */
export function evolveScript(
  lang: LanguageSystem,
  newScript: LanguageSystem["script"],
  reason: string,
  tick: number,
): LanguageSystem {
  return {
    ...lang,
    script: newScript,
    dialects: [...lang.dialects, `文字改革: ${reason} (tick ${tick})`],
    updated_at: tick,
  };
}

// ── 预设语言系统（不同文化风格）────────────────────────

/** 中原文化（表意文字, "州/郡/王国" 后缀） */
export const ZHONGYUAN_LANG: LanguageSystem = {
  id: "zhongyuan",
  name: "中原语",
  phonology: {
    consonants: ["zh", "ch", "sh", "g", "k", "h", "m", "n", "l", "b", "p", "d", "t", "w", "y"],
    vowels: ["a", "e", "i", "o", "u", "ü"],
    syllablePatterns: ["CV", "CVC"],
    forbidden: ["张", "李"],
  },
  roots: {
    "大地": "土", "河": "川", "山": "山", "城": "城", "王": "王",
    "海": "海", "林": "林", "原": "原", "谷": "谷", "龙": "龙", "天": "天",
  },
  morphology: {
    placeSuffixes: ["州", "郡", "府", "县", "城", "关"],
    nationSuffixes: ["国", "王国", "朝"],
    namePatterns: {
      prefix: ["赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈"],
      infix: [],
      suffix: ["明", "文", "武", "德", "仁", "义", "礼", "智", "信"],
      parts: ["prefix", "suffix"],
    },
    patronymic: false,
  },
  script: "logographic",
  loanwords: [],
  dialects: [],
  first_tick: 0,
  updated_at: 0,
};

/** 北欧文化（表音字母, 父名制, "-heim/-gard/-vik" 后缀） */
export const NORSE_LANG: LanguageSystem = {
  id: "norse",
  name: "古北欧语",
  phonology: {
    consonants: ["b", "d", "f", "g", "h", "j", "k", "l", "m", "n", "r", "s", "t", "v", "þ", "ð"],
    vowels: ["a", "e", "i", "o", "u", "y", "æ", "ø"],
    syllablePatterns: ["CVC", "CV", "CCVC"],
    forbidden: [],
  },
  roots: {
    "大地": "heim", "河": "fljót", "山": "fjall", "城": "borg", "王": "konungr",
    "海": "sær", "林": "skógr", "原": "völlr", "谷": "dalr", "龙": "dreki", "天": "himinn",
    "石": "steinn", "冰": "ís", "斧": "öx", "狼": "úlfr", "鹰": "örn",
  },
  morphology: {
    placeSuffixes: ["heim", "vik", "fjord", "dal", "nes"],
    nationSuffixes: ["land", "rike", "mark"],
    namePatterns: {
      prefix: ["Har", "Ragn", "Eir", "Sig", "Thor", "Ol", "Bjorn", "Erik", "Ing", "Gunn"],
      infix: [],
      suffix: ["son", "dottir", "und", "ar"],
      parts: ["prefix", "suffix"],
    },
    patronymic: true,
  },
  script: "alphabetic",
  loanwords: [],
  dialects: [],
  first_tick: 0,
  updated_at: 0,
};

/** 斯拉夫文化（表音字母, "-grad/-pol/-mir" 后缀, 父名制 -ovich） */
export const SLAVIC_LANG: LanguageSystem = {
  id: "slavic",
  name: "斯拉夫语",
  phonology: {
    consonants: ["b", "v", "g", "d", "zh", "z", "k", "l", "m", "n", "p", "r", "s", "t", "f", "kh", "ts", "ch", "sh"],
    vowels: ["a", "e", "i", "o", "u", "y"],
    syllablePatterns: ["CVC", "CCVC", "CV"],
    forbidden: [],
  },
  roots: {
    "大地": "zem", "河": "reka", "山": "gora", "城": "grad", "王": "knyaz",
    "海": "more", "林": "les", "原": "pol", "谷": "dol", "龙": "zmey", "天": "nebo",
    "火": "ogon", "铁": "zhelezo", "麦": "zerno", "狼": "volk", "熊": "medved",
  },
  morphology: {
    placeSuffixes: ["grad", "pol", "mir", "sk", "gorod"],
    nationSuffixes: ["ia", "ya", "land"],
    namePatterns: {
      prefix: ["Vla", "Dobr", "Yaro", "Svya", "Vladi", "Mi", "Bo", "Drago", "Stan", "Rado"],
      infix: [],
      suffix: ["imir", "oslav", "omir", "islav"],
      parts: ["prefix", "suffix"],
    },
    patronymic: true,
  },
  script: "alphabetic",
  loanwords: [],
  dialects: [],
  first_tick: 0,
  updated_at: 0,
};

/** 阿拉伯/沙漠文化（辅音文字 abjad, "-istan/-abad/-stan" 后缀） */
export const ARABIC_LANG: LanguageSystem = {
  id: "arabic",
  name: "沙漠语",
  phonology: {
    consonants: ["b", "t", "th", "j", "h", "kh", "d", "dh", "r", "z", "s", "sh", "s", "q", "k", "l", "m", "n"],
    vowels: ["a", "i", "u"],
    syllablePatterns: ["CVC", "CV", "CCVC"],
    forbidden: [],
  },
  roots: {
    "大地": "ard", "河": "nahr", "山": "jabal", "城": "madina", "王": "malik",
    "海": "bahr", "林": "ghaba", "原": "sahra", "谷": "wadi", "龙": "tinnin", "天": "sama",
    "水": "ma", "沙": "raml", "绿洲": "waha", "骆驼": "jamal", "鹰": "nasr",
  },
  morphology: {
    placeSuffixes: ["abad", "istan", "stan", "iyah"],
    nationSuffixes: ["istan", "iya", "ah"],
    namePatterns: {
      prefix: ["Al", "Abd", "Ibn", "Umm", "Abu", "Mu", "Sul", "Nas", "Hak", "Jab"],
      infix: [],
      suffix: ["allah", "din", "rahman", "karim"],
      parts: ["prefix", "suffix"],
    },
    patronymic: true,
  },
  script: "abjad",
  loanwords: [],
  dialects: [],
  first_tick: 0,
  updated_at: 0,
};

// ── 文化工厂 ──────────────────────────────────────────

/** 创建一个文化（绑定语言系统 + 默认命名习惯） */
export function createCulture(
  id: string,
  name: string,
  languageId: string,
  opts: Partial<Culture> = {},
): Culture {
  return {
    id,
    name,
    languageId,
    namingStyle: opts.namingStyle,
    history: [],
    first_tick: 0,
    ...opts,
  };
}

/** 语义 → 词根（从语言系统取；未知语义返回空） */
export function rootFor(lang: LanguageSystem, meaning: string): string | null {
  return lang.roots[meaning] ?? null;
}

// ── 从世界初始状态生成语言（§: 语言不预设, 从物种/地理/文化涌现）──

/** 常用音素池（供从种族派生音系） */
const PHONEME_POOL = {
  consonants: ["b", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "y", "z", "sh", "th", "kh", "ts", "ng"],
  vowels: ["a", "e", "i", "o", "u", "aa", "ei", "ou", "ai"],
};

/** 语义词根主题（供从区域地理派生词根库） */
const ROOT_MEANINGS = ["大地", "河", "山", "城", "王", "海", "林", "原", "谷", "火", "水", "石"];

/**
 * 从世界的初始状态生成一种语言（seeded 确定性）。
 * - 音系：由物种的语音特征派生（没有则从音素池随机采样）——种族生理决定发音范围。
 * - 词根：由初始区域的地理特征派生（沿海→海词, 山地→山词）——环境塑造词汇。
 * - 构词：由初始文化的命名习惯派生——文化偏好决定构词。
 * 每个世界生成的语言独一无二, 与地球无关。
 */
export function generateLanguageFromWorld(opts: {
  seed: number;
  species: string;               // 种族名（音系哈希来源）
  regionBiome?: string;          // 初始区域（词根来源）
  cultureName?: string;          // 文化名（语言名）
  phonology?: { consonants?: string[]; vowels?: string[] };  // 可选: 世界初始状态定义发音特征
}): LanguageSystem {
  const rng = createLanguageRng(opts.seed, opts.species);
  const species = opts.species || "族";
  const langName = opts.cultureName ? `${opts.cultureName}语` : `${species}语`;

  // 音系：从物种哈希采样音素（可选显式定义优先）
  const consonants = opts.phonology?.consonants?.length
    ? opts.phonology.consonants
    : sampleUnique(PHONEME_POOL.consonants, 6 + Math.floor(rng() * 5), rng);
  const vowels = opts.phonology?.vowels?.length
    ? opts.phonology.vowels
    : sampleUnique(PHONEME_POOL.vowels, 3 + Math.floor(rng() * 3), rng);

  // 词根：从区域地理派生（每个语义一个词根, 由音素组合）
  const roots: Record<string, string> = {};
  for (const meaning of ROOT_MEANINGS) {
    roots[meaning] = makeWord(consonants, vowels, rng);
  }

  // 构词：后缀由音素池采样
  const placeSuffixes = [makeWord(consonants, vowels, rng), makeWord(consonants, vowels, rng), makeWord(consonants, vowels, rng)];
  const nationSuffixes = [makeWord(consonants, vowels, rng), makeWord(consonants, vowels, rng)];
  const personPrefix = sampleUnique(consonants, 6, rng).map((c) => c + pickArray(vowels, rng));
  const personSuffix = sampleUnique(consonants, 4, rng);

  return {
    id: `lang-${opts.seed}-${species}`,
    name: langName,
    phonology: { consonants, vowels, syllablePatterns: ["CV", "CVC", "CV"], forbidden: [] },
    roots,
    morphology: {
      placeSuffixes,
      nationSuffixes,
      namePatterns: { prefix: personPrefix, infix: [], suffix: personSuffix, parts: ["prefix", "root", "suffix"] },
      patronymic: rng() < 0.5, // 部分文化用父名制
    },
    script: deriveScript(consonants, vowels, rng),
    loanwords: [],
    dialects: [],
    first_tick: 0,
    updated_at: 0,
  };
}

/**
 * 从世界初始实体生成整套语言（每个种族一种语言）。
 * 返回 { languages, cultures }，供 createSession 注入。
 */
export function generateWorldLanguages(opts: {
  seed: number;
  entities: Array<{ species: string; regionBiome?: string; cultureName?: string; phonology?: { consonants?: string[]; vowels?: string[] } }>;
}): { languages: Record<string, LanguageSystem>; cultures: Record<string, Culture> } {
  const languages: Record<string, LanguageSystem> = {};
  const cultures: Record<string, Culture> = {};
  // 按种族分组, 每种族一种语言
  const bySpecies = new Map<string, typeof opts.entities>();
  for (const e of opts.entities) {
    if (!bySpecies.has(e.species)) bySpecies.set(e.species, []);
    bySpecies.get(e.species)!.push(e);
  }
  for (const [species, members] of bySpecies) {
    const first = members[0];
    const lang = generateLanguageFromWorld({
      seed: opts.seed + species.length * 7919,
      species,
      regionBiome: first.regionBiome,
      cultureName: first.cultureName,
      phonology: first.phonology,
    });
    languages[lang.id] = lang;
    // 每个成员一个文化（绑定同一语言）
    for (const m of members) {
      const cultureName = m.cultureName ?? `${m.species}${m.regionBiome ? "-" + m.regionBiome : ""}族`;
      const culture: Culture = {
        id: cultureName,
        name: cultureName,
        languageId: lang.id,
        history: [],
        first_tick: 0,
      };
      cultures[cultureName] = culture;
    }
  }
  return { languages, cultures };
}

// ── 语言生成辅助 ──────────────────────────────────────

function createLanguageRng(seed: number, salt: string): Rng {
  // 从 seed + 种族名哈希出确定性随机源
  let h = 2166136261;
  for (const c of `${seed}:${salt}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return mulberry32(h >>> 0);
}

function sampleUnique(arr: string[], n: number, rng: Rng): string[] {
  const pool = [...arr];
  const out: string[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

function pickArray<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * 从音系结构推导文字体系（数据驱动, 不随机预设）。
 * - 辅音多(≥8) → 表音字母(alphabetic), 音位富足便于音素文字
 * - 元音多(≥5) → 音节文字(syllabic), 一音一字
 * - 音节简单(少辅音少元音) → 表意(logographic), 有限音素逼向语义
 * - 沙漠/游牧文化传统 → 辅音文字(abjad)
 */
function deriveScript(consonants: string[], vowels: string[], rng: Rng): string {
  const c = consonants.length;
  const v = vowels.length;
  if (c >= 9 && rng() < 0.7) return "alphabetic";   // 音位富足 → 字母
  if (v >= 5 && rng() < 0.7) return "syllabic";     // 元音多 → 音节文字
  if (c <= 5 && v <= 3) return "logographic";        // 音素有限 → 表意
  if (rng() < 0.25) return "abjad";                 // 少量辅音文字传统
  return "alphabetic";
}

/** 用音素组合成一个词（音节结构: CV / CVC） */
function makeWord(consonants: string[], vowels: string[], rng: Rng): string {
  const pattern = rng() < 0.5 ? "CV" : "CVC";
  let word = "";
  for (const ch of pattern) {
    if (ch === "C") word += pickArray(consonants, rng);
    else word += pickArray(vowels, rng);
  }
  return word;
}

/** 预设语言系统库（§: 命名与文化强相关的起点） */
export function presetLanguages(): Record<string, LanguageSystem> {
  return {
    [ZHONGYUAN_LANG.id]: ZHONGYUAN_LANG,
    [NORSE_LANG.id]: NORSE_LANG,
    [SLAVIC_LANG.id]: SLAVIC_LANG,
    [ARABIC_LANG.id]: ARABIC_LANG,
  };
}

/** 为文化分配一个语言系统 id（就近分配, 供 createSession 自动绑定） */
export function pickLanguageId(languages: Record<string, LanguageSystem>, rng?: Rng): string {
  const ids = Object.keys(languages);
  if (ids.length === 0) return "";
  const r = rng ?? mulberry32(2654435761);
  return ids[Math.floor(r() * ids.length)] ?? "";
}

/** 便捷：为实体生成符合其文化语言系统的名字 */
export function nameForEntity(
  session: { languages: Record<string, LanguageSystem>; cultures: Record<string, Culture> },
  cultureId: string | undefined,
  kind: NameKind,
  rng: Rng,
): string {
  const culture = cultureId ? session.cultures[cultureId] : undefined;
  const lang = culture?.languageId ? session.languages[culture.languageId] : undefined;
  if (lang) {
    return generateName(lang, kind, rng, culture);
  }
  // 无文化绑定 → 用默认语言（中原语）
  return generateName(ZHONGYUAN_LANG, kind, rng);
}

/** 自然实体类型 → 语义词根（供 nameFeature 命名偏置, 语义走 ROOT_MEANINGS） */
const FEATURE_SEMANTIC: Record<string, string> = {
  "山脉": "山", "山地": "山", "山": "山",
  "河流": "河", "河": "河",
  "湖泊": "水", "湖": "水",
  "海洋": "海", "海": "海", "海湾": "海", "海峡": "海",
  "森林": "林", "林": "林",
  "平原": "原", "原": "原",
  "沙漠": "大地", "荒漠": "大地",
  "火山": "火", "沼泽": "水", "湿地": "水", "冰原": "石", "雪山": "山",
};

/**
 * 为自然实体生成一个符合发现者文化语言的名称（命名主观性, §4.0②）。
 * 用 kind 偏置语义词根(山脉→山, 河流→河...), 组合语言的后缀。
 */
export function nameFeature(
  lang: LanguageSystem,
  kind: string | undefined,
  rng: Rng,
  culture?: Culture,
): string {
  const semantic = (kind && FEATURE_SEMANTIC[kind]) || "大地";
  // 偏置词根池: 该语义的词根优先
  const root = rootFor(lang, semantic);
  const pool = root ? [root, ...Object.values(lang.roots)] : Object.values(lang.roots);
  const picked = pool[Math.floor(rng() * Math.min(pool.length, 3))] ?? root ?? "地";
  const suffix = lang.morphology.placeSuffixes[Math.floor(rng() * lang.morphology.placeSuffixes.length)] ?? "";
  return compose(picked, suffix, lang);
}

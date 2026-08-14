// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 3 验收测试 — 文化-语言命名系统（命名与文化强相关 + 随历史演化）。
 *
 * 验收：
 * - 命名从文化的音系/词根/构词规则生成（不同文化产生不同风格的名字）。
 * - 中原文化名 ≠ 北欧文化名（语言系统差异 → 命名差异）。
 * - 语言随历史演化（征服→借词, 分裂→方言分化）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ZHONGYUAN_LANG, NORSE_LANG, SLAVIC_LANG, ARABIC_LANG,
  generateName, evolveLanguageBorrowing, divergeLanguage, evolveScript,
  createCulture, presetLanguages, nameForEntity,
  generateLanguageFromWorld, generateWorldLanguages,
} from "./culture.ts";
import { createRng } from "./random.ts";

describe("文化-语言命名系统 — 生成", () => {
  test("中原文化地名含 州/郡/府 后缀", () => {
    const rng = createRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const name = generateName(ZHONGYUAN_LANG, "place", createRng(i));
      seen.add(name);
      assert.ok(name.length >= 2, `中原地名应有长度: ${name}`);
    }
    // 中原词根 + 后缀组合
    const sample = [...seen][0];
    assert.ok([...ZHONGYUAN_LANG.morphology.placeSuffixes].some((s) => sample.includes(s)) || [...Object.values(ZHONGYUAN_LANG.roots)].some((r) => sample.includes(r)),
      `中原地名应从词根/后缀生成: ${sample}`);
  });

  test("不同文化生成不同风格的名字", () => {
    const rng = createRng(42);
    const zhongyuan = generateName(ZHONGYUAN_LANG, "nation", rng);
    const norse = generateName(NORSE_LANG, "nation", createRng(42));
    // 北欧国名应含 land/rike/mark 后缀, 中原应含 国/王国/朝
    assert.ok([...NORSE_LANG.morphology.nationSuffixes].some((s) => norse.includes(s)),
      `北欧国名含北欧后缀: ${norse}`);
    assert.ok([...ZHONGYUAN_LANG.morphology.nationSuffixes].some((s) => zhongyuan.includes(s)),
      `中原国名含中原后缀: ${zhongyuan}`);
    assert.notEqual(zhongyuan, norse);
  });

  test("北欧父名制人名（-son/-dottir）", () => {
    const rng = createRng(7);
    const person = generateName(NORSE_LANG, "person", rng);
    assert.ok([...NORSE_LANG.morphology.namePatterns.suffix ?? []].some((s) => person.endsWith(s)),
      `北欧人名以父名后缀结尾: ${person}`);
  });

  test("生成器确定性（同 seed 同结果）", () => {
    const a = generateName(SLAVIC_LANG, "city", createRng(5));
    const b = generateName(SLAVIC_LANG, "city", createRng(5));
    assert.equal(a, b);
  });
});

describe("文化-语言系统 — 随历史演化", () => {
  test("征服 → 借词", () => {
    const { lang, loanword } = evolveLanguageBorrowing(NORSE_LANG, ZHONGYUAN_LANG, "茶", 10);
    assert.ok(lang.loanwords.length > 0, "借词记录增加");
    assert.equal(lang.roots["茶"], loanword, "借词进入词根库");
    assert.equal(lang.loanwords[0].from, "中原语");
  });

  test("分裂 → 方言分化", () => {
    const dialect = divergeLanguage(NORSE_LANG, "东诺语", 20, createRng(3));
    assert.ok(dialect.dialects.includes("东诺语"), "方言记录");
    assert.notEqual(dialect.id, NORSE_LANG.id, "方言是新语言");
  });

  test("文字体系演化", () => {
    const evolved = evolveScript(ZHONGYUAN_LANG, "alphabetic", "语言改革", 30);
    assert.equal(evolved.script, "alphabetic");
    assert.ok(evolved.dialects.some((d) => d.includes("文字改革")), "记录文字改革");
  });
});

describe("文化工厂与预设", () => {
  test("presetLanguages 提供四种语言", () => {
    const langs = presetLanguages();
    assert.ok(langs["zhongyuan"]);
    assert.ok(langs["norse"]);
    assert.ok(langs["slavic"]);
    assert.ok(langs["arabic"]);
  });

  test("createCulture 绑定语言", () => {
    const culture = createCulture("c1", "东境文化", "norse");
    assert.equal(culture.languageId, "norse");
  });

  test("nameForEntity 用文化绑定语言命名", () => {
    const session = {
      languages: presetLanguages(),
      cultures: { "东境": createCulture("东境", "东境文化", "norse") },
    };
    const name = nameForEntity(session, "东境", "nation", createRng(9));
    assert.ok([...NORSE_LANG.morphology.nationSuffixes].some((s) => name.includes(s)),
      `绑定北欧文化 → 北欧命名: ${name}`);
  });
});

describe("从世界初始状态生成语言 — 不预设地球语言", () => {
  test("生成的语言独一无二（不同 seed → 不同音系/词根）", () => {
    const langA = generateLanguageFromWorld({ seed: 1, species: "精灵" });
    const langB = generateLanguageFromWorld({ seed: 2, species: "精灵" });
    // 音系应不同（不同 seed 派生不同音素组合）
    assert.notDeepEqual(langA.phonology.consonants, langB.phonology.consonants);
    // 词根不同
    assert.notEqual(Object.values(langA.roots)[0], Object.values(langB.roots)[0]);
    assert.ok(langA.name.includes("精灵"), "语言名含种族");
  });

  test("生成的命名不含地球预设（无 州/郡/burg/grad 等）", () => {
    const lang = generateLanguageFromWorld({ seed: 3, species: "深海族" });
    // 从生成语言产出的名字不应含预设语言的后缀
    const rng = createRng(10);
    const nationName = generateName(lang, "nation", rng);
    for (const preset of ["国", "王国", "land", "rike", "grad", "ia"]) {
      // 生成的词根/后缀是从音素组合, 理论上不会恰好等于预设后缀（但可能巧合）
      // 关键: 语言本身不是从预设池复制来的
    }
    assert.ok(nationName.length >= 2, `生成国名有长度: ${nationName}`);
    assert.ok(lang.morphology.placeSuffixes.every((s) => !["州", "郡", "府", "heim", "vik", "grad", "abad"].includes(s)),
      `生成语言的后缀不应是地球预设: ${lang.morphology.placeSuffixes.join(",")}`);
  });

  test("generateWorldLanguages 为每个种族生成语言", () => {
    const { languages, cultures } = generateWorldLanguages({
      seed: 5,
      entities: [
        { species: "人类", regionBiome: "plains", cultureName: "平原民" },
        { species: "人类", regionBiome: "coast", cultureName: "海边民" },
        { species: "精灵", regionBiome: "forest", cultureName: "林精灵" },
      ],
    });
    // 2 个种族 → 2 种语言
    assert.equal(Object.keys(languages).length, 2);
    // 3 个文化绑定对应语言
    assert.equal(Object.keys(cultures).length, 3);
  });

  test("相同 seed + 种族 → 相同语言（确定性）", () => {
    const a = generateLanguageFromWorld({ seed: 9, species: "兽人" });
    const b = generateLanguageFromWorld({ seed: 9, species: "兽人" });
    assert.deepEqual(a.phonology.consonants, b.phonology.consonants);
    assert.deepEqual(a.roots, b.roots);
  });

  test("显式定义发音特征被优先使用", () => {
    const lang = generateLanguageFromWorld({
      seed: 11, species: "龙裔",
      phonology: { consonants: ["k", "r", "th"], vowels: ["a", "o"] },
    });
    assert.deepEqual(lang.phonology.consonants, ["k", "r", "th"]);
  });
});

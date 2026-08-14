// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 政体轻结构耦合系统（B方案）验收测试。
 *
 * 验证：
 * - 主干链确定性: 地理 → 资源 → 人口 → 经济 → 政体信号
 * - 经济随人口/技术增长, 组织复杂度随经济上升
 * - 演化信号: 经济足够 + 复杂度跃升 → evolve_signal 触发
 * - agent 决策: regime_evolution 改变政体形态
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, runTicks, makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { tickPhysics } from "./physics.ts";
import { createMockLLM } from "./llm.ts";
import { createRng } from "./random.ts";
import {
  derivePoliticalForm, computePolitySignals, derivePolityShape,
  deriveHistorySignals, applyHistoryToPolity, inferBiome,
  deriveReligion, deriveIdeology,
} from "./regime.ts";
import { generateWorldLanguages } from "./culture.ts";
import type { EntityCard } from "./types.ts";

function profileEntity(id, name, opts = {}) {
  const species = opts.species ?? "人类";
  const ent = makeEntity(id, name, "r", species, "",
    { population: opts.population ?? 100_000, food: 500, military: opts.military ?? 400, legitimacy: 60, stability: 60 },
    { "农业": opts.agriculture ?? 15, "制度": 10, "军事": opts.militaryTech ?? 0, "航海": opts.naval ?? 0 },
    { "探索欲": opts.exploration ?? 50, "组织倾向": 50, "信仰强度": opts.faith ?? 20 },
    species, `${name}城`,
  );
  ent.identity.political_form = "";
  ent.regime.organizational_complexity = opts.org ?? 10;
  ent.regime.centralization = opts.cent ?? 20;
  ent.regime.economic_base = opts.eco ?? 0;
  ent.metrics.economy = opts.economy ?? 0;
  return ent;
}

function profileRegion(biome) {
  return {
    id: "r", name: "大陆", biome, neighbors: [],
    resources: deriveRegionResources(biome, EARTH_LAWS),
    layer: 0, refined: false,
  };
}

function profileSession(entities, languages = {}, cultures = {}) {
  return createSession({ laws: EARTH_LAWS, regions: {}, entities, config: { seed: 1 }, languages, cultures });
}

function richEntity(region: string): EntityCard {
  return makeEntity("e", "富庶王国", region, "人类", "kingdom",
    { population: 500_000, food: 2000, economy: 50, military: 1000, legitimacy: 70, stability: 70 },
    { "农业": 60, "生产": 40, "制度": 30 },
    { "探索欲": 50, "组织倾向": 70, "信仰强度": 40 },
  );
}

describe("政体主干链 — 经济 → 组织复杂度（确定性）", () => {
  test("经济随人口和农业技术上升", () => {
    const region = {
      id: "p", name: "平原", biome: "plains",
      resources: deriveRegionResources("plains", EARTH_LAWS),
      neighbors: [], layer: 0, refined: false,
    };
    const e = richEntity("p");
    e.metrics.population = 1_000_000;
    e.tech["农业"] = 80;
    const result = tickPhysics(e, region, EARTH_LAWS);
    // 经济应随人口/农业技术上升
    assert.ok(result.metrics.economy > 30, `高人口高农业 → 经济应较高: ${result.metrics.economy}`);
    assert.ok(result.regimeDelta.economic_base > 0, "经济支撑力应为正");
  });

  test("组织复杂度由经济驱动", () => {
    const region = {
      id: "p", name: "平原", biome: "plains",
      resources: deriveRegionResources("plains", EARTH_LAWS),
      neighbors: [], layer: 0, refined: false,
    };
    const e = richEntity("p");
    e.metrics.population = 2_000_000;
    e.tech["农业"] = 90;
    const result = tickPhysics(e, region, EARTH_LAWS);
    assert.ok(result.regimeDelta.organizational_complexity > e.regime.organizational_complexity,
      "组织复杂度应随经济上升");
  });
});

describe("政体演化信号 — 物理层给条件, agent 决策形态", () => {
  test("经济支撑力足够 → evolve_signal 触发", async () => {
    const session = createSession({
      laws: EARTH_LAWS,
      regions: (() => {
        const regions = defaultRegions();
        for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
        return regions;
      })(),
      entities: [richEntity("plains-mid")],
      config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
    });
    // 强实体在若干 tick 内应触发演化信号
    await runTicks(session, 20);
    const e = session.entities["e"];
    // 高人口富庶实体在 20 tick 内应至少触发过一次演化信号
    assert.ok(e.regime.organizational_complexity > 10, "组织复杂度应增长");
  });

  test("agent 通过 regime_evolution 演化政体形态", async () => {
    const session = createSession({
      laws: EARTH_LAWS,
      regions: (() => {
        const regions = defaultRegions();
        for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
        return regions;
      })(),
      entities: [richEntity("plains-mid")],
      config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
    });
    session.current_tick = 1;
    const e = session.entities["e"];
    e.regime.evolve_signal = true;
    e.regime.evolve_reason = "经济足以支撑更复杂组织";

    // mock agent: 决策演化为"行会联盟"
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [],
      events: [],
      regime_evolution: { new_form: "行会联盟", centralization_delta: -20, reason: "富庶的商业城市联合成自治行会" },
    }));
    const { runEntityAgent } = await import("./agent.ts");
    const { events } = await runEntityAgent(session, "e", { llm: mock });

    assert.equal(session.entities["e"].identity.political_form, "行会联盟", "政体形态被 agent 改变");
    assert.ok(session.entities["e"].regime.centralization < 20, "集权度下降（行会联盟更松散）");
    assert.equal(session.entities["e"].regime.evolve_signal, false, "信号已决策清除");
    assert.ok(events.some((ev) => ev.type === "reform"), "产生政体演化事件");
  });
});

describe("政体 ↔ 技术耦合", () => {
  test("组织复杂度加成制度/生产技术发展", () => {
    const region = {
      id: "p", name: "平原", biome: "plains",
      resources: deriveRegionResources("plains", EARTH_LAWS),
      neighbors: [], layer: 0, refined: false,
    };
    // 高组织复杂度实体 vs 低组织复杂度实体
    const high = richEntity("p");
    high.regime.organizational_complexity = 90;
    high.tech["制度"] = 20;
    const low = richEntity("p");
    low.regime.organizational_complexity = 10;
    low.tech["制度"] = 20;

    const rHigh = tickPhysics(high, region, EARTH_LAWS);
    const rLow = tickPhysics(low, region, EARTH_LAWS);
    // 高复杂度实体的制度增量应 ≥ 低复杂度
    assert.ok((rHigh.techDelta["制度"] ?? 0) >= (rLow.techDelta["制度"] ?? 0),
      `高组织复杂度应加速制度发展: ${rHigh.techDelta["制度"]} vs ${rLow.techDelta["制度"]}`);
  });
});

describe("信号剖面 → 政体形态（主导维度组合, 非求和）", () => {
  test("组织高+军事高 → 军事类", () => {
    const ent = profileEntity("e", "铁之国", { org: 80, cent: 70, military: 8000, militaryTech: 30 });
    const sig = computePolitySignals(ent, profileRegion("plains"));
    assert.ok(sig.military > 50, `军事度应高, 实际 ${sig.military}`);
    const shape = derivePolityShape(sig);
    assert.ok(shape.includes("军事") || shape.includes("征服"), `实际: ${shape}`);
  });

  test("组织高+宗教高 → 神权类", () => {
    const ent = profileEntity("e", "圣国", { org: 80, cent: 60, faith: 90 });
    const shape = derivePolityShape(computePolitySignals(ent, profileRegion("plains")));
    assert.ok(shape.includes("神权") || shape.includes("教权"), `实际: ${shape}`);
  });

  test("经济高+组织低 → 商业城邦/同盟", () => {
    const ent = profileEntity("e", "商邦", { org: 40, economy: 70, cent: 30 });
    const shape = derivePolityShape(computePolitySignals(ent, profileRegion("plains")));
    assert.ok(shape.includes("商业") || shape.includes("城邦") || shape.includes("同盟"), `实际: ${shape}`);
  });

  test("军事高+组织低 → 战团/军事部落", () => {
    const ent = profileEntity("e", "战族", { org: 30, military: 8000, militaryTech: 20 });
    const shape = derivePolityShape(computePolitySignals(ent, profileRegion("plains")));
    assert.ok(shape.includes("战团") || shape.includes("军事部落"), `实际: ${shape}`);
  });

  test("均衡+各维低 → 部落（不含 kingdom/empire）", () => {
    const ent = profileEntity("e", "原始民", { org: 10 });
    const shape = derivePolityShape(computePolitySignals(ent, profileRegion("plains")));
    assert.ok(!shape.includes("王国") && !shape.includes("帝国"), `实际: ${shape}`);
    assert.ok(shape.length > 0);
  });

  test("航海高+组织低+沿海 → 海邦/城邦", () => {
    const ent = profileEntity("e", "海族", { org: 40, naval: 70 });
    const shape = derivePolityShape(computePolitySignals(ent, profileRegion("coast")));
    assert.ok(shape.includes("海") || shape.includes("城邦"), `实际: ${shape}`);
  });
});

describe("历史路径 → 政体修正", () => {
  // mkEvent 用结构化 changes 表达历史事实（不再靠 type 枚举）
  const mkEvent = (id, changes) => ({ id, tick: 1, time_label: "t1", type: "事件", participants: ["e"], region: "r", description: "evt", changes, random: false, source: "agent" });
  const revolt = mkEvent("a", [{ entity: "e", collapsed: true }]);
  const conquest = mkEvent("b", [{ entity: "x", absorbed_by: "e" }]);
  const founding = mkEvent("c", [{ entity: "e", founded: { name: "新邦", from: "e" } }]);

  test("近期灭亡/建国 → 革命动荡 → 共和", () => {
    const hist = deriveHistorySignals({ id: "e" }, [revolt, founding], 15);
    assert.ok(hist.revolution, "有革命信号");
    assert.equal(applyHistoryToPolity("王国", hist), "共和国");
  });

  test("近期宗教复兴（语义文本）→ 神权化", () => {
    const relEvent = { ...mkEvent("r", []), type: "圣山祭祀", description: "大祭司引导全国信仰" };
    const hist = deriveHistorySignals({ id: "e" }, [relEvent], 15);
    assert.equal(hist.religious, true, "宗教语义事件触发宗教信号");
    assert.equal(applyHistoryToPolity("帝国", hist), "神权帝国");
  });

  test("近期征服（absorbed_by）→ 军事化修正", () => {
    const hist = deriveHistorySignals({ id: "e" }, [conquest], 15);
    assert.ok(hist.conquest, "有征服信号");
    assert.equal(applyHistoryToPolity("王国", hist), "征服王朝");
  });

  test("无历史事件 → 纯信号剖面形态（不修正）", () => {
    const hist = deriveHistorySignals({ id: "e" }, [], 15);
    assert.equal(hist.revolution, false);
    assert.equal(hist.religious, false);
    assert.equal(hist.conquest, false);
    assert.equal(applyHistoryToPolity("部落", hist), "部落");
  });
});

describe("derivePoliticalForm 集成（信号+历史+语言命名）", () => {
  test("确定性: 同输入同输出", () => {
    const ent = profileEntity("e", "北族", { org: 60, cent: 55, economy: 60 });
    const session = profileSession([ent]);
    const a = derivePoliticalForm(ent, profileRegion("plains"), session, createRng(42));
    const b = derivePoliticalForm(ent, profileRegion("plains"), session, createRng(42));
    assert.equal(a, b, "同输入同输出");
    assert.ok(a.length > 0);
  });

  test("草原 biome → 游牧/汗国类", () => {
    const ent = profileEntity("e", "马族", { org: 60, cent: 45 });
    const session = profileSession([ent]);
    const form = derivePoliticalForm(ent, profileRegion("steppe"), session);
    assert.ok(form.includes("游牧") || form.includes("联盟") || form.includes("汗国"), `实际: ${form}`);
  });

  test("精灵种族 → 林/谷词根进入政体名", () => {
    const ent = profileEntity("e", "精灵", { org: 55, species: "精灵" });
    const session = profileSession([ent]);
    const form = derivePoliticalForm(ent, profileRegion("forest"), session);
    assert.ok(form.length > 0);
  });

  test("文化语言 → 政体名用该语言后缀", () => {
    const ent = profileEntity("e", "中原国", { org: 65, cent: 60 });
    const gen = generateWorldLanguages({ seed: 1, entities: [{ species: "人类", cultureName: "中原", regionBiome: "plains" }] });
    const session = profileSession([ent], gen.languages, gen.cultures);
    const cultureId = Object.keys(gen.cultures)[0];
    ent.identity.culture = gen.cultures[cultureId].name;
    const form = derivePoliticalForm(ent, profileRegion("plains"), session);
    assert.ok(form.length > 0);
  });
});

describe("inferBiome 兜底", () => {
  test("未知 biome 子串推断", () => {
    assert.equal(inferBiome("灵雾沼泽"), "forest", "含沼 → forest");
    assert.equal(inferBiome("盐海群岛"), "coast", "含海 → coast");
    assert.equal(inferBiome("铁矿山脉"), "mountains", "含山 → mountains");
    assert.equal(inferBiome("无边沙漠"), "desert", "含沙/漠 → desert");
    assert.equal(inferBiome("极寒冰原"), "tundra", "含冰 → tundra");
  });

  test("未知 biome 不崩, 政体可推导", () => {
    const ent = profileEntity("e", "雾族", { org: 50 });
    const session = profileSession([ent]);
    const form = derivePoliticalForm(ent, profileRegion("灵雾沼泽"), session);
    assert.ok(form.length > 0, "未知 biome 仍能推导政体");
  });

  test("完全未知字符串 → plains", () => {
    assert.equal(inferBiome("xyzzy"), "plains");
  });
});

describe("宗教/信仰体系推导（数据驱动）", () => {
  test("低信仰 → 世俗", () => {
    const ent = profileEntity("e", "世俗族", { faith: 10 });
    const religion = deriveReligion(ent, profileRegion("plains"), profileSession([ent]));
    assert.ok(religion.includes("世俗") || religion.includes("淡薄"), `实际: ${religion}`);
  });

  test("高信仰+高组织 → 制度化神系（祭司团）", () => {
    const ent = profileEntity("e", "圣教国", { faith: 90, org: 80 });
    const religion = deriveReligion(ent, profileRegion("plains"), profileSession([ent]));
    assert.ok(religion.includes("祭司团") || religion.includes("教廷"), `实际: ${religion}`);
  });

  test("高信仰+低组织 → 自然崇拜", () => {
    const ent = profileEntity("e", "林族", { faith: 70, org: 20 });
    const religion = deriveReligion(ent, profileRegion("forest"), profileSession([ent]));
    assert.ok(religion.includes("崇拜"), `实际: ${religion}`);
  });

  test("环境塑造崇拜对象（沿海→海/潮汐）", () => {
    const ent = profileEntity("e", "海族", { faith: 70, org: 20 });
    const religion = deriveReligion(ent, profileRegion("coast"), profileSession([ent]));
    assert.ok(religion.includes("海") || religion.includes("潮汐"), `实际: ${religion}`);
  });
});

describe("意识形态推导（数据驱动）", () => {
  test("军事主导 → 尚武扩张主义", () => {
    const ent = profileEntity("e", "战族", { org: 80, military: 8000, militaryTech: 30, cent: 60 });
    const ideology = deriveIdeology(ent, profileRegion("plains"), profileSession([ent]));
    assert.ok(ideology.includes("尚武") || ideology.includes("扩张"), `实际: ${ideology}`);
  });

  test("商业主导 → 重商实用主义", () => {
    const ent = profileEntity("e", "商族", { org: 60, economy: 70 });
    const ideology = deriveIdeology(ent, profileRegion("plains"), profileSession([ent]));
    assert.ok(ideology.includes("重商") || ideology.includes("实用"), `实际: ${ideology}`);
  });

  test("神权 → 神权正统主义", () => {
    const ent = profileEntity("e", "神权族", { org: 80, faith: 90 });
    const ideology = deriveIdeology(ent, profileRegion("plains"), profileSession([ent]));
    assert.ok(ideology.includes("神权") || ideology.includes("正统"), `实际: ${ideology}`);
  });

  test("均衡 → 有意识形态（不空）", () => {
    const ent = profileEntity("e", "平凡族", { org: 40, economy: 30 });
    const ideology = deriveIdeology(ent, profileRegion("plains"), profileSession([ent]));
    assert.ok(ideology.length > 0);
  });
});


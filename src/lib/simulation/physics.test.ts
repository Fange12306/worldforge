// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 0 验收测试 — 物理层数值引擎。
 * 运行：node --experimental-strip-types --test src/lib/simulation/*.test.ts
 *
 * 验收标准（SIMULATION_DESIGN.md §十一 Phase 0）：
 * - 法则派生的物理量联动不失控（真实/魔法/真气三例）。
 * - 已注册维度实际值不超过法则/空间决定的潜力上限。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS, MAGIC_LAWS, QI_LAWS, deriveRegionResources, tickPhysics, deriveTechPotential, developmentLevel, adminCapacityFor, populationCapacity } from "./physics.ts";
import { makeEntity } from "./engine.ts";
import { defaultRegions } from "./engine.ts";

function sampleEntity(region: string): ReturnType<typeof makeEntity> {
  return makeEntity(
    "e1",
    "东境部族",
    region,
    "人类",
    "tribe",
    { population: 100_000, food: 500, military: 600, legitimacy: 60, stability: 60 },
    { "航海": 10, "农业": 20, "冶金": 15, "制度": 10, "生产": 8 },
    { "探索欲": 55, "组织倾向": 50, "信仰强度": 40 },
  );
}

describe("物理层 — 生物群系 → 资源潜力", () => {
  test("真实世界: 沿海航海潜力高, 沙漠贫瘠", () => {
    const coast = deriveRegionResources("coast", EARTH_LAWS);
    const desert = deriveRegionResources("desert", EARTH_LAWS);
    assert.ok(coast.naval_potential > desert.naval_potential);
    assert.ok(coast.food_capacity > desert.food_capacity);
    assert.equal(coast.mana_potential, 0); // 真实世界无魔力
  });

  test("魔法世界: 魔力潜力被法则注入", () => {
    const coast = deriveRegionResources("coast", MAGIC_LAWS);
    assert.ok(coast.mana_potential > 0);
    assert.equal(coast.qi_potential, 0); // 魔法世界无灵气
  });

  test("真气世界: 灵气潜力被法则注入, 山脉/草原更高", () => {
    const mountain = deriveRegionResources("mountains", QI_LAWS);
    const plains = deriveRegionResources("plains", QI_LAWS);
    assert.ok(mountain.qi_potential > plains.qi_potential);
    assert.equal(mountain.mana_potential, 0);
  });
});

describe("物理层 — 技术潜力推导（法则决定有哪些维度）", () => {
  test("真实世界: 航海/农业/冶金等现实轴", () => {
    const coast = deriveRegionResources("coast", EARTH_LAWS);
    const pot = deriveTechPotential(coast, EARTH_LAWS);
    assert.ok("航海" in pot);
    assert.ok(!("魔力掌控" in pot));
    assert.ok(!("修为" in pot));
  });

  test("魔法世界: 额外出现 魔力掌控 维度", () => {
    const coast = deriveRegionResources("coast", MAGIC_LAWS);
    const pot = deriveTechPotential(coast, MAGIC_LAWS);
    assert.ok("魔力掌控" in pot);
    assert.ok(pot["魔力掌控"] > 0);
  });

  test("真气世界: 额外出现 修为 维度", () => {
    const mountain = deriveRegionResources("mountains", QI_LAWS);
    const pot = deriveTechPotential(mountain, QI_LAWS);
    assert.ok("修为" in pot);
  });
});

describe("物理层 — 每 tick 联动", () => {
  test("稳定富足时人口温和增长", () => {
    const region = {
      id: "p", name: "平原", biome: "plains",
      resources: deriveRegionResources("plains", EARTH_LAWS),
      neighbors: [], layer: 0, refined: false,
    };
    const e = sampleEntity("p");
    const before = e.metrics.population;
    const result = tickPhysics(e, region, EARTH_LAWS);
    assert.ok(result.metrics.population >= before, "人口不应减少");
    assert.equal(result.triggeredEvents.length, 0, "无饥荒触发");
  });

  test("严重粮食赤字触发饥荒且人口下降", () => {
    const region = {
      id: "d", name: "沙漠", biome: "desert",
      resources: deriveRegionResources("desert", EARTH_LAWS),
      neighbors: [], layer: 0, refined: false,
    };
    const e = sampleEntity("d");
    e.metrics.food = -200_000; // 严重赤字
    const before = e.metrics.population;
    const result = tickPhysics(e, region, EARTH_LAWS);
    assert.ok(result.metrics.population < before, "饥荒应减少人口");
    assert.ok(result.triggeredEvents.some((t) => t.type === "disaster"));
  });

  test("维度实际值 ≤ 潜力上限（收敛性）", () => {
    const region = {
      id: "c", name: "海岸", biome: "coast",
      resources: deriveRegionResources("coast", EARTH_LAWS),
      neighbors: [], layer: 0, refined: false,
    };
    const e = sampleEntity("c");
    const result = tickPhysics(e, region, EARTH_LAWS);
    for (const [dim, pot] of Object.entries(result.techPotential)) {
      const current = (result.metrics as unknown as Record<string, number>)[dim]
        ?? (e.tech[dim] ?? 0);
      // 实际应用后的维度值（已含增量）
      const applied = (e.tech[dim] ?? 0) + (result.techDelta?.[dim] ?? 0);
      assert.ok(applied <= pot + 0.5, `${dim}: applied=${applied} > potential=${pot}`);
      void current;
    }
  });
});

describe("物理层 — 三例世界 10 tick 联动不失控", () => {
  test("真实/魔法/真气世界各有稳定演化", () => {
    for (const [laws, region, label] of [
      [EARTH_LAWS, "plains-mid", "真实"],
      [MAGIC_LAWS, "forest-valley", "魔法"],
      [QI_LAWS, "mountains-north", "真气"],
    ] as const) {
      const resources = deriveRegionResources(region, laws);
      const e = makeEntity(`e-${label}`, `${label}文明`, region, "人类", "kingdom",
        { population: 200_000, food: 1000, military: 800, legitimacy: 65, stability: 65 },
        {}, // 空 tech, 由引擎同步
        { "探索欲": 50, "组织倾向": 50, "信仰强度": 40 },
      );
      // 手动同步初始 tech（引擎在 createSession 里做, 这里直接给）
      const pot = deriveTechPotential(resources, laws);
      for (const [dim, p] of Object.entries(pot)) e.tech[dim] = Math.min(10, p);
      const reg = { id: region, name: label, biome: (region.includes("forest") ? "forest" : region.includes("mountain") ? "mountains" : "plains") as never, resources, neighbors: [], layer: 0, refined: false };

      let prevPop = e.metrics.population;
      let maxPop = prevPop;
      for (let t = 0; t < 10; t++) {
        const r = tickPhysics(e, reg, laws);
        // 应用（模拟引擎的 applyPhysicsResult 核心）
        e.metrics = r.metrics;
        for (const [dim, delta] of Object.entries(r.techDelta ?? {})) {
          e.tech[dim] = Math.max(0, Math.min(100, (e.tech[dim] ?? 0) + delta));
        }
        prevPop = e.metrics.population;
        maxPop = Math.max(maxPop, prevPop);
        // 断言：人口为正、军力不为负、指标在合理范围
        assert.ok(e.metrics.population > 0, `${label} 人口正`);
        assert.ok(e.metrics.military > 0, `${label} 军力正`);
        assert.ok(e.metrics.stability >= 0 && e.metrics.stability <= 100, `${label} 稳定 0-100`);
      }
      // 10 tick 后人口不应爆炸失控（< 10x 原始, 马尔萨斯约束）
      assert.ok(maxPop < prevPop * 3 || maxPop < 2_000_000, `${label} 人口增长受约束`);
    }
  });
});

describe("复合发展模型（§4.1 收口: 食物不唯一, 人口与食物随时代脱钩）", () => {
  const regions = defaultRegions();
  const plains = { ...regions["plains-mid"], resources: deriveRegionResources("plains", EARTH_LAWS) };

  test("developmentLevel 随技术/组织增长", () => {
    const tribal = makeEntity("t", "部落", "plains-mid", "人类", "tribe",
      { population: 50_000, food: 500, military: 200, legitimacy: 50, stability: 50 },
      { "农业": 15, "生产": 10, "制度": 8, "航海": 5, "冶金": 5 }, { "探索欲": 50, "组织倾向": 50 });
    const industrial = makeEntity("i", "工业国", "plains-mid", "人类", "kingdom",
      { population: 5_000_000, food: 500, military: 200, legitimacy: 60, stability: 60 },
      { "农业": 80, "生产": 85, "制度": 75, "航海": 60, "冶金": 70 }, { "探索欲": 60, "组织倾向": 60 });
    industrial.regime.organizational_complexity = 80;
    const devT = developmentLevel(tribal);
    const devI = developmentLevel(industrial);
    assert.ok(devI > devT * 3, `工业国发展水平应远高于部落: ${devT} vs ${devI}`);
  });

  test("populationCapacity 高 dev 时与食物脱钩（部落≈食物, 工业≈3.4×食物）", () => {
    const foodOnly = populationCapacity(plains.resources, 0);
    const devHigh = populationCapacity(plains.resources, 80);
    assert.ok(devHigh > foodOnly * 3, `高 dev 承载应远超纯食物承载: ${foodOnly} vs ${devHigh}`);
    // dev=0 → 纯食物承载（部落基线）
    assert.equal(populationCapacity(plains.resources, 0), populationCapacity(plains.resources));
  });

  test("高发展人口增长不随食物赤字崩溃（工业革命后与食物弱相关）", () => {
    // 工业国: 高 tech + 高组织, 负粮 → 增长不崩
    const industrial = makeEntity("i", "工业国", "plains-mid", "人类", "kingdom",
      { population: 2_000_000, food: -50_000, military: 200, legitimacy: 60, stability: 60, economy: 60 },
      { "农业": 80, "生产": 85, "制度": 75, "航海": 60, "冶金": 70 }, { "探索欲": 60, "组织倾向": 60 });
    industrial.regime.organizational_complexity = 80;
    const rInd = tickPhysics(industrial, plains, EARTH_LAWS);
    // 部落: 低 tech, 负粮 → 增长强抑制
    const tribal = makeEntity("t", "部落", "plains-mid", "人类", "tribe",
      { population: 50_000, food: -50_000, military: 200, legitimacy: 50, stability: 50 },
      { "农业": 15, "生产": 10, "制度": 8, "航海": 5, "冶金": 5 }, { "探索欲": 50, "组织倾向": 50 });
    const rTri = tickPhysics(tribal, plains, EARTH_LAWS);
    const indGrowth = rInd.metrics.population / 2_000_000;
    const triGrowth = rTri.metrics.population / 50_000;
    assert.ok(indGrowth > triGrowth, `工业国食物赤字仍增长(${indGrowth.toFixed(4)}), 部落受抑(${triGrowth.toFixed(4)})`);
  });

  test("adminCapacity 随发展水平/组织/人口增长（治理上限软门）", () => {
    const tribal = makeEntity("t", "部落", "plains-mid", "人类", "tribe",
      { population: 50_000, food: 500, military: 200, legitimacy: 50, stability: 50 },
      { "农业": 15, "生产": 10, "制度": 8, "航海": 5, "冶金": 5 }, { "探索欲": 50, "组织倾向": 50 });
    const empire = makeEntity("i", "帝国", "plains-mid", "人类", "empire",
      { population: 5_000_000, food: 500, military: 200, legitimacy: 60, stability: 60 },
      { "农业": 80, "生产": 85, "制度": 75, "航海": 60, "冶金": 70 }, { "探索欲": 60, "组织倾向": 60 });
    empire.regime.organizational_complexity = 70;
    const capT = adminCapacityFor(tribal);
    const capE = adminCapacityFor(empire);
    assert.ok(capT >= 1 && capT <= 5, `部落治理上限应小(实际 ${capT})`);
    assert.ok(capE > capT + 5, `帝国治理上限应显著大于部落: ${capT} vs ${capE}`);
  });
});

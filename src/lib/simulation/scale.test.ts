// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 尺度合理性测试（§4.1）。
 *
 * 验证:
 * - 人口密度换算(面积 → km² → 人/km²)
 * - 时代合理密度上限随技术升
 * - 行军时间随距离/技术变
 * - 密度超限 → 稳定度压力
 * - 初始人口随区域承载变(沙漠 < 平原)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity } from "./engine.ts";
import { deriveRegionResources, populationCapacity } from "./physics.ts";
import { initialStateToSession } from "./init-customizer.ts";
import { createRng } from "./random.ts";
import {
  eraDensityCap, populationDensity, densityPressure,
  marchTimeTicks, eraSpeedKmPerTick, marchTicksTo, regionAreaKm2,
} from "./scale.ts";

const world = EARTH_LAWS;

function makeRegion(biome, area) {
  return {
    id: "r", name: "区域", biome, neighbors: [],
    resources: deriveRegionResources(biome, world),
    dimensions: { width: 100, height: area / 100, area },
    layer: 0, refined: false,
  };
}

describe("人口密度换算", () => {
  test("面积(世界单位) → km² → 人/km²", () => {
    // area 世界单位 = 平方公里(to_si=1e6)
    const region = makeRegion("plains", 100_000); // 10 万 km²
    const ent = makeEntity("e", "国", "r", "人类", "", { population: 1_000_000 }, {}, {}, "人类");
    assert.equal(regionAreaKm2(region, world), 100_000, "面积换算 km²");
    assert.equal(populationDensity(ent, region, world), 10, "100万人/10万km² = 10人/km²");
  });

  test("无面积 → 用食物承载估算", () => {
    const region = { id: "r", name: "x", biome: "plains", neighbors: [], resources: deriveRegionResources("plains", world), layer: 0, refined: false };
    assert.ok(regionAreaKm2(region, world) > 0, "无面积也能估算");
  });
});

describe("时代合理密度上限", () => {
  test("农业技术越高密度上限越高", () => {
    const low = eraDensityCap(0, 0);
    const high = eraDensityCap(80, 60);
    assert.ok(high > low, `高农业应更高密度: ${high} > ${low}`);
  });

  test("上限不超过 500(精耕农业帝国)", () => {
    assert.ok(eraDensityCap(100, 100) <= 500);
  });
});

describe("行军时间", () => {
  test("距离/速度 → tick 数", () => {
    const speed = eraSpeedKmPerTick(world, 0, 10); // 部落 15km/天 × 3650 = 54750 km/tick
    assert.ok(marchTimeTicks(500, speed) < 1, "500km 在十年制下不足 1 tick");
  });

  test("军事技术加速", () => {
    const slow = eraSpeedKmPerTick(world, 0, 1);
    const fast = eraSpeedKmPerTick(world, 40, 1);
    assert.ok(fast > slow, "军事技术应加速");
  });

  test("marchTicksTo 返回有限值", () => {
    const region = makeRegion("plains", 100_000);
    region.distances = { nbr: 1000 }; // 1000km
    const ticks = marchTicksTo(region, "nbr", world, 0, 10);
    assert.ok(ticks > 0 && ticks !== Infinity, `行军 tick 有限: ${ticks}`);
  });
});

describe("密度压力", () => {
  test("不超上限 → 0 压力", () => {
    assert.equal(densityPressure(10, 100), 0);
  });
  test("超上限 → 线性压力(≤1)", () => {
    assert.ok(densityPressure(200, 100) > 0, "超载有压力");
    assert.ok(densityPressure(200, 100) <= 1, "压力封顶 1");
  });
  test("2 倍上限 → 压力 1", () => {
    assert.equal(densityPressure(200, 100), 1);
  });
});

describe("初始人口按区域承载", () => {
  test("沙漠承载低 → 初始人口低, 平原承载高 → 初始人口高", () => {
    const desertCap = populationCapacity(deriveRegionResources("desert", world));
    const plainsCap = populationCapacity(deriveRegionResources("plains", world));
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "desert", name: "沙漠", biome: "desert" },
        { id: "plains", name: "平原", biome: "plains" },
      ],
      entities: [
        { name: "沙漠族", species: "人类", regionId: "desert", population: 5000 },
        { name: "平原族", species: "人类", regionId: "plains", population: 50000 },
      ],
    };
    const result = initialStateToSession(completed, createRng(1), world);
    const desertEnt = result.entities.find((e) => e.name === "沙漠族");
    const plainsEnt = result.entities.find((e) => e.name === "平原族");
    assert.ok(desertEnt.metrics.population < plainsEnt.metrics.population,
      `沙漠初始人口应低于平原: ${desertEnt.metrics.population} < ${plainsEnt.metrics.population}`);
    assert.ok(desertEnt.metrics.population <= desertCap * 0.6, "沙漠不超承载过多");
  });
});

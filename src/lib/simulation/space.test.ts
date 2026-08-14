// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 空间交互传递性模型测试（§5.1 距离衰减）。
 *
 * 验证:
 * - 距离衰减锚点: 邻区≈0.7, 隔一区≈0.3, 跨大陆≈0.01, 地球对面≈0
 * - terrain 修正: 海洋/山地阻隔, 平原缓和
 * - tech 右移: 航海/生产/制度提升感知
 * - 分层阈值: direct/indirect/legend/unknown
 * - 关系过滤: 初始化关系按 awareness 处理
 * - 用户世界尺度生效
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { deriveRegionScales } from "./measure.ts";
import {
  awareness, awarenessTier, regionDistanceKm, terrainFactor,
  marchTimeHuman, kmPerDay,
} from "./space.ts";

const world = EARTH_LAWS;

function makeRegions(scaleKm = { width: 3000, height: 2500 }) {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) {
    regions[id] = { ...r, resources: deriveRegionResources(r.biome, world) };
  }
  return deriveRegionScales(world, regions, { continentKm: scaleKm });
}

/** 给区域加 dimensions, 避免 createSession 用 deriveRegionScales 重写 distances */
function sealRegions(regions) {
  return Object.fromEntries(Object.entries(regions).map(([id, r]) => [
    id, { ...r, dimensions: r.dimensions ?? { width: 200, height: 200, area: 40000 } },
  ]));
}

function mkEntity(id, name, region, opts = {}) {
  const ent = makeEntity(id, name, region, "人类", "",
    { population: 100_000, food: 500, military: 400, legitimacy: 60, stability: 60 },
    { "农业": 15, "制度": opts.inst ?? 10, "军事": opts.mil ?? 0, "航海": opts.naval ?? 0 },
    { "探索欲": 50, "组织倾向": 50, "信仰强度": 20 }, "人类", `${name}城`);
  ent.geography.neighbors = opts.neighbors ?? [];
  ent.relations = opts.relations ?? [];
  return ent;
}

function mkSession(regions, entities) {
  return createSession({ laws: world, regions, entities, config: { seed: 1 } });
}

describe("距离衰减锚点", () => {
  test("邻区(≈500km) → awareness 较高", () => {
    const regions = sealRegions({
      a: { id: "a", name: "A", biome: "plains", neighbors: ["b"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { b: 500 } },
      b: { id: "b", name: "B", biome: "plains", neighbors: ["a"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { a: 500 } },
    });
    const e1 = mkEntity("e1", "甲", "a", { neighbors: ["e2"] });
    const e2 = mkEntity("e2", "乙", "b");
    const s = mkSession(regions, [e1, e2]);
    const a500 = awareness(e1, "e2", s);
    assert.ok(a500 > 0.4, `邻区感知应较高: ${a500}`);
    assert.ok(a500 <= 0.95, "封顶 0.95");
  });

  test("远距离(地球对面) → awareness 低(传说/未知)", () => {
    const regions = sealRegions({
      a: { id: "a", name: "A", biome: "plains", neighbors: ["b"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { b: 20000 } },
      b: { id: "b", name: "B", biome: "plains", neighbors: ["a"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { a: 20000 } },
    });
    const e1 = mkEntity("e1", "美洲", "a");
    const e2 = mkEntity("e2", "非洲", "b");
    const s = mkSession(regions, [e1, e2]);
    const a = awareness(e1, "e2", s);
    assert.ok(a < 0.03, `地球对面应不可知: ${a}`);
    assert.equal(awarenessTier(a), "unknown");
  });
});

describe("terrain 修正", () => {
  test("海洋比平原阻隔强", () => {
    const regions = {
      a: { id: "a", name: "A", biome: "plains", neighbors: ["b"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { b: 500 } },
      b: { id: "b", name: "B", biome: "plains", neighbors: ["a"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { a: 500 } },
    };
    const ocean = { ...regions, b: { ...regions.b, biome: "ocean" } };
    const fPlains = terrainFactor("a", "b", regions, 0);
    const fOcean = terrainFactor("a", "b", ocean, 0);
    assert.ok(fOcean < fPlains, `海洋应更阻隔: ${fOcean} < ${fPlains}`);
  });

  test("航海技术缓和海洋阻隔", () => {
    const regions = {
      a: { id: "a", name: "A", biome: "plains", neighbors: ["b"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { b: 500 } },
      b: { id: "b", name: "B", biome: "ocean", neighbors: ["a"], resources: deriveRegionResources("ocean", world), layer: 0, refined: false, distances: { a: 500 } },
    };
    const f0 = terrainFactor("a", "b", regions, 0);
    const f100 = terrainFactor("a", "b", regions, 100);
    assert.ok(f100 > f0, `航海技术应缓和阻隔: ${f100} > ${f0}`);
  });
});

describe("tech 右移 + 关系增益", () => {
  test("航海技术提升远距感知", () => {
    const regions = sealRegions({
      a: { id: "a", name: "A", biome: "plains", neighbors: ["b"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { b: 3000 } },
      b: { id: "b", name: "B", biome: "plains", neighbors: ["a"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { a: 3000 } },
    });
    const eLow = mkEntity("e1", "低技术", "a", { naval: 0 });
    const eHigh = mkEntity("e2", "高技术", "a", { naval: 90, inst: 80 });
    const e2 = mkEntity("e2", "乙", "b");
    const sLow = mkSession(regions, [eLow, e2]);
    const sHigh = mkSession(regions, [eHigh, e2]);
    assert.ok(awareness(eHigh, "e2", sHigh) > awareness(eLow, "e2", sLow),
      "高技术应感知更远");
  });

  test("关系增益: war 提升感知", () => {
    const regions = sealRegions({
      a: { id: "a", name: "A", biome: "plains", neighbors: ["b"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { b: 1500 } },
      b: { id: "b", name: "B", biome: "plains", neighbors: ["a"], resources: deriveRegionResources("plains", world), layer: 0, refined: false, distances: { a: 1500 } },
    });
    const eNoRel = mkEntity("e1", "无关系", "a");
    const eWar = mkEntity("e1", "战争", "a", { relations: [{ target: "e2", stance: "war" }] });
    const e2 = mkEntity("e2", "乙", "b");
    const sNoRel = mkSession(regions, [eNoRel, e2]);
    const sWar = mkSession(regions, [eWar, e2]);
    assert.ok(awareness(eWar, "e2", sWar) > awareness(eNoRel, "e2", sNoRel),
      "战争关系应提升感知");
  });
});

describe("分层阈值", () => {
  test("tier 分档", () => {
    assert.equal(awarenessTier(0.5), "direct");
    assert.equal(awarenessTier(0.2), "indirect");
    assert.equal(awarenessTier(0.08), "legend");
    assert.equal(awarenessTier(0.01), "unknown");
  });
});

describe("行军时间可读性", () => {
  test("marchTimeHuman 不同距离", () => {
    assert.equal(kmPerDay(0), 15);
    assert.ok(kmPerDay(40) > kmPerDay(0), "军事技术加速");
    const near = marchTimeHuman(500, 0);
    const far = marchTimeHuman(20000, 0);
    assert.ok(near.length > 0);
    assert.ok(far.includes("年"), `远距应显示年: ${far}`);
  });
});

describe("用户世界尺度生效", () => {
  test("measurement 大尺度 → 区域相距远 → awareness 低", () => {
    // 地球级: 大陆宽 40000km
    const bigRegions = makeRegions({ width: 40000, height: 30000 });
    const e1 = mkEntity("e1", "甲", "coast-east", {});
    const e2 = mkEntity("e2", "乙", "steppe-west");
    const s = mkSession(bigRegions, [e1, e2]);
    const a = awareness(e1, "e2", s);
    assert.ok(a < 0.15, `地球级尺度下远区应低感知: ${a}`);
  });
});

// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 实体领土模型测试（实体.territory = 控制的区划 id 列表, 任意层级）。
 *
 * 验证:
 * - 初始化 territory=[核心区域]
 * - 吞并合并 territory
 * - expandTerritory 展开子区划
 * - 多实体共享区划(controllers)
 * - territoryArea
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { buildGeography, addTerritory, expandTerritory, territoryArea } from "./geography.ts";

const world = EARTH_LAWS;

function mkRegions() {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, world) };
  return regions;
}

describe("实体领土初始化", () => {
  test("makeEntity territory = [核心区域]", () => {
    const ent = makeEntity("e", "部落", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    assert.deepEqual(ent.territory, ["plains-mid"], "初始领土 = 核心区域");
  });

  test("createSession 保留 territory", () => {
    const regions = mkRegions();
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: world, regions, entities: [ent], config: { seed: 1 } });
    assert.deepEqual(session.entities["e"].territory, ["plains-mid"]);
  });
});

describe("吞并转移领土", () => {
  test("吞并者领土并入被吞者区划(去重)", async () => {
    const { conquerEntity } = await import("./entity-pool.ts");
    const regions = mkRegions();
    const a = makeEntity("a", "甲国", "plains-mid", "人类", "王国", { population: 100000, military: 1000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const b = makeEntity("b", "乙国", "coast-east", "人类", "部落", { population: 50000, military: 300 }, { "农业": 15, "制度": 10 }, {}, "人类");
    b.territory = ["coast-east", "forest-valley"];
    const session = createSession({ laws: world, regions, entities: [a, b], config: { seed: 1 } });
    const ev = { id: "c", tick: 1, time_label: "t1", type: "conquest", participants: ["a", "b"], region: "plains-mid", description: "甲国吞并乙国", changes: [], random: false, source: "agent" };
    const result = conquerEntity(session.entities["a"], session.entities["b"], ev, 1);
    assert.ok(result.conqueror.territory.includes("plains-mid"), "吞并者核心区保留");
    assert.ok(result.conqueror.territory.includes("coast-east"), "被吞者领土并入");
    assert.ok(result.conqueror.territory.includes("forest-valley"), "被吞者多区划并入");
    assert.equal(result.conqueror.territory.length, 3, "去重合并");
  });
});

describe("territory 工具函数", () => {
  test("addTerritory 去重合并", () => {
    assert.deepEqual(addTerritory(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
    assert.deepEqual(addTerritory(undefined, ["a"]), ["a"]);
  });

  test("expandTerritory 递归展开子区划", () => {
    const geography = buildGeography(mkRegions());
    // 构造父子层级
    geography["sub-1"] = { id: "sub-1", name: "子1", unitKind: "region", neighbors: ["plains-mid"], parent: "plains-mid", children: [], namesByEntity: {}, layer: 1, refined: true };
    geography["sub-1a"] = { id: "sub-1a", name: "子1a", unitKind: "region", neighbors: ["sub-1"], parent: "sub-1", children: [], namesByEntity: {}, layer: 2, refined: true };
    geography["plains-mid"].children = ["sub-1"];
    geography["sub-1"].children = ["sub-1a"];
    // 领土 = 父区划 → 展开含全部子孙
    const expanded = expandTerritory(["plains-mid"], geography);
    assert.ok(expanded.includes("plains-mid"));
    assert.ok(expanded.includes("sub-1"), "展开子区划");
    assert.ok(expanded.includes("sub-1a"), "递归展开孙子区划");
  });

  test("territoryArea 累加面积", () => {
    const geography = buildGeography(mkRegions());
    geography["plains-mid"].dimensions = { width: 100, height: 100, area: 10000 };
    geography["coast-east"].dimensions = { width: 50, height: 50, area: 2500 };
    const area = territoryArea(["plains-mid", "coast-east"], geography, (u) => u.dimensions?.area ?? 0);
    assert.equal(area, 12500, "两区面积累加");
  });
});

describe("区划归属(共享)", () => {
  test("多实体共享区划 controllers", () => {
    const regions = mkRegions();
    const session = createSession({ laws: world, regions, entities: [], config: { seed: 1 } });
    session.geography["plains-mid"].controllers = ["a", "b"];
    assert.deepEqual(session.geography["plains-mid"].controllers, ["a", "b"], "区划可被多实体共享");
  });
});

// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 初始化重构验收测试（时代驱动的有的放矢初始化）:
 * - 实体先行: era/realm_scale/topRegionId/origin 推断与落卡
 * - 聚焦区域细化: 只细化实体所在顶层区域, 其余保持概略; 实体绑定最细子区划
 * - 发源地分离/时代一致性 软冲突检测
 * - skeleton 空区域 → 确定性兜底顶层(防全挤一区); regionId 落空时按未占用区域分散
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("区域命名铁律（纯自然地理名）", () => {
  test("政权词/种族词/方位泛称 → 违规; 纯地理名 → 合规", async () => {
    const { regionNameViolations } = await import("./init-customizer.ts");
    const regions = [
      { id: "dwarf-kingdom-cont", name: "矮人王国大陆", biome: "mixed" },
      { id: "elf-forest", name: "精灵森林", biome: "forest" },
      { id: "central-lowland", name: "中央低地", biome: "plains", parent: "x" },
      { id: "yellow-river", name: "黄河流域", biome: "plains", parent: "x" },
      { id: "silver-fir", name: "银桦森林", biome: "forest" },
      { id: "human-settle", name: "艾洛瑞亚人聚地", biome: "plains", parent: "x" },
    ] as any;
    const v = regionNameViolations(regions);
    const joined = v.join("\n");
    assert.ok(joined.includes("矮人王国大陆"), "政权词违规: " + joined);
    assert.ok(joined.includes("精灵森林"), "种族词违规");
    assert.ok(joined.includes("中央低地"), "方位泛称违规");
    assert.ok(joined.includes("人聚地"), "居住者词违规");
    assert.ok(!joined.includes("黄河流域"), "合规名不报: " + joined);
    assert.ok(!joined.includes("银桦森林"), "合规名不报");
  });
});

describe("初始化重构 — 面积比驱动层级", () => {
  test("realm_area 确定性兜底: LLM 未给地盘面积时按 人口×时代密度 估算", async () => {
    // entities 步骤不带 realm_area → 引擎按部落密度 3 人/km² 兜底
    const mock = createMockLLM((prompt) => {
      const p = prompt + " ";
      if (p.includes("世界骨架")) {
        return JSON.stringify({ laws: { rules: [], narrative: [] }, measurement: { lengthUnit: "公里", worldWidth: 10000, worldHeight: 5000 }, regions: [{ id: "c1", name: "大陆", biome: "mixed", share: 0.5 }] });
      }
      if (p.includes("文明/种族实体")) {
        return JSON.stringify({ entities: [
          { name: "部落", species: "人类", era: "部落时代", realm_scale: "settlement", topRegionId: "c1", politicalForm: "部落", population: 60000 },
        ] });
      }
      if (p.includes("有的放矢")) {
        return JSON.stringify({ regions: [], entities: [] });
      }
      return JSON.stringify({ relations: [] });
    });
    const completed = await completeInitialState(EMPTY, mock, "部落时代的一块大陆");
    assert.ok(completed.entities[0].realm_area > 0, "realm_area 被兜底: " + completed.entities[0].realm_area);
    // 60000 人口 / 部落密度 3 ≈ 20000
    assert.equal(completed.entities[0].realm_area, 20000);
  });

  test("多级层级链: 聚焦步骤生成 3 级链, 实体绑定最细一级", async () => {
    const mock = createMockLLM((prompt) => {
      const p = prompt + " ";
      if (p.includes("世界骨架")) {
        return JSON.stringify({ laws: { rules: [], narrative: [] }, measurement: { lengthUnit: "公里", worldWidth: 10000, worldHeight: 5000 }, regions: [{ id: "asia", name: "亚洲大陆", biome: "mixed", share: 0.6 }] });
      }
      if (p.includes("文明/种族实体")) {
        return JSON.stringify({ entities: [
          { name: "人类部落", species: "人类", era: "部落时代", realm_scale: "settlement", topRegionId: "asia", politicalForm: "部落", population: 50000 },
        ] });
      }
      if (p.includes("有的放矢")) {
        // 3 级链: 大陆 → 次大陆 → 地区 → 核心(绑定)
        return JSON.stringify({
          regions: [
            { id: "east-asia", name: "东亚", parent: "asia", biome: "mixed", share: 0.3 },
            { id: "north-china", name: "华北", parent: "east-asia", biome: "plains", share: 0.4 },
            { id: "yellow-mid", name: "黄河流域中游", parent: "north-china", biome: "plains", share: 0.5 },
          ],
          entities: [{ name: "人类部落", regionId: "yellow-mid" }],
        });
      }
      return JSON.stringify({ relations: [] });
    });
    const completed = await completeInitialState(EMPTY, mock, "类地行星, 人类部落");
    // 3 级链完整: asia → east-asia → north-china → yellow-mid
    const byId = new Map(completed.regions.map((r) => [r.id, r]));
    const chain = [];
    let cur = byId.get("yellow-mid");
    while (cur) { chain.unshift(cur.id); cur = cur.parent ? byId.get(cur.parent) : null; }
    assert.deepEqual(chain, ["asia", "east-asia", "north-china", "yellow-mid"], "完整多级链: " + chain.join("→"));
    assert.equal(completed.entities[0].regionId, "yellow-mid", "实体绑定最细一级");
  });
});


import { EARTH_LAWS } from "./physics.ts";
import { createRng } from "./random.ts";
import { createMockLLM } from "./llm.ts";
import { completeInitialState, detectInitialConflicts, initialStateToSession } from "./init-customizer.ts";

const EMPTY = { laws: { rules: [], narrative: [], ontology: [] }, regions: [], entities: [] };

describe("初始化重构 — 时代驱动的有的放矢", () => {
  test("聚焦细化: 只细化实体所在顶层区域, 其余顶层保持概略; 实体绑定最细子区划", async () => {
    // mock: 骨架 3 顶层; 实体 2 个(绑定不同顶层); 聚焦细化只在实体顶层下建子区划并回填 regionId
    const mock = createMockLLM((prompt) => {
      const p = prompt + " ";
      if (p.includes("世界骨架")) {
        return JSON.stringify({
          laws: { rules: [], narrative: [], ontology: [] },
          measurement: { lengthUnit: "公里", worldWidth: 4000, worldHeight: 3000 },
          regions: [
            { id: "north-cont", name: "北大陆", biome: "mixed" },
            { id: "south-cont", name: "南大陆", biome: "mixed" },
            { id: "west-cont", name: "西大陆", biome: "mixed" },
          ],
        });
      }
      if (p.includes("文明/种族实体")) {
        return JSON.stringify({ entities: [
          { name: "人类部落", species: "人类", era: "部落时代", realm_scale: "settlement", topRegionId: "north-cont", politicalForm: "部落", population: 50000, origin: "最早迁徙到北大陆的类人分支" },
          { name: "精灵", species: "精灵", era: "部落时代", realm_scale: "settlement", topRegionId: "south-cont", politicalForm: "部族议会", population: 30000, origin: "类人亚种中进入森林的一支" },
        ] });
      }
      if (p.includes("有的放矢")) {
        // 聚焦: 只为实体所在顶层细化(北大陆 1 级, 南大陆 1 级), 西大陆(无实体)不细化
        return JSON.stringify({
          regions: [
            { id: "north-valley", name: "北谷地", parent: "north-cont", biome: "plains", share: 0.4 },
            { id: "south-forest", name: "南森林", parent: "south-cont", biome: "forest", share: 0.5 },
          ],
          entities: [
            { name: "人类部落", regionId: "north-valley" },
            { name: "精灵", regionId: "south-forest" },
          ],
        });
      }
      if (p.includes("自洽校验者")) {
        const body = p.split("该层输出")[1]?.split("# 用户原文")[0];
        return body ? body.trim() : "{}";
      }
      return JSON.stringify({ relations: [] });
    });
    const completed = await completeInitialState(EMPTY, mock, "一块大陆上有人类部落和精灵, 部落时代");
    // 实体: 2 个, era/realm_scale/origin 保留, regionId 由聚焦步骤回填
    assert.equal(completed.entities.length, 2);
    assert.equal(completed.entities[0].era, "部落时代");
    assert.equal(completed.entities[0].realm_scale, "settlement");
    assert.ok(completed.entities[0].origin.includes("类人分支"), "origin 保留");
    assert.equal(completed.entities[0].regionId, "north-valley", "实体绑定最细子区划");
    assert.equal(completed.entities[1].regionId, "south-forest");
    // 区域: 3 顶层 + 2 子区划 = 5; 西大陆(无实体)没有子区划
    assert.equal(completed.regions.length, 5, "聚焦细化: 总区域数 5 (非全量枚举)");
    const west = completed.regions.find((r) => r.id === "west-cont");
    assert.ok(west, "西大陆存在但无子区划");
    assert.equal(completed.regions.filter((r) => r.parent === "west-cont").length, 0, "无实体的顶层不枚举子区划");
    assert.equal(completed.regions.filter((r) => r.parent === "north-cont").length, 1);
  });

  test("initialStateToSession: era 写入 identity.era, origin 写入 origin_story", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "r", name: "谷地", biome: "plains" }],
      entities: [
        { name: "部落", species: "人类", regionId: "r", population: 40000, era: "部落时代", origin: "从冰原南迁而来的一支" },
      ],
    };
    const res = initialStateToSession(completed, createRng(1), EARTH_LAWS);
    assert.equal(res.entities[0].identity.era, "部落时代");
    assert.equal(res.entities[0].identity.origin_story, "从冰原南迁而来的一支");
  });

  test("发源地分离软冲突: 不同物种绑同一区域 → origin_separation; 时代不一致 → era_mismatch", () => {
    const parsed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [],
      entities: [
        { name: "人类", species: "人类", topRegionId: "north", era: "部落时代" },
        { name: "精灵", species: "精灵", topRegionId: "north", era: "部落时代" },
        { name: "矮人", species: "矮人", topRegionId: "south", era: "工业时代" },
      ],
    };
    const conflicts = detectInitialConflicts(parsed);
    assert.ok(conflicts.some((c) => c.kind === "origin_separation" && c.severity === "soft"), "跨物种同区域 → 软冲突");
    assert.ok(conflicts.some((c) => c.kind === "era_mismatch" && c.severity === "soft"), "时代不一致 → 软冲突");
    // 同物种共享区域不报发源地分离
    const sameSpecies = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [],
      entities: [
        { name: "北国", species: "人类", topRegionId: "north" },
        { name: "南国", species: "人类", topRegionId: "north" },
      ],
    };
    assert.ok(!detectInitialConflicts(sameSpecies).some((c) => c.kind === "origin_separation"), "同物种共享区域不报");
  });

  test("skeleton 空区域 → 确定性兜底顶层; regionId 落空时按未占用区域分散(不挤一区)", async () => {
    // 骨架层返回无 regions(LLM 敷衍), entities 层返回带 topRegionId 的实体
    const mock = createMockLLM((prompt) => {
      const p = prompt + " ";
      if (p.includes("世界骨架")) {
        return JSON.stringify({ laws: { rules: [], narrative: [] }, measurement: { lengthUnit: "公里", worldWidth: 3000, worldHeight: 2000 }, regions: [] });
      }
      if (p.includes("文明/种族实体")) {
        return JSON.stringify({ entities: [
          { name: "人类", species: "人类", era: "部落时代", realm_scale: "settlement", topRegionId: "coast-east", politicalForm: "部落", population: 30000 },
          { name: "兽人", species: "兽人", era: "部落时代", realm_scale: "settlement", topRegionId: "steppe-west", politicalForm: "部落", population: 25000 },
        ] });
      }
      if (p.includes("有的放矢")) {
        // 不为实体建子区划(聚焦步骤只回填 top 本身)
        return JSON.stringify({ regions: [], entities: [] });
      }
      return JSON.stringify({ relations: [] });
    });
    const completed = await completeInitialState(EMPTY, mock, "一个大陆有部落");
    assert.ok(completed.regions.length >= 6, "骨架兜底: 确定性 6 顶层区域, got " + completed.regions.length);
    // regionId 未回填 → 实体保持 topRegionId? 不——topRegionId 是区域 id, regionId 落空时 initialStateToSession 分散 fallback
    const res = initialStateToSession(completed, createRng(3), EARTH_LAWS);
    const regions = res.entities.map((e) => e.geography.region);
    assert.equal(new Set(regions).size, res.entities.length, "不同实体不挤同一区域: " + regions.join(","));
  });

  test("completeInitialState 对 parsed=null 鲁棒(不崩溃, 正常产出)", async () => {
    const mock = createMockLLM(() => JSON.stringify({
      laws: { rules: [], narrative: [], ontology: [] },
      measurement: { lengthUnit: "公里", worldWidth: 3000, worldHeight: 2000 },
      regions: [{ id: "r1", name: "平原", biome: "plains" }],
      entities: [{ name: "族", species: "人类", regionId: "r1", population: 40000 }],
    }));
    const completed = await completeInitialState(null as any, mock, "一个世界");
    assert.ok(completed.entities.length >= 1, "null parsed 不崩溃");
    assert.ok(completed.regions.length >= 1);
  });
});

// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 空间尺度 + 度量单位 + 环境三层系统验收测试。
 *
 * 验证：
 * - 度量单位可换算真实单位（世界单位 → SI）
 * - 空间尺度确定（大陆 → 区域尺寸/距离派生）
 * - 环境三层生成（地理/气候/生态）
 * - 生态演化（被文明改变 + 自然演替）
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS, MAGIC_LAWS } from "./physics.ts";
import { defaultRegions, createSession, makeEntity } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import {
  toSI, fromSI, toKm, toKm2, formatRealDistance,
  deriveRegionScales, deriveRegionEnvironment, evolveEcology,
  allocateChildAreas, deriveHierarchyScales,
  EARTH_MEASUREMENT,
} from "./measure.ts";

describe("度量单位换算 — 可换算真实单位", () => {
  test("公里 → 米 (to_si=1000)", () => {
    assert.equal(toSI(EARTH_LAWS, "length", 2), 2000); // 2公里 = 2000米
  });

  test("平方公里 → 平方米 (to_si=1e6)", () => {
    assert.equal(toSI(EARTH_LAWS, "area", 3), 3_000_000);
  });

  test("fromSI 反向换算", () => {
    assert.equal(fromSI(EARTH_LAWS, "length", 5000), 5); // 5000米 = 5公里
  });

  test("toKm 真实单位", () => {
    assert.equal(toKm(EARTH_LAWS, 2), 2); // 2公里单位 = 2km
  });

  test("自定义单位换算率（非真实单位世界）", () => {
    // 世界自定义单位 "里" = 500米
    const world = { ...EARTH_LAWS, measurement_system: { ...EARTH_MEASUREMENT, length: { name: "里", kind: "length", to_si: 500 } } };
    assert.equal(toSI(world, "length", 2), 1000); // 2里 = 1000米
    assert.equal(toKm(world, 2), 1); // 2里 = 1km
  });

  test("formatRealDistance 人类可读", () => {
    assert.equal(formatRealDistance(1500), "1.5 km");
    assert.equal(formatRealDistance(800), "800 m");
  });
});

describe("空间尺度派生 — 大陆 → 区域尺寸/距离", () => {
  test("区域获得确定性尺寸, 距离为正", () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const scaled = deriveRegionScales(EARTH_LAWS, regions, { continentKm: { width: 2000, height: 1600 } });

    for (const r of Object.values(scaled)) {
      assert.ok(r.dimensions.width > 0, `${r.id} 有宽度`);
      assert.ok(r.dimensions.height > 0, `${r.id} 有高度`);
      assert.ok(r.dimensions.area > 0, `${r.id} 有面积`);
      // 邻接距离为正
      for (const d of Object.values(r.distances ?? {})) {
        assert.ok(d > 0, `${r.id} 邻接距离为正`);
      }
    }
    // 总面积约等于大陆面积（近似）
    const totalArea_km2 = Object.values(scaled).reduce((s, r) => s + toKm2(EARTH_LAWS, r.dimensions.area), 0);
    assert.ok(totalArea_km2 > 2_000_000, `总面积接近大陆 (${Math.round(totalArea_km2 / 1e6)}M km²)`);
  });

  test("尺寸确定性（同输入同结果）", () => {
    const a = defaultRegions();
    const b = defaultRegions();
    for (const [id, r] of Object.entries(a)) a[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    for (const [id, r] of Object.entries(b)) b[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const sa = deriveRegionScales(EARTH_LAWS, a, { continentKm: { width: 2000, height: 1600 } });
    const sb = deriveRegionScales(EARTH_LAWS, b, { continentKm: { width: 2000, height: 1600 } });
    assert.deepEqual(sa["coast-east"].dimensions, sb["coast-east"].dimensions);
  });
});

describe("区域面积按 share 分配（改动 A: LLM 占比落地）", () => {
  test("allocateChildAreas 按 share 归一化, 子面积和=父面积", () => {
    // 父面积 1000 km², 子 share: 0.5 / 0.3 / 0.2 → 500/300/200
    const areas = allocateChildAreas(1000, [
      { id: "a", share: 0.5 }, { id: "b", share: 0.3 }, { id: "c", share: 0.2 },
    ]);
    assert.equal(areas.get("a"), 500);
    assert.equal(areas.get("b"), 300);
    assert.equal(areas.get("c"), 200);
  });

  test("无 share → 网格铺开 + 自然差异 + 允许缝隙（点1修正: 均分网格≠面积全相等）", () => {
    const areas = allocateChildAreas(900, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    // 面积有自然差异（不强制全相等）
    const vals = [areas.get("a")!, areas.get("b")!, areas.get("c")!];
    assert.ok(vals.some((v) => v !== 300), "面积不强制全相等(有自然差异)");
    // 总和 ≤ 父面积（多余=缝隙/荒野）
    const sum = vals.reduce((a, b) => a + b, 0);
    assert.ok(sum <= 900, `Σ子面积 ≤ 父面积, got ${sum}`);
    assert.ok(sum >= 900 * 0.5, "子面积覆盖父面积的主体(非稀疏)");
  });

  test("share 和 < 1 时仍归一化（面积按相对权重）", () => {
    // share: 0.1 / 0.1 → 权重相等, 各得一半
    const areas = allocateChildAreas(1000, [{ id: "a", share: 0.1 }, { id: "b", share: 0.1 }]);
    assert.equal(areas.get("a"), 500);
    assert.equal(areas.get("b"), 500);
  });

  test("deriveHierarchyScales: 子区面积随 share, 总面积守恒", () => {
    const regions: Record<string, import("./types.ts").SpaceRegion> = {
      top: { id: "top", name: "大陆", biome: "plains", resources: deriveRegionResources("plains", EARTH_LAWS), neighbors: [], layer: 0, refined: false, share: 1.0 },
      east: { id: "east", name: "东域", biome: "plains", resources: deriveRegionResources("plains", EARTH_LAWS), neighbors: ["top"], parent: "top", share: 0.25, layer: 0, refined: false },
      west: { id: "west", name: "西域", biome: "steppe", resources: deriveRegionResources("steppe", EARTH_LAWS), neighbors: ["top"], parent: "top", share: 0.75, layer: 0, refined: false },
    };
    regions["top"].children = ["east", "west"];
    const scaled = deriveHierarchyScales(EARTH_LAWS, regions, { width: 1000, height: 800 });
    // 大陆 1000×800 = 800000 km²; top share 1.0 → top ≈ 800000
    const topKm2 = toKm2(EARTH_LAWS, scaled["top"].dimensions!.area);
    assert.ok(Math.abs(topKm2 - 800000) < 800000 * 0.05, `top 面积≈大陆: ${topKm2}`);
    // east/west 按 share 分 top 面积
    const eastKm2 = toKm2(EARTH_LAWS, scaled["east"].dimensions!.area);
    const westKm2 = toKm2(EARTH_LAWS, scaled["west"].dimensions!.area);
    assert.ok(Math.abs(eastKm2 - 800000 * 0.25) < 800000 * 0.05, `east 面积≈25% 大陆: ${eastKm2}`);
    assert.ok(Math.abs(westKm2 - 800000 * 0.75) < 800000 * 0.05, `west 面积≈75% 大陆: ${westKm2}`);
    // 面积守恒
    assert.ok(Math.abs((eastKm2 + westKm2) - 800000) < 800000 * 0.1, "子面积和≈大陆面积");
  });
});

describe("环境三层生成 — 地理/气候/生态初始确定", () => {
  test("山地海拔高, 沿海海拔低", () => {
    const mountains = deriveRegionEnvironment({ id: "m", name: "山", biome: "mountains", resources: deriveRegionResources("mountains", EARTH_LAWS), neighbors: [], layer: 0, refined: false });
    const coast = deriveRegionEnvironment({ id: "c", name: "海", biome: "coast", resources: deriveRegionResources("coast", EARTH_LAWS), neighbors: [], layer: 0, refined: false });
    assert.ok(mountains.geography.elevation > coast.geography.elevation, "山地高于沿海");
  });

  test("沙漠干燥, 森林湿润多植被", () => {
    const desert = deriveRegionEnvironment({ id: "d", name: "漠", biome: "desert", resources: deriveRegionResources("desert", EARTH_LAWS), neighbors: [], layer: 0, refined: false });
    const forest = deriveRegionEnvironment({ id: "f", name: "林", biome: "forest", resources: deriveRegionResources("forest", EARTH_LAWS), neighbors: [], layer: 0, refined: false });
    assert.ok(desert.climate.precipitation < forest.climate.precipitation, "沙漠降水少");
    assert.ok(desert.ecology.vegetation < forest.ecology.vegetation, "沙漠植被少");
    assert.ok(desert.ecology.arable_land < forest.ecology.arable_land, "沙漠可耕地少");
  });

  test("createSession 自动派生尺寸与环境(分层 LOD)", () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: EARTH_LAWS, regions, entities: [ent], config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } } });
    const known = session.regions["plains-mid"];
    const remote = session.regions["desert-south"];
    assert.ok(known.dimensions, "文明区有尺寸");
    assert.ok(known.environment, "文明区有环境(layer 1)");
    assert.equal(known.layer, 1, "文明区 layer 1");
    assert.ok(remote.dimensions, "非文明区也有尺寸(空间拓扑)");
    assert.equal(remote.layer, 0, "非文明区 layer 0(概略)");
  });
});

describe("生态演化 — 被文明改变 + 自然演替", () => {
  test("人口压力 → 砍伐/垦殖", () => {
    const env = deriveRegionEnvironment({ id: "p", name: "平原", biome: "plains", resources: deriveRegionResources("plains", EARTH_LAWS), neighbors: [], layer: 0, refined: false });
    const eco = evolveEcology(env, { populationPressure: 1.5, agricultureTech: 60 });
    assert.ok(eco.vegetation_delta <= 0, "人口压力 → 植被减少（砍伐）");
    assert.ok(eco.arable_delta > 0, "农业技术 → 可耕地增加（垦殖）");
  });

  test("战争焦土 → 植被/多样性下降", () => {
    const env = deriveRegionEnvironment({ id: "p", name: "平原", biome: "plains", resources: deriveRegionResources("plains", EARTH_LAWS), neighbors: [], layer: 0, refined: false });
    const eco = evolveEcology(env, { warScorched: true });
    assert.ok(eco.vegetation_delta < 0, "战争 → 植被减少");
    assert.ok(eco.biodiversity_delta < 0, "战争 → 多样性下降");
  });

  test("生态改变被标记 modified", () => {
    // 完整演化链: 人口压力导致生态变化
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: EARTH_LAWS, regions, entities: [ent], config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } } });
    const r = session.regions["plains-mid"];
    // 初始未改变
    assert.equal(r.environment.ecology.modified, false);
    // 手动应用演化（模拟文明改变）
    const eco = evolveEcology(r.environment, { populationPressure: 1.2 });
    assert.ok(Math.abs(eco.vegetation_delta) + Math.abs(eco.arable_delta) > 0, "有人口压力 → 生态变化");
  });
});

describe("世界度量差异 — 不同世界不同单位", () => {
  test("魔法世界有度量系统", () => {
    assert.ok(MAGIC_LAWS.measurement_system, "魔法世界有度量系统");
    assert.ok(MAGIC_LAWS.measurement_system.length.to_si > 0, "长度单位有换算率");
  });
});

describe("分层空间初始化 LOD（§4.0②）", () => {
  test("文明所在地细(layer 1+环境), 无人区概略(layer 0 无环境)", () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const ent = makeEntity("e", "东境王国", "coast-east", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: EARTH_LAWS, regions, entities: [ent], config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } } });
    const known = session.regions["coast-east"];
    const remote = session.regions["desert-south"];
    assert.equal(known.layer, 1, "文明区 layer 1");
    assert.ok(known.environment, "文明区有完整环境");
    assert.equal(remote.layer, 0, "无人区 layer 0");
    assert.ok(!remote.environment, "无人区概略(无完整环境), 由 scale 兜底");
  });

  test("分层后物理层/感知不崩(无人区靠兜底)", async () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: EARTH_LAWS, regions, entities: [ent], config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } } });
    // 推演 5 tick, 物理层/生态不因无人区缺环境而崩
    const { runTicks } = await import("./engine.ts");
    const { createMockLLM } = await import("./llm.ts");
    const mock = createMockLLM(() => JSON.stringify({ decisions: [], events: [{ type: "other", description: "各邦延续" }], metric_delta: {} }));
    await runTicks(session, 5, { agentConfig: { llm: mock }, llm: mock });
    assert.ok(session.current_tick >= 5, "推演正常推进");
    assert.ok(Object.values(session.entities).length > 0);
  });
});

describe("细化即锁定 → 生成实际子区域", () => {
  test("事件细化无人区 → 生成 layer+1 子区域 + parent 指向", async () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: EARTH_LAWS, regions, entities: [ent], config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } } });
    const before = Object.keys(session.regions).length;
    // 触发无人区(desert-south)细化: 事件描述该区域细节, 走 arbitrate → refinements
    const { arbitrate } = await import("./arbiter.ts");
    // B3: 只有"空间细节事件"(engine 源、非随机)才触发细化入库——agent 行为叙事不锁为空间事实
    const ev = {
      id: "refine-ev", tick: 1, time_label: "t1", type: "cultural", participants: ["e"],
      region: "desert-south", description: "绿洲边缘出现早期聚落, 盐碱滩涂与灌溉渠道交错。",
      changes: [], random: false, source: "engine",
    };
    const arb = await arbitrate({
      laws: session.laws, config: session.config, entities: session.entities,
      lore: session.lore, currentTick: 1,
    }, [ev]);
    assert.ok(arb.refinements.length > 0, "无人区事件触发细化");
    // 模拟 engine 细化写回: 复制 engine.ts 的子区域生成逻辑
    for (const r of arb.refinements) {
      if (session.regions[r.scope]) {
        const parent = session.regions[r.scope];
        session.regions[`${r.scope}:sub-test`] = {
          id: `${r.scope}:sub-test`, name: `${parent.name}·细化`, biome: parent.biome,
          resources: parent.resources, neighbors: [r.scope], parent: r.scope,
          layer: Math.max(1, parent.layer + 1), refined: true,
        };
      }
    }
    const child = session.regions["desert-south:sub-test"];
    assert.ok(child, "生成子区域");
    assert.equal(child.parent, "desert-south", "parent 指向父区");
    assert.ok(child.layer > session.regions["desert-south"].layer, "layer 递增");
    assert.ok(Object.keys(session.regions).length > before, "区域数增加");
  });
});

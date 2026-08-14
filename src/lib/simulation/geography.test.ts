// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 独立地理地图 + 命名主观性测试（§4.0②）。
 *
 * 验证:
 * - 自然实体创建(初始化)
 * - 不同实体对同一区域不同称谓(命名主观性)
 * - 称谓 fallback 默认名
 * - 海洋可细化出子单元
 * - 同级邻接 + 上下级 parent/children
 * - agent 用本实体视角名
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import {
  buildGeography, nameFor, setNameFor, refineGeographyUnit,
} from "./geography.ts";
import { nameFeature } from "./culture.ts";
import { createRng } from "./random.ts";
import { generateWorldLanguages } from "./culture.ts";

const world = EARTH_LAWS;

function mkRegions() {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, world) };
  return regions;
}

describe("自然实体创建(初始化)", () => {
  test("createSession 初始化 geography, 含区域 + 自然实体", () => {
    const regions = mkRegions();
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const features = [
      { id: "feat-mt", name: "银脊山", unitKind: "feature", kind: "山脉", region: "plains-mid", neighbors: [], namesByEntity: {} },
      { id: "feat-river", name: "三河", unitKind: "feature", kind: "河流", region: "plains-mid", neighbors: [], namesByEntity: {} },
    ];
    const session = createSession({ laws: world, regions, entities: [ent], config: { seed: 1 }, features });
    // 区域进入 geography
    assert.ok(session.geography["plains-mid"], "区域进入地理地图");
    assert.equal(session.geography["plains-mid"].unitKind, "region");
    // 自然实体进入
    assert.ok(session.geography["feat-mt"], "自然实体进入地理地图");
    assert.equal(session.geography["feat-mt"].kind, "山脉");
    assert.equal(session.geography["feat-mt"].region, "plains-mid");
    // 自然实体挂到区域 children
    assert.ok(session.geography["plains-mid"].children.includes("feat-mt"), "自然实体登记到区域 children");
  });
});

describe("命名主观性", () => {
  test("不同实体对同一区域不同称谓, fallback 默认名", () => {
    const regions = mkRegions();
    const session = createSession({ laws: world, regions, entities: [], config: { seed: 1 } });
    // 默认名
    assert.equal(nameFor(session, "plains-mid", "e1"), session.regions["plains-mid"].name, "无称谓 → fallback 默认名");
    // 实体 e1 命名
    setNameFor(session.geography, "plains-mid", "e1", "中原");
    setNameFor(session.geography, "plains-mid", "e2", "中央平原");
    assert.equal(nameFor(session, "plains-mid", "e1"), "中原", "e1 视角叫中原");
    assert.equal(nameFor(session, "plains-mid", "e2"), "中央平原", "e2 视角叫中央平原");
    assert.equal(nameFor(session, "plains-mid", "e3"), session.regions["plains-mid"].name, "e3 未命名 → fallback");
  });

  test("自然实体也有 per-entity 称谓", () => {
    const regions = mkRegions();
    const features = [{ id: "feat-mt", name: "银脊山", unitKind: "feature", kind: "山脉", region: "plains-mid", neighbors: [], namesByEntity: {} }];
    const session = createSession({ laws: world, regions, entities: [], config: { seed: 1 }, features });
    setNameFor(session.geography, "feat-mt", "e1", "白山脉");
    assert.equal(nameFor(session, "feat-mt", "e1"), "白山脉");
    assert.equal(nameFor(session, "feat-mt", "e2"), "银脊山", "其他实体用默认名");
  });
});

describe("nameFeature 自然实体命名(用语言系统)", () => {
  test("从实体语言生成自然实体名", () => {
    const gen = generateWorldLanguages({ seed: 42, entities: [{ species: "人类", cultureName: "中原", regionBiome: "plains" }] });
    const lang = Object.values(gen.languages)[0];
    const rng = createRng(1);
    const name = nameFeature(lang, "山脉", rng);
    assert.ok(name.length > 0, "生成非空名");
    const riverName = nameFeature(lang, "河流", createRng(2));
    assert.ok(riverName.length > 0);
  });
});

describe("海洋可细化 + 上下级关系", () => {
  test("细化海洋 → 生成子单元(parent/children/layer 递增)", () => {
    const regions = mkRegions();
    const session = createSession({ laws: world, regions, entities: [], config: { seed: 1 } });
    const before = Object.keys(session.geography).length;
    const bay = refineGeographyUnit(session.geography, "coast-east", "bay-1", "东湾", "海湾");
    assert.ok(bay, "生成海湾子单元");
    assert.equal(bay.parent, "coast-east", "parent 指向海洋/沿海区");
    assert.equal(bay.kind, "海湾");
    assert.equal(bay.unitKind, "feature");
    assert.equal(bay.layer, (session.geography["coast-east"].layer ?? 0) + 1, "layer 递增");
    assert.ok(session.geography["coast-east"].children.includes("bay-1"), "子单元登记到 children");
    assert.ok(Object.keys(session.geography).length > before, "单元数增加");
  });

  test("同级邻接记录", () => {
    const regions = mkRegions();
    const session = createSession({ laws: world, regions, entities: [], config: { seed: 1 } });
    // 区域邻接同步到 geography
    assert.ok(session.geography["plains-mid"].neighbors.length > 0, "同级邻接存在");
    assert.ok(session.geography["plains-mid"].neighbors.includes("coast-east"), "plains-mid 邻接 coast-east");
  });
});

describe("agent 视角名(集成)", () => {
  test("buildAgentInput 尺度摘要用实体视角名", async () => {
    const regions = mkRegions();
    const ent = makeEntity("e", "东境王国", "coast-east", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: world, regions, entities: [ent], config: { seed: 1 } });
    // 实体给自家区域命名
    setNameFor(session.geography, "coast-east", "e", "曙光海岸");
    const { buildAgentInput, buildEntityKnowledge } = await import("./context.ts");
    const { classifyAttention } = await import("./context.ts");
    const k = buildEntityKnowledge(session, ent);
    const input = buildAgentInput(session, ent, k, classifyAttention(0.3));
    assert.ok(input.user.includes("曙光海岸"), "agent 尺度摘要用实体视角名");
  });
});

describe("细化同步 geography(engine 集成)", () => {
  test("仲裁细化区域 → regions 和 geography 都生成子区域", async () => {
    const regions = mkRegions();
    const ent = makeEntity("e", "国", "plains-mid", "人类", "部落", { population: 50000 }, { "农业": 15, "制度": 10 }, {}, "人类");
    const session = createSession({ laws: world, regions, entities: [ent], config: { seed: 1 } });
    // 触发无人区细化
    const { arbitrate } = await import("./arbiter.ts");
    // B3: 只有"空间细节事件"(engine 源、非随机)才触发细化入库——agent 行为叙事不锁为空间事实
    const ev = {
      id: "ref-ev", tick: 1, time_label: "t1", type: "cultural", participants: ["e"],
      region: "desert-south", description: "绿洲边缘出现聚落, 盐滩与灌溉渠交错。",
      changes: [], random: false, source: "engine",
    };
    const arb = await arbitrate({
      laws: session.laws, config: session.config, entities: session.entities,
      lore: session.lore, currentTick: 1,
    }, [ev]);
    assert.ok(arb.refinements.length > 0, "无人区触发细化");
    // 模拟 engine 细化写回(regions + geography)
    for (const r of arb.refinements) {
      if (session.regions[r.scope]) {
        const parent = session.regions[r.scope];
        const childId = `${r.scope}:sub-test2`;
        session.regions[childId] = {
          id: childId, name: `${parent.name}·细化`, biome: parent.biome, resources: parent.resources,
          neighbors: [r.scope], parent: r.scope, layer: Math.max(1, parent.layer + 1), refined: true,
        };
        if (session.geography[r.scope]) {
          session.geography[childId] = {
            id: childId, name: `${parent.name}·细化`, unitKind: "region", biome: parent.biome,
            neighbors: [r.scope], parent: r.scope, children: [], namesByEntity: {},
            resources: parent.resources, layer: Math.max(1, (session.geography[r.scope].layer ?? 0) + 1), refined: true,
          };
          session.geography[r.scope].children = [...(session.geography[r.scope].children ?? []), childId];
        }
      }
    }
    assert.ok(session.geography["desert-south:sub-test2"], "geography 生成子区域");
    assert.equal(session.geography["desert-south:sub-test2"].parent, "desert-south");
    assert.ok(session.geography["desert-south"].children.includes("desert-south:sub-test2"), "children 登记");
  });
});

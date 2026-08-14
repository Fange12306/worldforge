// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 区域多实体自动细分测试（改动 C）。
 * 验证:
 * - collectSubdivisionClusters 只收集 2+ 活跃实体、未细分、无子区划、未扩张的区域。
 * - decideSubdivision LLM 判定 + 程序化 fallback。
 * - applySubdivision 建 layer+1 子区划、实体重指、置 subdivided、写事件/lore。
 * - 防重复细分: 已细分后不再细分; LLM 判定不细分 → 拓扑不变。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, runTicks, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import {
  collectSubdivisionClusters, decideSubdivision, applySubdivision,
  maybeSubdivideRegions, SUBDIVISION_INTERVAL,
} from "./subdivision.ts";
import type { SimulationSession } from "./types.ts";

function twoEntitiesSameRegion() {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  const e1 = makeEntity("e1", "东境王国", "plains-mid", "人类", "kingdom",
    { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
    { "农业": 20 }, { "探索欲": 50 });
  const e2 = makeEntity("e2", "西境部落", "plains-mid", "人类", "tribe",
    { population: 50_000, food: 500, military: 200, legitimacy: 50, stability: 50 },
    { "农业": 15 }, { "探索欲": 40 });
  return createSession({
    laws: EARTH_LAWS, regions, entities: [e1, e2],
    config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
  });
}

describe("collectSubdivisionClusters — 候选收集", () => {
  test("同区域 2+ 活跃实体 → 候选", () => {
    const session = twoEntitiesSameRegion();
    const clusters = collectSubdivisionClusters(session);
    assert.equal(clusters.length, 1, "plains-mid 两实体同区 → 1 候选簇");
    assert.equal(clusters[0].entities.length, 2);
  });

  test("已 subdivided 的区域不候选", () => {
    const session = twoEntitiesSameRegion();
    session.regions["plains-mid"].subdivided = true;
    assert.equal(collectSubdivisionClusters(session).length, 0);
  });

  test("已有子区划的区域不候选", () => {
    const session = twoEntitiesSameRegion();
    session.regions["plains-mid"].children = ["plains-mid:sub1"];
    assert.equal(collectSubdivisionClusters(session).length, 0);
  });

  test("实体已扩张出簇区 → 不候选（细分语义不成立）", () => {
    const session = twoEntitiesSameRegion();
    session.entities["e1"].territory = ["plains-mid", "coast-east"];
    assert.equal(collectSubdivisionClusters(session).length, 0);
  });
});

describe("decideSubdivision — LLM 判定 + fallback", () => {
  test("无真实 LLM → 程序化 fallback 按实体均分", async () => {
    const session = twoEntitiesSameRegion();
    const cluster = collectSubdivisionClusters(session)[0];
    const plan = await decideSubdivision(session, cluster, 5, undefined);
    assert.ok(plan, "无 LLM 也有 fallback 方案");
    assert.equal(plan.split, true);
    assert.ok(plan.subregions.length >= 2, "切出多个子区划");
  });

  test("LLM 返回 split plan → 采用", async () => {
    const session = twoEntitiesSameRegion();
    const cluster = collectSubdivisionClusters(session)[0];
    const mock = {
      real: true,
      call: async () => JSON.stringify({
        split: true,
        reason: "两文明分据东西",
        subregions: [
          { id: "east-half", name: "东半", share: 0.5, entities: ["e1"] },
          { id: "west-half", name: "西半", share: 0.5, entities: ["e2"] },
        ],
      }),
    };
    const plan = await decideSubdivision(session, cluster, 5, mock);
    assert.ok(plan && plan.split, "采用 LLM 方案");
    assert.equal(plan.subregions.length, 2);
  });

  test("LLM 判定不细分 → null", async () => {
    const session = twoEntitiesSameSession();
    const cluster = collectSubdivisionClusters(session)[0];
    const mock = {
      real: true,
      call: async () => JSON.stringify({ split: false, reason: "两族交融共享" }),
    };
    const plan = await decideSubdivision(session, cluster, 5, mock);
    assert.equal(plan, null, "不细分 → null");
  });
});

function twoEntitiesSameSession() {
  const session = twoEntitiesSameRegion();
  session.regions["plains-mid"].subdivided = false;
  return session;
}

describe("applySubdivision — 执行", () => {
  test("建 layer+1 子区划, 实体重指, 置 subdivided, 写事件/lore", () => {
    const session = twoEntitiesSameRegion();
    const cluster = collectSubdivisionClusters(session)[0];
    const plan = {
      split: true,
      reason: "test",
      subregions: [
        { id: "east-half", name: "东半", share: 0.5, entities: ["e1"] },
        { id: "west-half", name: "西半", share: 0.5, entities: ["e2"] },
      ],
    };
    const ev = applySubdivision(session, cluster, plan, 5);
    assert.ok(ev, "产生细分事件");
    // 子区划存在, layer 递增
    assert.ok(session.regions["plains-mid:east-half"], "建 east-half");
    assert.ok(session.regions["plains-mid:west-half"], "建 west-half");
    assert.equal(session.regions["plains-mid:east-half"].layer, 2, "layer = 父+1");
    assert.equal(session.regions["plains-mid:east-half"].share, 0.5, "透传 share");
    // 实体重指
    assert.equal(session.entities["e1"].geography.region, "plains-mid:east-half", "e1 归东半");
    assert.equal(session.entities["e2"].geography.region, "plains-mid:west-half", "e2 归西半");
    assert.deepEqual(session.entities["e1"].territory, ["plains-mid:east-half"], "e1 领土重指");
    // 防重复细分
    assert.equal(session.regions["plains-mid"].subdivided, true, "置 subdivided");
    // 事件进日志
    assert.equal(ev.type, "region-subdivide");
    // lore 锁定
    assert.ok(session.lore.facts.some((f) => f.scope === "plains-mid:east-half"), "子区划锁 lore");
  });
});

describe("maybeSubdivideRegions — runTicks 入口", () => {
  test("到间隔 tick 才触发", async () => {
    const session = twoEntitiesSameRegion();
    const evs1 = await maybeSubdivideRegions(session, 1, undefined);
    assert.equal(evs1.length, 0, "tick 1 非间隔, 不触发");
    const evs2 = await maybeSubdivideRegions(session, SUBDIVISION_INTERVAL, undefined);
    assert.ok(evs2.length >= 1, `tick ${SUBDIVISION_INTERVAL} 触发细分`);
  });

  test("已细分后再次运行不重复细分", async () => {
    const session = twoEntitiesSameRegion();
    await maybeSubdivideRegions(session, SUBDIVISION_INTERVAL, undefined);
    const regionCount = Object.keys(session.regions).length;
    await maybeSubdivideRegions(session, SUBDIVISION_INTERVAL * 2, undefined);
    assert.equal(Object.keys(session.regions).length, regionCount, "不重复细分");
  });
});

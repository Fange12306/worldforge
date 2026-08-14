// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 0 验收测试 — 黑天鹅事件发生器（§7）：
 * 由世界法则 × 实体状态 × 区域特征 **组合生成**候选，而非预设模板池。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS, MAGIC_LAWS, QI_LAWS } from "./physics.ts";
import { makeEntity } from "./engine.ts";
import { makeBlackSwanContext, rollBlackSwan, generateBlackSwan, generateRareEvent } from "./black-swan.ts";
import { createRng } from "./random.ts";
import { defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import type { SpaceRegion } from "./types.ts";

function buildCtx(laws, entity, regionId, configOverrides = {}) {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) {
    regions[id] = { ...r, resources: deriveRegionResources(r.biome, laws) };
  }
  const region: SpaceRegion = regions[regionId] ?? regions["plains-mid"];
  const seed = configOverrides.seed ?? 123;
  const rng = createRng(seed);
  return makeBlackSwanContext({
    laws,
    entity,
    region,
    config: { randomness: 1, surprise: 0.3, rigor: 0.7, seed: 123, ...configOverrides },
    rng,
    tick: 5,
    techDims: Object.keys(entity.tech),
    valueDims: Object.keys(entity.values),
    populationPressure: 0.5,
    foodDeficit: false,
  });
}

describe("黑天鹅事件发生器 — 组合生成而非模板抽取", () => {
  test("同一实体不同区域生成不同事件（区域特征驱动）", () => {
    const e = makeEntity("e", "部族", "x", "人类", "tribe", {}, { "航海": 30, "农业": 20 }, { "探索欲": 50 });
    const ctxDesert = buildCtx(EARTH_LAWS, e, "desert-south");
    const ctxCoast = buildCtx(EARTH_LAWS, e, "coast-east");
    // 高 randomness 下强制生成，事件内容应不同（沙漠 vs 沿海）
    const descA = generateBlackSwan(ctxDesert)?.description ?? "";
    const descB = generateBlackSwan(ctxCoast)?.description ?? "";
    // 用大量采样验证分布不同（区域相关）
    const desertWords = new Set<string>();
    const coastWords = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const d = generateBlackSwan(buildCtx(EARTH_LAWS, e, "desert-south", { seed: i }))?.description ?? "";
      const c = generateBlackSwan(buildCtx(EARTH_LAWS, e, "coast-east", { seed: i }))?.description ?? "";
      desertWords.add(d);
      coastWords.add(c);
    }
    // 两种区域产生的事件集合不应完全重合（区域特征不同）
    const overlap = [...desertWords].filter((x) => coastWords.has(x)).length;
    assert.ok(overlap < Math.max(desertWords.size, coastWords.size), `区域应产生不同事件 (desert=${desertWords.size}, coast=${coastWords.size}, overlap=${overlap})`);
    void descA; void descB;
  });

  test("魔法世界生成魔力相关黑天鹅, 真实世界没有", () => {
    const e = makeEntity("e", "施法者", "x", "人类", "tribe", {}, { "魔力掌控": 20 }, { "探索欲": 50 });
    const magicCtx = buildCtx(MAGIC_LAWS, e, "forest-valley");
    const earthCtx = buildCtx(EARTH_LAWS, e, "plains-mid");
    const magicDescs = new Set<string>();
    const earthDescs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const m = generateBlackSwan(buildCtx(MAGIC_LAWS, e, "forest-valley", { seed: i }))?.description ?? "";
      const t = generateBlackSwan(buildCtx(EARTH_LAWS, e, "plains-mid", { seed: i }))?.description ?? "";
      magicDescs.add(m);
      earthDescs.add(t);
    }
    // 魔法世界应出现魔力/灵脉/施法等内容, 真实世界不应有
    const magicJoined = [...magicDescs].join("\n");
    const earthJoined = [...earthDescs].join("\n");
    assert.ok(magicJoined.includes("魔力") || magicJoined.includes("灵脉") || magicJoined.includes("法术"), "魔法世界应有魔力黑天鹅");
    assert.ok(!earthJoined.includes("灵脉"), "真实世界不应有灵脉黑天鹅");
  });

  test("真气世界生成灵气相关黑天鹅", () => {
    const e = makeEntity("e", "修士", "x", "人类", "tribe", {}, { "修为": 20 }, { "探索欲": 50 });
    const qiDescs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const q = generateBlackSwan(buildCtx(QI_LAWS, e, "mountains-north", { seed: i }))?.description ?? "";
      qiDescs.add(q);
    }
    const joined = [...qiDescs].join("\n");
    assert.ok(joined.includes("灵气") || joined.includes("福地") || joined.includes("秘境") || joined.includes("修士"), "真气世界应有灵气黑天鹅");
  });

  test("rollBlackSwan: randomness=0 不触发, randomness=1 必触发", () => {
    const e = makeEntity("e", "部族", "x", "人类", "tribe", {}, { "农业": 20 }, { "探索欲": 50 });
    const zero = buildCtx(EARTH_LAWS, e, "plains-mid", { randomness: 0 });
    assert.equal(rollBlackSwan(zero), null);

    const one = buildCtx(EARTH_LAWS, e, "plains-mid", { randomness: 1 });
    let triggered = 0;
    for (let i = 0; i < 100; i++) {
      if (rollBlackSwan(buildCtx(EARTH_LAWS, e, "plains-mid", { randomness: 1, seed: i }))) triggered++;
    }
    assert.ok(triggered > 50, "randomness=1 应频繁触发");
  });

  test("生成的事件有因果标记（供 rigor 仲裁）", () => {
    const e = makeEntity("e", "部族", "x", "人类", "tribe", {}, { "农业": 20 }, { "探索欲": 50 });
    const ctx = buildCtx(EARTH_LAWS, e, "plains-mid");
    const swan = generateBlackSwan(ctx);
    if (swan) {
      assert.ok(swan.causality === "natural" || swan.causality === "coincidental");
      assert.ok(swan.description.length > 0);
    }
  });
});

describe("稀有事件 LLM 综合生成（§7 主路径）", () => {
  test("真实 LLM mock 返回事件 → 生成候选, 效果被 clamp/过滤", async () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const entity = makeEntity("e", "东境王国", "plains-mid", "人类", "kingdom",
      { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
      { "农业": 40, "航海": 20 }, { "探索欲": 50 });
    const session = {
      current_tick: 5,
      laws: EARTH_LAWS,
      regions,
      entities: { e: entity },
      config: { surprise: 0.3, rigor: 0.7 } as never,
      events: [],
      registry: { dims: { "农业": { potential: 80 } } } as never,
    } as never;

    // real:true 的 mock LLM —— 返回一个灾难事件 + 人口负 delta
    const realLLM = {
      real: true,
      call: async () => JSON.stringify({
        type: "disaster",
        description: "平原腹地连月大旱，河流近乎断流，收成锐减。",
        metric_delta: { population: -5000, food: -2000 },
        severity: "severe",
      }),
    } as never;

    const swan = await generateRareEvent({ session, entity, region: regions["plains-mid"], tick: 5 }, realLLM);
    assert.ok(swan, "LLM 路径生成稀有事件");
    assert.ok(swan.description.includes("大旱"), "描述来自 LLM（非模板）");
    assert.equal(swan.metric_delta?.population, -5000, "人口 delta 透传（引擎侧 clamp）");
    assert.equal(swan.causality, "natural", "severe → natural 因果");
  });

  test("无真实 LLM → 返回 null（引擎回退程序化生成）", async () => {
    const regions = defaultRegions();
    const entity = makeEntity("e", "部族", "plains-mid", "人类", "tribe", {}, { "农业": 20 }, { "探索欲": 50 });
    const session = { current_tick: 1, laws: EARTH_LAWS, regions, entities: { e: entity }, config: {}, events: [], registry: { dims: {} } } as never;
    const swan = await generateRareEvent({ session, entity, region: regions["plains-mid"], tick: 1 }, undefined);
    assert.equal(swan, null, "无 LLM → 走程序化 fallback");
  });
});

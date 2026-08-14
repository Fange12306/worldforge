// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 叙事-数值一致性测试（改动 2）。
 * 验证:
 * - 事件 changes[].metrics 与顶层 metric_delta 合并去重（顶层优先, 不 double-count）。
 * - 顶层没碰的量由事件 changes 补齐。
 * - 事件声称超界指标 → 软警告但不阻断（arbiter.checkMetricConsistency）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, runTicks, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { arbitrate } from "./arbiter.ts";
import { emptyLore } from "./lore.ts";
import type { SimulationEvent } from "./types.ts";

function baseSession() {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  const e1 = makeEntity("e1", "东境王国", "coast-east", "人类", "kingdom",
    { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
    { "航海": 20 }, { "探索欲": 50 });
  return createSession({
    laws: EARTH_LAWS, regions, entities: [e1],
    config: { seed: 42, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
  });
}

/** 构造 agent mock: 顶层 delta + 事件 changes; 稀有事件返回 null(平静) */
function makeMock(agentOutput: object) {
  return {
    real: true,
    call: async ({ userMessage }) => {
      if (userMessage.includes("实体卡片")) return JSON.stringify(agentOutput);
      return "null";
    },
  };
}

describe("事件 changes 数值并入顶层 delta — 合并去重（改动 2）", () => {
  test("同 key double-claim 不叠加: changes 重复 population 不二次生效", async () => {
    const dup = { decisions: [], events: [{ type: "大旱", description: "人口锐减", changes: [{ entity: "e1", metrics: { population: -1000 } }] }], metric_delta: { population: -1000 } };

    const a = baseSession();
    await runTicks(a, 1, { agentConfig: { llm: makeMock(dup) }, llm: makeMock(dup) });
    // 对照组: changes 无 population 声明（只顶层 -1000）
    const control = { decisions: [], events: [{ type: "大旱", description: "人口锐减", changes: [] }], metric_delta: { population: -1000 } };
    const b = baseSession();
    await runTicks(b, 1, { agentConfig: { llm: makeMock(control) }, llm: makeMock(control) });

    assert.equal(a.entities["e1"].metrics.population, b.entities["e1"].metrics.population,
      "changes 与顶层同 key 不 double-count（两次 run 人口应一致）");
  });

  test("顶层没碰的量由事件 changes 补齐（food 单独 +50）", async () => {
    // changes 声明 food +50, 顶层无 food
    const withClaim = { decisions: [], events: [{ type: "丰收", description: "粮食丰收", changes: [{ entity: "e1", metrics: { food: 50 } }] }], metric_delta: {} };
    const a = baseSession();
    await runTicks(a, 1, { agentConfig: { llm: makeMock(withClaim) }, llm: makeMock(withClaim) });

    const noClaim = { decisions: [], events: [], metric_delta: {} };
    const b = baseSession();
    await runTicks(b, 1, { agentConfig: { llm: makeMock(noClaim) }, llm: makeMock(noClaim) });

    const diff = a.entities["e1"].metrics.food - b.entities["e1"].metrics.food;
    assert.ok(Math.abs(diff - 50) < 1, `changes 补齐 food: 差值应为 ~50, got ${diff}`);
  });
});

describe("arbiter 叙事-数值一致性软检查（改动 2）", () => {
  test("声称超界指标 → 软警告但不阻断, 事件仍 accepted", async () => {
    const session = baseSession();
    const ctx = {
      laws: session.laws,
      config: session.config,
      entities: session.entities,
      lore: session.lore,
      currentTick: 1,
    };
    const ev: SimulationEvent = {
      id: "ev-1", tick: 1, time_label: "tick 1", type: "大灾", participants: ["e1"], region: "coast-east",
      description: "灾难让人口近乎灭绝", changes: [{ entity: "e1", metrics: { population: -99_999_999 } }],
      random: false, source: "agent",
    };
    const res = await arbitrate(ctx, [ev]);
    assert.ok(res.accepted.some((e) => e.id === ev.id), "软检查不阻断, 事件 accepted");
    assert.ok(res.softWarnings.some((w) => w.rule.includes("人口不得低于下限")), "产生人口下限软警告");
  });

  test("合理变化不触发软警告", async () => {
    const session = baseSession();
    const ctx = {
      laws: session.laws,
      config: session.config,
      entities: session.entities,
      lore: session.lore,
      currentTick: 1,
    };
    const ev: SimulationEvent = {
      id: "ev-2", tick: 1, time_label: "tick 1", type: "重建", participants: ["e1"], region: "coast-east",
      description: "人口回升", changes: [{ entity: "e1", metrics: { population: 1000, stability: 5 } }],
      random: false, source: "agent",
    };
    const res = await arbitrate(ctx, [ev]);
    assert.ok(res.accepted.some((e) => e.id === ev.id), "合理变化 accepted");
    assert.ok(!res.softWarnings.some((w) => w.rule.includes("人口不得低于下限") && w.event_id === ev.id), "无人口下限警告");
  });
});

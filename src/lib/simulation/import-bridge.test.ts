// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 3 验收测试 — 从词条导入世界法则（§4 法则来源 2）+ 桥接（§十）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { constraintsToLaws } from "./import-entries.ts";
import { buildBridgePayload, simulationEventToBridge, entityCardToEntry } from "./bridge.ts";
import { makeEntity } from "./engine.ts";
import type { SimulationEvent, SimulationSession } from "./types.ts";

describe("从词条导入世界法则 — §4 法则来源 2", () => {
  test("hard 约束进 rules, soft 约束进 narrative", () => {
    const laws = constraintsToLaws([
      { rule: "起死回生不可能发生", severity: "hard" },
      { rule: "该文明崇尚荣誉决斗", severity: "soft" },
    ]);
    assert.ok(laws.rules.includes("起死回生不可能发生"));
    assert.ok(laws.narrative.includes("该文明崇尚荣誉决斗"));
  });

  test("保留 base 法则, 追加导入", () => {
    const laws = constraintsToLaws([{ rule: "新增规则", severity: "hard" }], {
      id: "base",
      name: "基础世界",
      rules: ["原有规则"],
      narrative: [],
      ontology: [],
      spatial_scale: "类地球",
    });
    assert.ok(laws.rules.includes("原有规则"));
    assert.ok(laws.rules.includes("新增规则"));
    assert.equal(laws.id, "base");
  });
});

describe("桥接到正式世界 — §十", () => {
  function sampleSession(): SimulationSession {
    return {
      id: "s", world_id: "w", current_tick: 3,
      laws: { id: "e", name: "真实", physics: { food_per_capita: 1, pop_growth_base: 0.02, military_per_pop: 0.002, military_tech_mult: 0.5, stability_recovery: 0.02, stability_decay: 0.05, overpopulation_pressure: 0.05 }, rules: [], narrative: [], ontology: [], spatial_scale: "" },
      regions: {}, entities: { e1: makeEntity("e1", "东境王国", "p", "人类", "kingdom", {}, {}, {}) },
      registry: { dims: {}, history: [], frozen: [] }, lore: { facts: [], max_layer: 0 },
      config: { randomness: 0.3, surprise: 0.3, rigor: 0.7, granularity: "macro", yearsPerTick: 10, autoJump: true, maxTicks: 100, budget: { perTickGlobal: 100000, perEntity: 4000, hotspotMultiplier: 4 }, infoDelay: 2, maxEntities: null, seed: 1 },
      events: [], decrees: [], archive: [], started_at: 0,
    };
  }

  test("buildBridgePayload 生成事件 + 词条", () => {
    const session = sampleSession();
    const ev: SimulationEvent = {
      id: "e1", tick: 2, time_label: "t2", type: "war", participants: ["e1"], region: "p",
      description: "东境王国开战", changes: [], random: false, source: "engine",
    };
    const payload = buildBridgePayload(session, [ev], { includeEntities: true });
    assert.equal(payload.events.length, 1);
    assert.equal(payload.entries.length, 1);
    assert.deepEqual(payload.selectedTicks, [2, 2]);
    assert.equal(payload.events[0].summary, "东境王国开战");
  });

  test("simulationEventToBridge 生成可提交事件", () => {
    const session = sampleSession();
    const ev: SimulationEvent = {
      id: "e2", tick: 2, time_label: "t2", type: "conquest", participants: ["e1"], region: "p",
      description: "征服", changes: [], random: false, source: "engine",
    };
    const bridged = simulationEventToBridge(ev, session, { timelineId: "tl" });
    assert.equal(bridged.timeline_id, "tl");
    assert.ok(bridged.time_point.startsWith("000-"));
  });

  test("entityCardToEntry 政体 → organization", () => {
    const session = sampleSession();
    const entry = entityCardToEntry(session.entities["e1"]);
    assert.equal(entry.entry_type, "organization");
  });
});


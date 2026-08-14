// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 0/1 验收测试 — 干预指令判定（§3.7/§5.5）：
 * 历史法则 + 历史惯性 + 面向过去的未来兼容；判定结果谱系。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS, MAGIC_LAWS } from "./physics.ts";
import { emptyLore } from "./lore.ts";
import { makeEntity } from "./engine.ts";
import { adjudicateDecree, naturalizeDecree, strengthWeight, decreeToEvent } from "./decree.ts";
import type { Decree, EntityCard, SimulationEvent } from "./types.ts";

function makeDecree(overrides: Partial<Decree> = {}): Decree {
  return {
    id: "d1",
    direction: "future",
    target_tick: 5,
    target: { type: "entity", id: "e1" },
    intent: "东境王国将统一整个大陆",
    strength: "command",
    ...overrides,
  };
}

function makeCtx(entities: Record<string, EntityCard> = {}, events: SimulationEvent[] = [], currentTick = 5) {
  return {
    laws: EARTH_LAWS,
    lore: emptyLore(),
    entities,
    events,
    currentTick,
  };
}

function sampleEntity(id: string): EntityCard {
  return makeEntity(id, "东境王国", "plains-mid", "人类", "kingdom",
    { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
    { "农业": 20 }, { "探索欲": 50 });
}

describe("干预指令判定 — 历史法则", () => {
  test("严重违反世界法则 → rejected", async () => {
    const ctx = makeCtx({ e1: sampleEntity("e1") });
    // 真实世界: 起死回生不可能发生
    const decree = makeDecree({ intent: "复活已死的国王，起死回生" });
    const adj = await adjudicateDecree(ctx, decree);
    assert.equal(adj.verdict, "rejected");
    assert.equal(adj.lawScore < 0.5, true);
  });

  test("符合法则 + 高惯性 → accepted", async () => {
    const ctx = makeCtx({ e1: sampleEntity("e1") });
    const decree = makeDecree({ intent: "东境王国巩固边境防御" });
    const adj = await adjudicateDecree(ctx, decree);
    assert.equal(adj.verdict, "accepted");
  });
});

describe("干预指令判定 — 历史惯性", () => {
  test("衰败实体被强加巨变 → adjusted（惯性低）", async () => {
    const weak = sampleEntity("e1");
    weak.metrics.stability = 10;
    weak.metrics.legitimacy = 10;
    const ctx = makeCtx({ e1: weak });
    const decree = makeDecree({ intent: "东境王国一夜之间统一世界，建立万世帝国" });
    const adj = await adjudicateDecree(ctx, decree);
    assert.equal(adj.verdict, "adjusted");
  });
});

describe("干预指令判定 — 面向过去", () => {
  test("细化未来 tick → rejected（不能预支未来）", async () => {
    const ctx = makeCtx({}, [], 10);
    const decree = makeDecree({ direction: "past", target_tick: 12, intent: "第三纪元有一位预言者" });
    const adj = await adjudicateDecree(ctx, decree);
    assert.equal(adj.verdict, "rejected");
    assert.equal(adj.futureCompat, false);
  });

  test("细化过去且早于未来事件 → accepted", async () => {
    const futureEvent: SimulationEvent = {
      id: "evt-10", tick: 10, time_label: "tick 10", type: "war", participants: [], region: "",
      description: "未来战争", changes: [], random: false, source: "engine",
    };
    const ctx = makeCtx({}, [futureEvent], 10);
    const decree = makeDecree({ direction: "past", target_tick: 3, intent: "第三纪元曾有一位贤者改革" });
    const adj = await adjudicateDecree(ctx, decree);
    assert.equal(adj.verdict, "accepted");
    assert.equal(adj.futureCompat, true);
  });
});

describe("干预指令判定 — 辅助", () => {
  test("强度权重: command > lean > nudge", () => {
    assert.ok(strengthWeight("command") > strengthWeight("lean"));
    assert.ok(strengthWeight("lean") > strengthWeight("nudge"));
  });

  test("naturalizeDecree 生成自然化的外部力量描述", () => {
    const d = makeDecree({ strength: "command" });
    const text = naturalizeDecree(d);
    assert.ok(text.includes("天启") || text.includes("天意"), "强指令 → 天启");
  });

  test("decreeToEvent 生成带天意的事件", () => {
    const d = makeDecree();
    const ev = decreeToEvent(d, { decree: d, verdict: "adjusted", note: "打折", lawScore: 0.6, inertiaScore: 0.3, futureCompat: true }, 5);
    assert.equal(ev.source, "decree");
    assert.ok(ev.description.includes("天意"));
  });
});

// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 2 验收测试 — 反事实分叉（Phase 2）+ 桥接到正式世界（§十）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, runTicks, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { forkSession, restoreFromFork, compareBranches } from "./branch.ts";
import { simulationEventToBridge, entityCardToEntry, buildBridgePayload, defaultTickToTimePoint } from "./bridge.ts";
import type { SimulationEvent } from "./types.ts";

function sampleSession(seed = 10) {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  const e = makeEntity("e1", "东境王国", "plains-mid", "人类", "kingdom",
    { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
    { "农业": 20 }, { "探索欲": 50 });
  return createSession({
    laws: EARTH_LAWS, regions, entities: [e],
    config: { seed, randomness: 0.2, surprise: 0.2, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
  });
}

describe("反事实分叉 — Phase 2", () => {
  test("fork 存档深拷贝, 分支改动不影响原始", async () => {
    const session = sampleSession();
    await runTicks(session, 5);
    const snapshot = forkSession(session, "未发生战争的分支", "fork-1");
    assert.equal(snapshot.baseTick, 5);
    assert.equal(snapshot.label, "未发生战争的分支");

    // 从分叉重建并推演（改参数: randomness=0 减少黑天鹅）
    const fork = restoreFromFork(snapshot, { randomness: 0, seed: 999 });
    await runTicks(fork, 5);
    // 原始会话不受影响（仍 5 tick）
    assert.equal(session.current_tick, 5);
    assert.equal(fork.current_tick, 10);
  });

  test("compareBranches 检测分叉点与实体差异", async () => {
    const session = sampleSession();
    await runTicks(session, 5);
    const snapshot = forkSession(session, "分叉", "fork-2");

    // 分叉后走不同参数 → 产生差异
    const fork = restoreFromFork(snapshot, { randomness: 0.9, seed: 42 }); // 高随机性 → 更多黑天鹅
    await runTicks(fork, 5);

    const diff = compareBranches(session, fork);
    assert.ok(diff.eventsDivergedAt !== null || diff.entityDiffs.length > 0, "分叉后应有差异");
    assert.ok(diff.summary.length > 0);
  });

  test("相同参数重放 → 无分叉差异", async () => {
    const session = sampleSession(7);
    await runTicks(session, 5);
    const snapshot = forkSession(session, "重放", "fork-3");
    const fork = restoreFromFork(snapshot, {}); // 相同配置
    // 原会话和分叉都继续跑到 10 tick（同一 rng 序列）
    await runTicks(session, 5);
    await runTicks(fork, 5);
    const diff = compareBranches(session, fork);
    // 相同 seed + 相同配置 → 相同演化
    assert.equal(diff.eventsDivergedAt, null, "相同参数应无分叉");
    assert.equal(diff.summary.includes("尚未分叉"), true);
  });
});

describe("桥接到正式世界 — §十", () => {
  test("simulationEventToBridge 生成可提交事件", () => {
    const session = sampleSession();
    const ev: SimulationEvent = {
      id: "evt-1", tick: 3, time_label: "tick 3", type: "war",
      participants: ["e1"], region: "plains-mid", description: "东境王国与北境交战",
      changes: [{ entity: "e1", metrics: { stability: -10 } }], random: false, source: "engine",
    };
    const bridged = simulationEventToBridge(ev, session, { timelineId: "tl-1" });
    assert.equal(bridged.timeline_id, "tl-1");
    assert.equal(bridged.time_point, defaultTickToTimePoint(3));
    assert.ok(bridged.summary.includes("交战"));
    assert.equal(bridged.linked_entries[0].entry_id, "e1");
    // 稳定性变化 → relationship_changes（状态变化）
    assert.ok(bridged.relationship_changes.some((rc) => rc.change_type === "add"));
  });

  test("entityCardToEntry 政体 → organization", () => {
    const session = sampleSession();
    const entry = entityCardToEntry(session.entities["e1"]);
    assert.equal(entry.entry_type, "organization");
    assert.ok(entry.body.includes("东境王国"));
    assert.equal(entry.properties.simulation_origin, true);
  });

  test("buildBridgePayload 批量生成", () => {
    const session = sampleSession();
    const events = [
      { id: "a", tick: 1, time_label: "t1", type: "war", participants: ["e1"], region: "r", description: "战争", changes: [], random: false, source: "engine" },
      { id: "b", tick: 3, time_label: "t3", type: "founding", participants: ["e1"], region: "r", description: "建国", changes: [], random: false, source: "engine" },
    ];
    const payload = buildBridgePayload(session, events, { includeEntities: true });
    assert.equal(payload.events.length, 2);
    assert.equal(payload.entries.length, 1);
    assert.deepEqual(payload.selectedTicks, [1, 3]);
    assert.ok(payload.note.includes("2 个事件"));
  });
});

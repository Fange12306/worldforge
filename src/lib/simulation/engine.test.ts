// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 0 验收测试 — 推演调度器端到端。
 *
 * 验收标准（SIMULATION_DESIGN.md §十一 Phase 0）：
 * - 手写几个实体卡片，跑 10 tick，验证法则派生的物理量联动不失控。
 * - 已注册维度实际值不超过潜力上限。
 * - 背景规则库细化锁定逻辑正确。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS, MAGIC_LAWS, QI_LAWS } from "./physics.ts";
import { createSession, runTicks, makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources, deriveTechPotential } from "./physics.ts";
import type { WorldLaws } from "./types.ts";

function buildWorld(laws: WorldLaws, seed: number, species = "人类") {
  const regions = defaultRegions();
  // 用传入法则重新推导资源
  for (const [id, r] of Object.entries(regions)) {
    regions[id] = { ...r, resources: deriveRegionResources(r.biome, laws) };
  }

  // 三个初始实体分布在不同的生物群系
  const regionIds = ["coast-east", "plains-mid", "mountains-north", "desert-south"];
  const entities = regionIds.map((rid, i) => {
    const region = regions[rid];
    const pot = deriveTechPotential(region.resources, laws);
    const tech: Record<string, number> = {};
    for (const [dim, p] of Object.entries(pot)) tech[dim] = Math.min(8, p);
    return makeEntity(
      `e-${i}`,
      `${species}${i + 1}号-${region.name}`,
      rid,
      species,
      i % 2 === 0 ? "tribe" : "kingdom",
      { population: 100_000 + i * 50_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
      tech,
      { "探索欲": 50, "组织倾向": 50, "信仰强度": 40 },
    );
  });

  return createSession({ laws, regions, entities, config: { seed, randomness: 0.2, surprise: 0.2, rigor: 0.8 } });
}

describe("推演调度器 — 端到端 10 tick", () => {
  test("真实世界: 人口/军力/维度稳定演化, 维度不超潜力", async () => {
    const session = buildWorld(EARTH_LAWS, 1);
    const result = await runTicks(session, 10);

    assert.equal(result.ticks_run, 10);
    assert.equal(session.current_tick, 10);
    // 事件日志追加（每 tick 有例行事件）
    assert.ok(session.events.length >= 10);

    // 每个实体的维度值 ≤ 潜力上限
    for (const e of Object.values(session.entities)) {
      const region = session.regions[e.geography.region];
      const pot = deriveTechPotential(region.resources, EARTH_LAWS);
      for (const [dim, p] of Object.entries(pot)) {
        const v = e.tech[dim] ?? 0;
        assert.ok(v <= p + 0.5, `${e.name}.${dim}: ${v} > potential ${p}`);
      }
      // 指标合理
      assert.ok(e.metrics.population > 0);
      assert.ok(e.metrics.military > 0);
      assert.ok(e.metrics.stability >= 0 && e.metrics.stability <= 100);
      assert.ok(e.metrics.legitimacy >= 0 && e.metrics.legitimacy <= 100);
    }
  });

  test("魔法世界: 出现 魔力掌控 维度并演化", async () => {
    const session = buildWorld(MAGIC_LAWS, 2);
    await runTicks(session, 10);
    // 注册表应包含魔力掌控（由物理同步 + 升格）
    const hasMagic = Object.values(session.entities).some((e) => "魔力掌控" in e.tech);
    assert.ok(hasMagic, "魔法世界应涌现魔力掌控维度");
    // 每个实体维度不超潜力
    for (const e of Object.values(session.entities)) {
      const region = session.regions[e.geography.region];
      const pot = deriveTechPotential(region.resources, MAGIC_LAWS);
      for (const [dim, p] of Object.entries(pot)) {
        assert.ok((e.tech[dim] ?? 0) <= p + 0.5, `${dim}: ${e.tech[dim]} > ${p}`);
      }
    }
  });

  test("真气世界: 出现 修为 维度", async () => {
    const session = buildWorld(QI_LAWS, 3);
    await runTicks(session, 10);
    const hasQi = Object.values(session.entities).some((e) => "修为" in e.tech);
    assert.ok(hasQi, "真气世界应涌现修为维度");
  });

  test("事件日志追加不可改写（历史即锁定）", async () => {
    const session = buildWorld(EARTH_LAWS, 4);
    await runTicks(session, 5);
    const eventsSnapshot = session.events.length;
    const historyBefore = session.lore.facts.filter((f) => f.source === "history");
    assert.ok(historyBefore.length >= 5, "每 tick 至少锁定 1 条历史");
    const contentBefore = new Map(historyBefore.map((f) => [f.id, f.content]));

    // 追加 5 tick：事件数增加, 新历史事实锁定, 已锁定事实内容不可改写
    await runTicks(session, 5);
    assert.ok(session.events.length >= eventsSnapshot + 5, "追加 tick 后事件数应增加");
    const historyAfter = session.lore.facts.filter((f) => f.source === "history");
    assert.ok(historyAfter.length > historyBefore.length, "新增历史事实已锁定");
    for (const [id, content] of contentBefore) {
      const fact = session.lore.facts.find((f) => f.id === id);
      assert.ok(fact, `已锁定历史事实 ${id} 应保留`);
      assert.equal(fact.content, content, `已锁定历史 ${id} 内容不可改写`);
    }
  });

  test("随机性 seed 可复现", async () => {
    const a = buildWorld(EARTH_LAWS, 99);
    const b = buildWorld(EARTH_LAWS, 99);
    await runTicks(a, 10);
    await runTicks(b, 10);
    // 相同 seed → 相同演化（确定性）
    const metricsA = Object.values(a.entities).map((e) => JSON.stringify(e.metrics));
    const metricsB = Object.values(b.entities).map((e) => JSON.stringify(e.metrics));
    assert.deepEqual(metricsA, metricsB);
  });

  test("人口增长受马尔萨斯约束（不会失控）", async () => {
    const session = buildWorld(EARTH_LAWS, 5);
    await runTicks(session, 10);
    for (const e of Object.values(session.entities)) {
      // 100k 起步, 10 tick 后不应超过 10x（合理增长范围）
      assert.ok(e.metrics.population < 1_500_000, `${e.name} 人口 ${e.metrics.population} 失控?`);
      assert.ok(e.metrics.population > 0);
    }
  });

  test("实体 history 环形缓冲 cap 20 且 tick 升序（改动 3）", async () => {
    const session = buildWorld(EARTH_LAWS, 7);
    await runTicks(session, 25);
    for (const e of Object.values(session.entities)) {
      const h = e.history ?? [];
      assert.ok(h.length <= 20, `${e.name} history 超出 cap`);
      assert.equal(h.length, 20, `${e.name} 跑 25 tick 后 history 应为 20（环形）`);
      const ticks = h.map((s) => s.tick);
      assert.deepEqual([...ticks].sort((a, b) => a - b), ticks, `${e.name} history tick 升序`);
      // 每个快照都带 metrics
      assert.ok(h.every((s) => typeof s.metrics.population === "number"), "快照含 population");
    }
  });
});

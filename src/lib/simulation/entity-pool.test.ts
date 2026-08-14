// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 0/1 验收测试 — 动态 agent 池（§5.4）：
 * 分裂 / 吞并 / 灭亡 / 复兴 / 分化。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeEntity } from "./engine.ts";
import { splitEntity, conquerEntity, collapseEntity, reviveEntity, divergeEntity, clusterMicroEntities } from "./entity-pool.ts";
import type { SimulationEvent } from "./types.ts";

function sampleEntity(id: string, name: string, population = 100_000, military = 500): ReturnType<typeof makeEntity> {
  return makeEntity(id, name, "plains-mid", "人类", "kingdom",
    { population, food: 500, military, legitimacy: 60, stability: 60 },
    { "农业": 20, "制度": 15 }, { "探索欲": 50, "组织倾向": 50 },
  );
}

function event(type: string, participants: string[], id = `evt-${type}-${Date.now()}`): SimulationEvent {
  return {
    id, tick: 5, time_label: "tick 5", type: type as never, participants, region: "plains-mid",
    description: `${type} 发生`, changes: [], random: false, source: "engine",
  };
}

describe("动态 agent 池 — 分裂", () => {
  test("分裂派生子实体, 父实体让渡部分指标", () => {
    const parent = sampleEntity("p", "东境王国");
    const r = splitEntity(parent, event("secession", ["p"]), "东境独立部", 5, { population: 0.4, military: 0.3 });

    assert.equal(r.child.parent, "p", "子实体 parent 追溯父 id");
    assert.ok(r.child.metrics.population < parent.metrics.population, "父实体让渡人口");
    assert.equal(r.child.metrics.population, Math.round(parent.metrics.population * 0.4), "子实体获得 40% 人口");
    assert.equal(r.child.active_level, "hotspot", "新分裂实体是热点");
    assert.ok(r.child.id.startsWith("child-"), "子实体 id 标记");
  });
});

describe("动态 agent 池 — 吞并", () => {
  test("吞并者吸收人口, 被吞者进 archive", () => {
    const conqueror = sampleEntity("c", "西境帝国", 200_000, 1000);
    const conquered = sampleEntity("q", "南蛮部落", 80_000, 300);
    const r = conquerEntity(conqueror, conquered, event("conquest", ["c", "q"]), 5);

    assert.ok(r.conqueror.metrics.population > conqueror.metrics.population, "吞并者吸收人口");
    assert.equal(r.conquered.status, "extinct", "被吞者灭绝");
    assert.equal(r.archive.reason.includes("吞并"), true, "档案记录吞并原因");
    assert.equal(r.conqueror.geography.neighbors.includes("q"), false, "吞并后邻接更新");
  });
});

describe("动态 agent 池 — 灭亡", () => {
  test("灭亡冻结进 archive, 不删除", () => {
    const e = sampleEntity("d", "衰亡城邦");
    const archive = collapseEntity(e, event("collapse", ["d"]), 5);
    assert.equal(archive.entity.status, "extinct");
    assert.equal(archive.reason, "collapse 发生");
    // 实体卡片仍保留（可在 archive 里考古）
    assert.equal(archive.entity.id, "d");
  });
});

describe("动态 agent 池 — 复兴", () => {
  test("从 archive 复兴, 指标重置为脆弱初期", () => {
    const original = sampleEntity("r", "古文明", 500_000, 2000);
    const archive = collapseEntity(original, event("collapse", ["r"]), 5);
    const revived = reviveEntity(archive, "古文明复兴", 100);
    assert.equal(revived.status, "active");
    assert.ok(revived.metrics.population < original.metrics.population, "复兴初期人口少");
    assert.equal(revived.parent, "r", "复兴实体追溯原文明");
    assert.equal(revived.active_level, "hotspot");
  });
});

describe("动态 agent 池 — 分化", () => {
  test("文化分裂派生子实体, 继承部分 identity 并改变文化", () => {
    const parent = sampleEntity("p2", "统一信仰国");
    const r = divergeEntity(parent, "异端教团", { religion: "异端信仰" }, 5);
    assert.equal(r.child.identity.religion, "异端信仰", "子实体继承分化信仰");
    assert.equal(r.child.parent, "p2");
    assert.equal(r.child.active_level, "hotspot");
  });
});

describe("动态 agent 池 — 长尾聚合", () => {
  test("同区域多个稳定微邦聚合为簇", () => {
    const micros = ["m1", "m2", "m3", "m4"].map((id) => sampleEntity(id, `${id}部落`, 5_000, 50));
    const clusters = clusterMicroEntities(micros, 3);
    assert.equal(clusters.length, 1, "4 个同区域微邦聚合成 1 簇");
    assert.equal(clusters[0].members.length, 4);
    assert.equal(clusters[0].representative.active_level, "longtail");
  });

  test("不足阈值的微邦不聚合", () => {
    const micros = ["a", "b"].map((id) => sampleEntity(id, `${id}部落`, 5_000, 50));
    const clusters = clusterMicroEntities(micros, 3);
    assert.equal(clusters.length, 0);
  });
});

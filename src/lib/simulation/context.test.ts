// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 1 验收测试 — 信息传播延迟（§5.1）+ 注意力分层（§6）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, runTicks, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import {
  buildEntityKnowledge,
  computeActiveScore,
  classifyAttention,
  entityTokenBudget,
  buildAgentInput,
} from "./context.ts";
import type { EntityCard, SimulationEvent } from "./types.ts";

function sampleSession(infoDelay = 2) {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  const e1 = makeEntity("e1", "东境王国", "coast-east", "人类", "kingdom",
    { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
    { "航海": 20 }, { "探索欲": 50 });
  const e2 = makeEntity("e2", "西境部落", "plains-mid", "人类", "tribe",
    { population: 50_000, food: 500, military: 200, legitimacy: 50, stability: 50 },
    { "农业": 15 }, { "探索欲": 40 });
  e1.geography.neighbors = ["e2"];
  e2.geography.neighbors = ["e1"];
  return createSession({
    laws: EARTH_LAWS, regions, entities: [e1, e2],
    config: { infoDelay, seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
  });
}

describe("信息传播延迟 — §5.1", () => {
  test("自身历史始终完整注入（不受延迟影响）", async () => {
    const session = sampleSession(5);
    // 手动制造一些自身事件
    const ev: SimulationEvent = {
      id: "own-1", tick: 1, time_label: "tick 1", type: "war", participants: ["e1"], region: "coast-east",
      description: "东境王国的内部冲突", changes: [], random: false, source: "engine",
    };
    session.events.push(ev);
    await runTicks(session, 2);
    const knowledge = buildEntityKnowledge(session, session.entities["e1"]);
    // 自身事件在 knowledge.ownHistory 中（即使 infoDelay=5 远大于当前 tick 差）
    assert.ok(knowledge.ownHistory.some((e) => e.id === "own-1"), "自身历史完整注入");
  });

  test("全球事件有延迟, 邻接事件近实时", () => {
    const session = sampleSession(2);
    session.entities["e2"].metrics.stability = 10; // e2 动荡
    // 制造两个事件：一个较老的全球性事件(tick1), 一个较新的邻接事件(tick4)
    const oldGlobal: SimulationEvent = {
      id: "global-1", tick: 1, time_label: "tick 1", type: "边境大战", participants: ["e2"], region: "plains-mid",
      description: "西境部落的战争", changes: [], random: false, source: "engine", major: true,
    };
    const recentNeighbor: SimulationEvent = {
      id: "neighbor-1", tick: 4, time_label: "tick 4", type: "边境大战", participants: ["e2"], region: "plains-mid",
      description: "西境部落的最新动向", changes: [], random: false, source: "engine",
    };
    session.events.push(oldGlobal, recentNeighbor);
    // 当前 tick = 5, infoDelay=2 → 全球事件 tick<=3 可见
    session.current_tick = 5;
    const knowledge = buildEntityKnowledge(session, session.entities["e1"]);
    // 较老的全局事件（tick1 <= 5-2=3）→ 全球新闻可见
    assert.ok(knowledge.globalNews.some((e) => e.id === "global-1"), "延迟窗口内全球事件可见");
    // 较新的邻接事件（tick4, 近2 tick内）→ 邻接新闻可见
    assert.ok(knowledge.neighborNews.some((n) => n.event.id === "neighbor-1"), "邻接事件近实时可见");
    // 较老的邻接事件(tick1)超出近2 tick窗口 → 不进邻接新闻
    assert.ok(!knowledge.neighborNews.some((n) => n.event.id === "global-1"), "太老的邻接事件不进近实时");
  });

  test("major 语义标志决定全球广播, 非 major 进远方传闻（LLM 判断, 不靠类型枚举）", () => {
    const session = sampleSession(2);
    const war: SimulationEvent = {
      id: "war-1", tick: 1, time_label: "tick 1", type: "边境大战", participants: ["e2"], region: "plains-mid",
      description: "战争", changes: [], random: false, source: "engine", major: true,
    };
    const cultural: SimulationEvent = {
      id: "cult-1", tick: 1, time_label: "tick 1", type: "丰收庆典", participants: ["e2"], region: "plains-mid",
      description: "文化事件", changes: [], random: false, source: "engine", major: false,
    };
    session.events.push(war, cultural);
    session.current_tick = 6;
    const knowledge = buildEntityKnowledge(session, session.entities["e1"]);
    assert.ok(knowledge.globalNews.some((e) => e.id === "war-1"), "major 事件进全球新闻");
    assert.ok(!knowledge.globalNews.some((e) => e.id === "cult-1"), "非 major 事件不进全球新闻");
    assert.ok(knowledge.distantRumors.some((e) => e.id === "cult-1"), "非 major 进远方传闻");
  });
});

describe("注意力分层 — §6", () => {
  test("动荡实体 → hotspot, 稳定实体 → longtail", async () => {
    const session = sampleSession();
    const unstable = session.entities["e2"];
    unstable.metrics.stability = 5;
    unstable.metrics.legitimacy = 5;
    unstable.relations = [{ target: "e1", stance: "war" }];

    const scoreHot = computeActiveScore(unstable, session);
    const attHot = classifyAttention(scoreHot);
    assert.equal(attHot.level, "hotspot");
    assert.equal(attHot.tokenMultiplier, 4);

    const stable = session.entities["e1"];
    stable.metrics.stability = 90;
    stable.metrics.legitimacy = 90;
    const scoreStable = computeActiveScore(stable, session);
    const attStable = classifyAttention(scoreStable);
    assert.ok(["regular", "longtail"].includes(attStable.level), `稳定实体不应是 hotspot (got ${attStable.level})`);
  });

  test("token 预算随档位变化", () => {
    const session = sampleSession();
    const budget = session.config.budget.perEntity;
    assert.equal(entityTokenBudget(session.config, { level: "hotspot", activeScore: 0.8, tokenMultiplier: 4 }), budget * 4);
    assert.equal(entityTokenBudget(session.config, { level: "regular", activeScore: 0.3, tokenMultiplier: 1 }), budget);
    assert.equal(entityTokenBudget(session.config, { level: "longtail", activeScore: 0.1, tokenMultiplier: 0.2 }), Math.round(budget * 0.2));
  });
});

describe("agent 输入装配 — §5.2", () => {
  test("生成包含世界模型 + 实体卡片 + 事件的输入", () => {
    const session = sampleSession();
    const entity = session.entities["e1"];
    const knowledge = buildEntityKnowledge(session, entity);
    const attention = classifyAttention(computeActiveScore(entity, session));
    const input = buildAgentInput(session, entity, knowledge, attention);

    assert.ok(input.system.includes(session.laws.name), "system 含世界模型");
    assert.ok(input.user.includes(entity.name), "user 含实体卡片");
    assert.ok(input.user.includes("输出格式契约") || input.system.includes("JSON"), "含输出契约");
    assert.ok(input.user.includes("待解决的未决议题"), "含未决议题");
  });

  test("实体有 history 时注入「近期走势」块（改动 3）", async () => {
    const session = sampleSession();
    await runTicks(session, 6, { llm: undefined });
    const entity = session.entities["e1"];
    assert.ok((entity.history ?? []).length >= 2, "跑 6 tick 后有至少 2 个快照");
    const knowledge = buildEntityKnowledge(session, entity);
    const attention = classifyAttention(computeActiveScore(entity, session));
    const input = buildAgentInput(session, entity, knowledge, attention);
    assert.ok(input.user.includes("近期走势"), "user 含近期走势块");
    assert.ok(input.user.includes("人口"), "走势含人口趋势行");
    assert.ok(input.user.includes("上升") || input.user.includes("下降") || input.user.includes("持平"), "走势含趋势方向词");
  });

  test("海洋邻居标注 + 海洋区域相邻陆地（点2）", async () => {
    const session = sampleSession();
    // e1 在 coast-east, 给它加一个海洋邻居 + 一个海洋区域带 borders_land
    session.regions["pacific"] = {
      id: "pacific", name: "太平洋", biome: "ocean", resources: deriveRegionResources("ocean", EARTH_LAWS),
      neighbors: ["coast-east"], layer: 0, refined: false, borders_land: ["coast-east"],
    };
    session.regions["coast-east"].neighbors = [...(session.regions["coast-east"].neighbors ?? []), "pacific"];
    const entity = session.entities["e1"]; // e1 在 coast-east
    const knowledge = buildEntityKnowledge(session, entity);
    const attention = classifyAttention(computeActiveScore(entity, session));
    const input = buildAgentInput(session, entity, knowledge, attention);
    assert.ok(input.user.includes("（海洋）"), "邻接区域标注海洋");
    assert.ok(input.user.includes("太平洋"), "海洋邻居显示名");
  });

  test("区域 shape/position 注入 agent 输入（改动 B）", async () => {
    const session = sampleSession();
    // 给 e1 所在区域加 shape/position
    session.regions["coast-east"].shape = "狭长河谷";
    session.regions["coast-east"].position = "大陆东部海岸";
    const entity = session.entities["e1"];
    const knowledge = buildEntityKnowledge(session, entity);
    const attention = classifyAttention(computeActiveScore(entity, session));
    const input = buildAgentInput(session, entity, knowledge, attention);
    assert.ok(input.user.includes("区域形态"), "user 含区域形态块");
    assert.ok(input.user.includes("狭长河谷"), "注入 shape");
    assert.ok(input.user.includes("大陆东部海岸"), "注入 position");
  });

  test("实体区域 lore 事实注入 agent 输入（改动 4）", async () => {
    const session = sampleSession();
    // 手动锁一条 e1 区域的事实, 模拟"细化即锁定"后的已确定世界
    session.lore.facts.push({
      id: "lore-test-1", axis: "space", layer: 0, scope: "coast-east",
      content: "东境海岸有一座古老的盐场, 是已确定的设定", source: "initial", locked_tick: 0,
    });
    const entity = session.entities["e1"];
    const knowledge = buildEntityKnowledge(session, entity);
    const attention = classifyAttention(computeActiveScore(entity, session));
    const input = buildAgentInput(session, entity, knowledge, attention);
    assert.ok(input.user.includes("世界已确定事实"), "user 含已确定事实块");
    assert.ok(input.user.includes("古老的盐场"), "注入实体区域的事实内容");
  });
});

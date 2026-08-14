// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 0 验收测试 — 维度注册表 + 背景规则库（细化即锁定 / 历史即锁定 / 细化过去）。
 *
 * 验收标准（SIMULATION_DESIGN.md §十一 Phase 0）：
 * - 背景规则库的细化锁定逻辑正确（锁定后无法回溯修改、只能继续细化）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { emptyRegistry, tryRegisterDimension, promotionScore, signalsFromLaws, syncTechDimensions, retireInactiveDimensions } from "./registry.ts";
import { emptyLore, addLoreFact, refineSpace, refinePast, tryModifyFact, canRefineFurther, lockHistoricalEvent, loreFactsFor } from "./lore.ts";
import { EARTH_LAWS, MAGIC_LAWS, deriveRegionResources, deriveTechPotential } from "./physics.ts";
import type { SimulationEvent } from "./types.ts";

// ── 维度注册表 ────────────────────────────────────────

describe("维度注册表 — 升格判定", () => {
  test("高信号注册, 低信号不注册（阈值）", () => {
    const reg = emptyRegistry();
    const high = tryRegisterDimension(reg, {
      dim: "航海", kind: "tech", frequency: 0.9, consequence: 0.8, lawConsistency: 1, potential: 85,
    }, 1);
    assert.equal(high.registered, true);
    assert.ok(reg.dims["航海"]);

    const low = tryRegisterDimension(reg, {
      dim: "观星", kind: "tech", frequency: 0.1, consequence: 0.05, lawConsistency: 0.3, potential: 20,
    }, 1);
    assert.equal(low.registered, false);
    assert.ok(!reg.dims["观星"]);
  });

  test("promotionScore = 频率×w + 后果×w + 法则×w", () => {
    const score = promotionScore({ dim: "x", kind: "tech", frequency: 1, consequence: 0, lawConsistency: 0 }, {
      threshold: 0.35, freqWeight: 0.4, consWeight: 0.35, lawWeight: 0.25,
    });
    assert.ok(Math.abs(score - 0.4) < 1e-9);
  });

  test("由世界法则派生信号：真实/魔法/真气维度不同", () => {
    const earthSignals = signalsFromLaws(EARTH_LAWS, deriveTechPotential(deriveRegionResources("plains", EARTH_LAWS), EARTH_LAWS));
    const magicSignals = signalsFromLaws(MAGIC_LAWS, deriveTechPotential(deriveRegionResources("forest", MAGIC_LAWS), MAGIC_LAWS));
    assert.ok(!earthSignals.some((s) => s.dim === "魔力掌控"));
    assert.ok(magicSignals.some((s) => s.dim === "魔力掌控"));
    assert.ok(magicSignals.some((s) => s.dim === "对力量之源的敬畏" && s.kind === "value"));
  });

  test("维度可消退（retire）", () => {
    const reg = emptyRegistry();
    syncTechDimensions(reg, { "航海": 80 }, 1);
    assert.ok("航海" in reg.dims);
    const retired = retireInactiveDimensions(reg, 30, { inactiveTicks: 20 });
    assert.ok(retired.includes("航海"));
    assert.ok(!("航海" in reg.dims));
  });
});

// ── 背景规则库：细化即锁定（空间向）─────────────────

describe("背景规则库 — 细化即锁定", () => {
  test("初始全景写入顶层背景规则", () => {
    const lore = emptyLore();
    addLoreFact(lore, { axis: "space", layer: 0, scope: "西环大陆", content: "大陆", source: "initial", locked_tick: 0 });
    assert.equal(lore.facts.length, 1);
    assert.equal(lore.facts[0].layer, 0);
    assert.equal(lore.max_layer, 0);
  });

  test("细化基于父层级, 一旦确定不可再细化同一子区域", () => {
    const lore = emptyLore();
    addLoreFact(lore, { axis: "space", layer: 0, scope: "西环大陆", content: "大陆", source: "initial", locked_tick: 0 });

    const r1 = refineSpace(lore, "西环大陆", "西环大陆/东南部", "山地, 铁矿丰富", 5);
    assert.equal(r1.verdict, "accepted");
    assert.equal(r1.fact!.layer, 1);

    // 同一子区域再细化 → 拒绝（已锁定）
    const r2 = refineSpace(lore, "西环大陆", "西环大陆/东南部", "平原", 6);
    assert.equal(r2.verdict, "already-refined");
  });

  test("父层级不存在时不能细化", () => {
    const lore = emptyLore();
    const r = refineSpace(lore, "不存在的大陆", "不存在的大陆/子区", "内容", 1);
    assert.equal(r.verdict, "conflict");
  });

  test("已锁定事实不可回溯修改", () => {
    const lore = emptyLore();
    const fact = addLoreFact(lore, { axis: "space", layer: 0, scope: "西环大陆", content: "大陆", source: "initial", locked_tick: 0 });
    const res = tryModifyFact(lore, fact.id, "改成别的");
    assert.equal(res.allowed, false);
    assert.match(res.reason, /已锁定|不可回溯/);
  });

  test("canRefineFurther: 只能往更深层细化", () => {
    const lore = emptyLore();
    // 同一 scope "西环大陆/东南部" 已有 layer 1 的细化
    addLoreFact(lore, { axis: "space", layer: 1, scope: "西环大陆/东南部", content: "山地", source: "refinement", locked_tick: 5 });
    assert.equal(canRefineFurther(lore, "西环大陆/东南部", 2), true);
    assert.equal(canRefineFurther(lore, "西环大陆/东南部", 1), false); // 已细化到 layer1, 不能同层再细化
  });
});

// ── 背景规则库：历史即锁定 + 细化过去 ─────────────────

describe("背景规则库 — 历史即锁定 + 细化过去", () => {
  function sampleEvent(tick: number): SimulationEvent {
    return {
      id: `evt-${tick}`, tick, time_label: `tick ${tick}`, type: "war",
      participants: ["a"], region: "r", description: "战争爆发", changes: [], random: false, source: "engine",
    };
  }

  test("历史事件锁定, 不可改写", () => {
    const lore = emptyLore();
    const ev = sampleEvent(5);
    lockHistoricalEvent(lore, ev);
    assert.equal(lore.facts.length, 1);
    assert.equal(lore.facts[0].source, "history");
    assert.equal(lore.facts[0].axis, "time");
    assert.equal(lore.facts[0].locked_tick, 5);
    const res = tryModifyFact(lore, lore.facts[0].id, "改写历史");
    assert.equal(res.allowed, false);
  });

  test("细化过去: 只能细化已发生的时代, 不得细化未来", () => {
    const lore = emptyLore();
    lockHistoricalEvent(lore, sampleEvent(10)); // 未来在 tick 10 已有事件

    // 细化 tick 3（早于未来 tick 10）→ 可接受（可填充的过去）
    const ok = refinePast(lore, 3, 10, "第三纪元", "曾有一位预言者", "用户细化");
    assert.equal(ok.verdict, "accepted");
    assert.equal(ok.fact!.source, "past_refinement");

    // 细化 tick 8（早于未来 tick 10, 仍是已发生过去）→ 可接受
    const mid = refinePast(lore, 8, 10, "第八纪元", "一位贤者开始改革", "用户细化");
    assert.equal(mid.verdict, "accepted");

    // 细化未来 tick 12（> 当前 tick 10）→ 拒绝（尚未发生, 不能预支未来）
    const future = refinePast(lore, 12, 10, "第十二纪元", "未来的事", "用户细化");
    assert.equal(future.verdict, "conflict");
  });

  test("细化过去同一 scope 不可重复", () => {
    const lore = emptyLore();
    const r1 = refinePast(lore, 3, 10, "第三纪元", "第一位预言者", "");
    assert.equal(r1.verdict, "accepted");
    const r2 = refinePast(lore, 3, 10, "第三纪元", "另一个预言者", "");
    assert.equal(r2.verdict, "already-refined");
  });
});

describe("背景规则库 — loreFactsFor 回读（改动 4）", () => {
  function buildSession() {
    // 手拼一个最小 session, 只测 lore 过滤逻辑
    const lore = emptyLore();
    addLoreFact(lore, { axis: "space", layer: 0, scope: "coast-east", content: "沿海地带: 温暖湿润", source: "initial", locked_tick: 0 });
    addLoreFact(lore, { axis: "space", layer: 0, scope: "plains-mid", content: "平原腹地: 沃土", source: "initial", locked_tick: 0 });
    addLoreFact(lore, { axis: "time", layer: 0, scope: "tick:5", content: "[disaster] 大旱", source: "history", locked_tick: 5 });
    addLoreFact(lore, { axis: "time", layer: 0, scope: "tick:30", content: "[war] 古老战争", source: "history", locked_tick: 30 });
    return {
      lore,
      current_tick: 10,
      entities: {
        e1: { geography: { region: "coast-east", neighbors: [] }, territory: ["coast-east"] },
      },
    } as unknown as import("./types.ts").SimulationSession;
  }

  test("只返回实体区域 + 近期时间的事实, 排除他区/远古", () => {
    const session = buildSession();
    const facts = loreFactsFor(session, session.entities["e1"]);
    const contents = facts.map((f) => f.content);
    assert.ok(contents.includes("沿海地带: 温暖湿润"), "包含实体区域的空间事实");
    assert.ok(contents.includes("[disaster] 大旱"), "包含近期历史事实");
    assert.ok(!contents.includes("平原腹地: 沃土"), "排除他区域");
    assert.ok(!contents.includes("[war] 古老战争"), "排除远古历史(超出 recentTicks)");
  });

  test("max 截断条数", () => {
    const session = buildSession();
    const facts = loreFactsFor(session, session.entities["e1"], { max: 1 });
    assert.equal(facts.length, 1, "max=1 只返回一条");
  });

  test("无相关事实 → 空数组（无关区域 + 无历史）", () => {
    const lore = emptyLore();
    addLoreFact(lore, { axis: "space", layer: 0, scope: "coast-east", content: "沿海", source: "initial", locked_tick: 0 });
    const session = {
      lore,
      current_tick: 10,
      entities: {},
    } as unknown as import("./types.ts").SimulationSession;
    const far = {
      geography: { region: "desert-south", neighbors: [] },
      territory: ["desert-south"],
    } as import("./types.ts").EntityCard;
    assert.deepEqual(loreFactsFor(session, far), [], "无关区域且无时间事实 → 空");
  });

  test("时间事实是全局近期的（无关区域实体也可见）", () => {
    const session = buildSession();
    const far = {
      geography: { region: "desert-south", neighbors: [] },
      territory: ["desert-south"],
    } as import("./types.ts").EntityCard;
    const facts = loreFactsFor(session, far);
    assert.ok(facts.some((f) => f.content.includes("大旱")), "无区域事实但有近期历史 → 仍注入历史");
    assert.ok(!facts.some((f) => f.content.includes("沿海地带")), "不注入他区域的空间事实");
  });

  test("实体级事实(entityScope)按实体 id 回读（用户锁定修复）", () => {
    const lore = emptyLore();
    // 实体级事实(用户指定): scope 是可读名, entityScope 是实体 id
    addLoreFact(lore, { axis: "space", layer: 0, scope: "entity:精灵国", entityScope: "user-0", content: "精灵崇尚自然, 不可伤害生灵", source: "initial", locked_tick: 0 });
    addLoreFact(lore, { axis: "space", layer: 0, scope: "coast-east", content: "沿海地带: 温暖湿润", source: "initial", locked_tick: 0 });
    const session = {
      lore,
      current_tick: 0,
      entities: {},
    } as unknown as import("./types.ts").SimulationSession;
    const elf = {
      id: "user-0",
      geography: { region: "coast-east", neighbors: [] },
      territory: ["coast-east"],
    } as import("./types.ts").EntityCard;
    const facts = loreFactsFor(session, elf);
    assert.ok(facts.some((f) => f.content.includes("崇尚自然")), "实体级事实被按 entityScope 回读");
    assert.ok(facts.some((f) => f.content.includes("沿海地带")), "区域事实仍被回读");
  });
});

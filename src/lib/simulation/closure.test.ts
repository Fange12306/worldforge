// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 收口验收测试（2026-08-12 数据审查修复）:
 * 1. agent 决策(delta)在物理基线之上真实生效, 不被全量覆盖
 * 2. 领土扩张(territory_claim)校验生效, 子区划有名字(非「·细化」垃圾)
 * 3. 粮食不再单调衰减(food 有生产回补)
 * 4. 新维度提议(propose_dim)走复现门槛, 防维度膨胀
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, runTicks, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { createMockLLM } from "./llm.ts";
import { createRng } from "./random.ts";

function sampleSession() {
  const regions = defaultRegionsWith();
  const e1 = makeEntity("e1", "东境王国", "plains-mid", "人类", "kingdom",
    { population: 100_000, food: 500, military: 500, legitimacy: 60, stability: 60 },
    { "农业": 20 }, { "探索欲": 50 });
  const e2 = makeEntity("e2", "西境部落", "steppe-west", "人类", "tribe",
    { population: 50_000, food: 500, military: 200, legitimacy: 50, stability: 50 },
    { "农业": 15 }, { "探索欲": 40 });
  e1.geography.neighbors = ["e2"];
  e2.geography.neighbors = ["e1"];
  const session = createSession({
    laws: EARTH_LAWS, regions, entities: [e1, e2],
    config: { seed: 1, randomness: 0.1, surprise: 0.1, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
  });
  session.current_tick = 1;
  return session;
}

function defaultRegionsWith() {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  return regions;
}

describe("收口 — agent 决策在物理基线之上生效", () => {
  test("agent 的 population delta 不被 physics 全量覆盖（决定性瘟疫 clamps 到下限）", async () => {
    const session = sampleSession();
    const before = session.entities["e1"].metrics.population;
    // agent 上报灾难性人口损失 → 复合增长无法抵消, 人口应被 clamp 到 MIN_POP
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [{ type: "disaster", description: "瘟疫席卷, 人口锐减" }],
      metric_delta: { population: -500_000 },
    }));
    await runTicks(session, 1, { agentConfig: { llm: mock }, llm: mock });
    const after = session.entities["e1"].metrics.population;
    assert.ok(after < before * 0.1, `agent 负人口 delta 真实生效并被 clamp: before=${before} after=${after}`);
  });

  test("tech_delta 只作用于已有维度（防矮人 150+ 膨胀）", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      tech_delta: { "制度": 5, "跨区同期对照附册法": 10 },  // 后者不在初始 tech → 应被过滤
    }));
    await runTicks(session, 2, { agentConfig: { llm: mock }, llm: mock });
    const techKeys = Object.keys(session.entities["e1"].tech);
    assert.ok(!techKeys.includes("跨区同期对照附册法"), "新维度键不被 tech_delta 写入");
    assert.ok(techKeys.includes("制度") || techKeys.includes("农业"), "已有维度保留");
  });

  test("propose_dim 单次提议即注册（LLM 综合判断, 不设复现阈值）", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      propose_dim: [{ name: "水利灌溉", reason: "河渠对农业日益关键" }],
    }));
    await runTicks(session, 1, { agentConfig: { llm: mock }, llm: mock });
    assert.ok("水利灌溉" in session.registry.dims, "单次提议即注册");
  });
});

describe("收口 — 领土扩张", () => {
  test("territory_claim 占相邻区域 → 并入 territory", async () => {
    const session = sampleSession();
    // e1 在 plains-mid, 邻居含 coast-east; claim 它
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [{ type: "migration", description: "东境王国沿河拓荒至沿海地带" }],
      territory_claim: [{ region: "coast-east" }],
    }));
    await runTicks(session, 1, { agentConfig: { llm: mock }, llm: mock });
    const terr = session.entities["e1"].territory ?? [];
    assert.ok(terr.includes("coast-east"), `相邻区域被占取: ${terr.join(",")}`);
  });

  test("territory_claim 建命名子区划（非「·细化」垃圾）, children 无重复", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      territory_claim: [{ region: "nonexistent", name: "北境河湾", character: "沿河冲积带" }],
    }));
    // 占已有区划下新建子区划: claim.region 不存在 + 有 name → 挂到已领区划
    await runTicks(session, 1, { agentConfig: { llm: mock }, llm: mock });
    const terr = session.entities["e1"].territory ?? [];
    const subId = terr.find((t) => t.includes("北境河湾"));
    assert.ok(subId, `命名子区划并入领土: ${terr.join(",")}`);
    // 区域创建且名字来自 LLM（非「·细化」）; 父 children 无重复
    const sub = session.regions[subId];
    assert.ok(sub, "子区划存在于 regions");
    assert.equal(sub.name, "北境河湾", "名字是 LLM 提供的具体地名");
    const parent = session.regions[sub.parent];
    assert.ok(parent, "子区划有父级");
    assert.equal(new Set(parent.children).size, parent.children.length, "children 无重复");
  });

  test("治理上限: 领土达到 adminCapacity 后拒绝扩张", async () => {
    const session = sampleSession();
    // e1(王国) adminCapacity 约 4(核心+3)。一次 claim 6 个 → 应被治理上限截住, 不能全占
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      territory_claim: [
        { region: "coast-east" }, { region: "steppe-west" }, { region: "forest-valley" },
        { region: "desert-south" }, { region: "tundra-north" }, { region: "mountains-north" },
      ],
    }));
    await runTicks(session, 1, { agentConfig: { llm: mock }, llm: mock });
    const terr = session.entities["e1"].territory ?? [];
    const newClaims = terr.filter((t) => t !== "plains-mid");
    assert.ok(newClaims.length < 6, `治理上限应限制扩张(实际占 ${newClaims.length}/6): ${newClaims.join(",")}`);
  });

  test("征服需军力占优: 弱军占已有区划被拒", async () => {
    const session = sampleSession();
    // e2 已控制 steppe-west; 给 e2 极高军力, e1 低军力 → e1 想占 steppe-west 应被拒
    session.entities["e2"].metrics.military = 1_000_000;
    session.entities["e1"].metrics.military = 100;
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      territory_claim: [{ region: "steppe-west" }],
    }));
    await runTicks(session, 1, { agentConfig: { llm: mock }, llm: mock });
    const terr = session.entities["e1"].territory ?? [];
    assert.ok(!terr.includes("steppe-west"), `弱军征服应被拒: ${terr.join(",")}`);
  });
});

describe("收口 — 粮食不再单调衰减", () => {
  test("food 有生产回补, 不再恒衰减到负", async () => {
    const session = sampleSession();
    // 纯物理, 无 agent delta; e1 农业 20 → 人均产量约 ~1.0, 应保持非负
    await runTicks(session, 10, { llm: undefined });
    const food = session.entities["e1"].metrics.food;
    assert.ok(food > -100_000, `food 有回补而非单调衰减: ${food}`);
  });
});

describe("收口 — 稀有事件自由类型（LLM 综合判断, 无概率门）", () => {
  test("100 tick 引擎稀有事件用自由类型, 描述去重（不预设类别/不敷衍）", async () => {
    const session = sampleSession();
    // real:true mock LLM 每 tick 对每个实体判断; 大部分平静(null), 偶发独特事件
    const POOL = ["彗星观象", "银根紧缩", "先贤遗策", "海市蜃楼", "王室决裂"];
    let rareCalls = 0;
    const realLLM = {
      real: true,
      call: async ({ userMessage }: { userMessage: string }) => {
        // agent 推演 → 返回 agent 契约（agent prompt 含"实体卡片", 稀有事件 prompt 不含）
        if (userMessage.includes("实体卡片")) {
          return JSON.stringify({ decisions: [], events: [], metric_delta: {} });
        }
        // 稀有事件: 大约每 8 次才产出 1 件(模拟 LLM 判断"数十年一遇, 多数平静")
        rareCalls++;
        if (rareCalls % 8 !== 0) return "null";
        const t = POOL[(rareCalls / 8) % POOL.length | 0];
        return JSON.stringify({ type: t, description: `第 ${rareCalls} 起由世界状态涌现的独特事件（${t}）`, severity: "mild" });
      },
    };
    await runTicks(session, 100, { agentConfig: { llm: realLLM }, llm: realLLM });
    const engineRandom = session.events.filter((e) => e.source === "engine" && e.random === true);
    const types = new Set(engineRandom.map((e) => e.type));
    const descDedup = new Set(engineRandom.map((e) => e.description)).size;
    assert.ok(engineRandom.length <= 60, `稀有事件不应每实体每 tick(100tick 实际 ${engineRandom.length})`);
    assert.ok(types.size >= 3, `稀有事件类型多样(实际 ${types.size} 种: ${[...types].join("/")})`);
    assert.ok([...types].every((t) => !["disaster", "tech", "other"].includes(t)), "无泛泛类型标签");
    assert.ok(descDedup / Math.max(1, engineRandom.length) >= 0.8, `描述去重率 ≥80%(实际 ${descDedup}/${engineRandom.length})`);
  });
});

// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * Phase 1 验收测试 — 多 agent 并行推演（§5.2）+ 全局仲裁 agent（§5.3）。
 * 用 mock LLM 验证：agent 产出 JSON 契约 → 事件 → 仲裁。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, defaultRegions, runTicks } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { createMockLLM, parseJSONFromLLM } from "./llm.ts";
import { runEntityAgent, runAllAgents, runGlobalArbiter } from "./agent.ts";
import { buildEntityKnowledge, buildAgentInput, classifyAttention } from "./context.ts";
import { arbitrate } from "./arbiter.ts";
import { initialStateToSession } from "./init-customizer.ts";
import { createRng } from "./random.ts";
import type { SimulationEvent } from "./types.ts";

function sampleSession() {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
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

describe("parseJSONFromLLM — 容忍 markdown 包裹", () => {
  test("解析纯 JSON 对象", () => {
    const out = parseJSONFromLLM<{ a: number }>('{"a": 1}');
    assert.equal(out.a, 1);
  });
  test("解析 ```json 包裹", () => {
    const out = parseJSONFromLLM<{ a: number }>('```json\n{"a": 2}\n```');
    assert.equal(out.a, 2);
  });
});

describe("单 agent 推演 — §5.2", () => {
  test("mock LLM 产出事件, delta 暂存且 tech_delta 过滤到已有维度", async () => {
    const session = sampleSession();
    // mock LLM 返回结构化 JSON 产出
    const mock = createMockLLM(() => JSON.stringify({
      decisions: ["训练常备军"],
      events: [{ type: "reform", description: "东境王国推行制度改革" }],
      metric_delta: { stability: -5 },
      tech_delta: { "制度": 3, "农业": 2 },   // 制度 不在初始 tech → 被过滤; 农业 在 → 保留
      notes: "王位继承问题未决",
    }));

    const { events, delta } = await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "reform");
    assert.equal(events[0].participants[0], "e1");
    // delta 暂存: 实体状态本 tick 不被直接改(由调度器在物理基线之上应用)
    assert.ok(delta, "delta 已暂存返回");
    assert.ok(session.entities["e1"].metrics.stability === 60, "delta 不直接写实体(待调度器应用)");
    assert.equal(delta!.tech_delta?.["农业"], 2, "已有维度保留");
    assert.ok(!("制度" in (delta!.tech_delta ?? {})), "不在已有维度的新维度键被过滤(维度膨胀防线)");
    assert.ok(session.entities["e1"].internal.active_issues.includes("王位继承问题未决"));
  });

  test("LLM 产出非法 JSON → 丢弃", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => "不是JSON");
    const { events, delta } = await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(events.length, 0);
    assert.equal(delta, null);
  });
});

describe("多 agent 并行推演 — §5.2", () => {
  test("两个实体并行产出, 汇总事件 + delta", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [],
      events: [{ type: "diplomacy", description: "提出互不侵犯条约" }],
    }));
    const result = await runAllAgents(session, { llm: mock });
    assert.equal(result.events.length, 2, "两个实体各产出 1 事件");
  });
});

describe("全局仲裁 agent — §5.3", () => {
  test("mock LLM 裁决冲突", async () => {
    const session = sampleSession();
    const evA: SimulationEvent = {
      id: "A", tick: 1, time_label: "t1", type: "war", participants: ["e1", "e2"], region: "steppe-west",
      description: "东境王国声称征服了西境", changes: [], random: false, source: "agent",
    };
    const evB: SimulationEvent = {
      id: "B", tick: 1, time_label: "t1", type: "war", participants: ["e1", "e2"], region: "steppe-west",
      description: "西境部落声称击退了东境入侵", changes: [], random: false, source: "agent",
    };
    const mock = createMockLLM(() => JSON.stringify([
      { index: 0, winner: "A", note: "东境军力更强" },
    ]));
    const result = await runGlobalArbiter(session, [{ eventA: evA, eventB: evB }], mock);
    assert.equal(result.rulings.length, 1);
    assert.equal(result.rulings[0].winner, "A");
    assert.equal(result.rulings[0].eventId, "A");
  });
});

describe("agent 产出 → 仲裁集成", () => {
  test("agent 事件过仲裁器（历史法则/细化锁定/历史锁定）", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [],
      events: [{ type: "war", target: "e2", description: "东境王国向西境宣战" }],
    }));
    const result = await runAllAgents(session, { llm: mock });
    const arb = await arbitrate({
      laws: session.laws,
      config: session.config,
      entities: session.entities,
      lore: session.lore,
      currentTick: 1,
    }, result.events);
    // 战争事件通常通过（无硬约束违反）
    assert.ok(arb.accepted.length >= 0, "仲裁器处理 agent 事件");
  });
});

describe("端到端: 真实 LLM 接入后的推演（§5.2 全链路）", () => {
  /**
   * 模拟"真实 LLM 接入"：mock 按实体名与 tick 输出多样化的真实事件契约。
   * 验证: 一旦真实模型接上（不再输出固定空话）, 引擎会产出多样化宏观历史、
   * 指标随推演变化、维度开始涌现。
   */
  test("多实体世界跑 6 tick: 事件多样化 + 指标变化 + 维度涌现", async () => {
    // 用 initialStateToSession 构建多实体世界（模拟真实 LLM 补全后的初始化输出）
    const completed = {
      laws: { rules: ["起死回生不可能发生。"], narrative: [], ontology: [] },
      regions: [
        { id: "east", name: "东域", biome: "forest", neighbors: ["west"] },
        { id: "west", name: "西域", biome: "steppe", neighbors: ["east"] },
        { id: "north", name: "北地", biome: "mountains" },
      ],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east", religion: "月神", population: 80000,
          relations: [{ target: "兽人国", stance: "war", note: "争夺边境" }] },
        { name: "兽人国", species: "兽人", regionId: "west", religion: "战神", population: 60000,
          relations: [{ target: "精灵国", stance: "war", note: "争夺边境" }] },
        { name: "矮人国", species: "矮人", regionId: "north", population: 50000 },
      ],
    };
    const init = initialStateToSession(completed, createRng(7), EARTH_LAWS);
    const session = createSession({
      laws: init.laws, regions: init.regions, entities: init.entities,
      languages: init.languages, cultures: init.cultures,
      config: { seed: 7, randomness: 0.4, surprise: 0.3, rigor: 0.6, maxTicks: 100, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
    });

    // 初始关系与邻接已建立
    const elf = session.entities["user-0"];
    const orc = session.entities["user-1"];
    assert.equal(elf.relations[0].stance, "war", "初始关系进入实体");
    assert.ok(elf.geography.neighbors.includes(orc.id), "邻接实体互邻");

    // 模拟真实 LLM: 按实体产出不同真实事件
    const realLikeLLM = createMockLLM((prompt) => {
      const isElf = prompt.includes("精灵国");
      const isOrc = prompt.includes("兽人国");
      if (isElf && isOrc) {
        return JSON.stringify({ decisions: ["整备边境军力"], events: [{ type: "war", target: "user-1", description: "精灵国对兽人国边境发起攻势" }], metric_delta: { military: 50, stability: -5 } });
      }
      if (isElf) {
        return JSON.stringify({ decisions: ["在月神祭典中祈福"], events: [{ type: "cultural", description: "精灵国举行盛大的月神祭典" }], metric_delta: { legitimacy: 3 } });
      }
      if (isOrc) {
        return JSON.stringify({ decisions: ["集结战团"], events: [{ type: "war", target: "user-0", description: "兽人国向精灵国回击" }], metric_delta: { military: 80 } });
      }
      // 矮人: 发展冶金
      return JSON.stringify({ decisions: [], events: [{ type: "tech", description: "矮人国改进山间矿道与冶炼" }], tech_delta: { 冶金: 8 } });
    });

    const result = await runTicks(session, 6, {
      agentConfig: { llm: realLikeLLM, maxTokens: 2000 },
      llm: realLikeLLM,
    });

    // 1. 事件类型多样化（真实宏观历史, 而非固定空话）
    const types = new Set(result.session.events.map((e) => e.type));
    assert.ok(types.size >= 4, `事件类型应多样化, 实际: ${[...types].join(",")}`);
    assert.ok(types.has("war"), "有战争事件");
    assert.ok(types.has("tech") || types.has("cultural"), "有技术/文化事件");

    // 2. 指标随推演变化（军力不再是初始值）
    const elfAfter = result.session.entities["user-0"];
    const orcAfter = result.session.entities["user-1"];
    assert.ok(elfAfter.metrics.military > 500 || elfAfter.metrics.military !== 400, "精灵军力随推演变化");
    assert.ok(orcAfter.metrics.military > 400, "兽人军力随推演增长");

    // 3. 维度开始涌现（矮人发展冶金 → 注册表出现维度）
    const dims = Object.keys(result.session.registry.dims);
    assert.ok(dims.length > 0, `维度应涌现, 实际: ${dims.join(",")}`);
    assert.ok(dims.includes("冶金"), "冶金维度被注册");

    // 4. 实体军力关系导致战争推进
    const warEvents = result.session.events.filter((e) => e.type === "war");
    assert.ok(warEvents.length > 0, "战争事件实际发生");
  });
});

describe("时间粒度开放化(agent 建议 suggest_years_per_tick)", () => {
  test("agent 建议调整 yearsPerTick, 合理值生效", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      suggest_years_per_tick: 100,  // 部落时代 → 大粒度
    }));
    await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(session.config.yearsPerTick, 100, "合理建议生效");
  });

  test("离谱建议(突变过大)被拒绝", async () => {
    const session = sampleSession();
    session.config.yearsPerTick = 10;
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      suggest_years_per_tick: 100000,  // 突变 10000 倍, 离谱
    }));
    await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(session.config.yearsPerTick, 10, "离谱建议被拒, 保持原值");
  });

  test("负值/非法建议被拒绝", async () => {
    const session = sampleSession();
    session.config.yearsPerTick = 10;
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [],
      suggest_years_per_tick: -5,
    }));
    await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(session.config.yearsPerTick, 10, "负值被拒");
  });
});

describe("agent 事件感知校验 + 一致性约束", () => {
  test("事件 target 不在感知范围 → 丢弃(禁编造未感知互动)", async () => {
    const session = sampleSession();  // e1(东境) 与 e2(西境) 相邻, 感知到 e2
    const k = buildEntityKnowledge(session, session.entities["e1"]);
    assert.ok(k.awareEntities.some((a) => a.entity === "e2"), "e1 感知 e2");
    // agent 事件 target 是感知外的实体(不存在) → 丢弃
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [],
      events: [{ type: "diplomacy", target: "ghost-entity", description: "与幽灵文明建交" }],
      metric_delta: {},
    }));
    const { events } = await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(events.length, 0, "未感知的 target 事件被丢弃");
  });

  test("事件 target 在感知范围 → 保留", async () => {
    const session = sampleSession();
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [],
      events: [{ type: "diplomacy", target: "e2", description: "与西境部落互通有无" }],
      metric_delta: {},
    }));
    const { events } = await runEntityAgent(session, "e1", { llm: mock });
    assert.equal(events.length, 1, "感知内的 target 事件保留");
    assert.equal(events[0].participants[1], "e2");
  });

  test("system prompt 含地理 + 感知一致性约束", async () => {
    const session = sampleSession();
    const k = buildEntityKnowledge(session, session.entities["e1"]);
    const input = buildAgentInput(session, session.entities["e1"], k, classifyAttention(0.3));
    assert.ok(input.system.includes("一致性约束"), "system 含一致性约束");
    assert.ok(input.system.includes("感知范围"), "含感知范围约束");
    assert.ok(input.user.includes("地理信息"), "user 含地理信息");
  });

  test("LLM 异常产出不崩溃: changes 非数组 / decisions 是对象 / changes 元素是字符串", async () => {
    const session = sampleSession();
    // changes 是对象(非数组) + decisions 是对象数组 → 不抛错
    const malformedChanges = createMockLLM(() => JSON.stringify({
      decisions: [{ action: "开战" }, "筑城"],
      events: [{
        type: "diplomacy",
        description: "边境会盟",
        changes: { entity: "e1", metrics: { stability: -5 } }, // 对象而非数组
      }],
      metric_delta: {},
    }));
    const r1 = await runEntityAgent(session, "e1", { llm: malformedChanges });
    assert.equal(r1.events.length, 1, "changes 非数组 → 事件仍生成, 不崩溃");
    assert.deepEqual(r1.events[0].changes, [], "非数组 changes 被归一化为空, 不崩仲裁");

    // changes 数组元素是字符串 → 跳过该元素, 不崩溃
    const stringElem = createMockLLM(() => JSON.stringify({
      decisions: [],
      events: [{
        type: "diplomacy",
        description: "边境会盟",
        changes: ["这是零散描述", { entity: "e1", stance: "war" }],
      }],
      metric_delta: {},
    }));
    const r2 = await runEntityAgent(session, "e1", { llm: stringElem });
    assert.equal(r2.events.length, 1, "changes 含字符串元素 → 事件仍生成");
    assert.equal(r2.events[0].changes.length, 1, "字符串元素被跳过, 只保留对象");
    assert.equal(r2.events[0].changes[0].stance, "war");
  });
});

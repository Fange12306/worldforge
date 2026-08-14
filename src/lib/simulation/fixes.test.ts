// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 2026 架构审查修复验收测试:
 * B1 冲突消解只删败方冲突事件(不误伤无关事件)
 * B2 仲裁通过后才应用 agent delta(被拒事件不改变世界状态)
 * B3 细化只锁空间细节事件(agent 叙事不污染 lore) + 层数封顶
 * A2 规则层 LLM 语义复核(validateRules)拒绝违规事件
 * B4 分裂分割领土 + 吞并后邻居重路由
 * A3 预算计量 + perTickGlobal 熔断(降级可省略的语义层)
 * A4 autoJump 平静期跳 tick + fallback 黑天鹅按 randomness 门控
 * B5 注册表只含真正发展轴(无物理常量)
 * B6 人口钳制无悬崖 + 初始化超载提示
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import {
  createSession, runTicks, makeEntity, defaultRegions, defaultConfig,
} from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { createMockLLM } from "./llm.ts";
import { arbitrate } from "./arbiter.ts";
import { splitEntity } from "./entity-pool.ts";
import type { SimulationEvent } from "./types.ts";

function world(seed = 1, overrides: Record<string, unknown> = {}) {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  const e = makeEntity("e1", "东境王国", "plains-mid", "人类", "kingdom",
    { population: 200_000, food: 500, military: 1000, legitimacy: 60, stability: 60 },
    { "农业": 20, "制度": 15 }, { "探索欲": 50 });
  const session = createSession({
    laws: EARTH_LAWS, regions, entities: [e],
    config: { ...defaultConfig(seed), randomness: 0, surprise: 0, ...overrides },
  });
  return session;
}

function agentMock(output: unknown) {
  return createMockLLM(() => JSON.stringify(output));
}

describe("B1 — 冲突消解只删败方冲突事件", () => {
  test("败方本 tick 的无关事件保留, 只移除冲突事件本身", async () => {
    const s = world(2);
    const b = makeEntity("b", "B国", "plains-mid", "人类", "kingdom",
      { population: 100_000, military: 2000, food: 500, legitimacy: 60, stability: 60 },
      { "农业": 15 }, {});
    s.entities["b"] = b;

    const evA: SimulationEvent = {
      id: "evA", tick: 1, time_label: "t1", type: "war", participants: ["e1", "b"],
      region: "plains-mid", description: "东境王国大军压境征服B国",
      changes: [{ entity: "b", absorbed_by: "e1" }], random: false, source: "agent", major: true,
    };
    const evB: SimulationEvent = {
      id: "evB", tick: 1, time_label: "t1", type: "war", participants: ["b", "e1"],
      region: "plains-mid", description: "B国成功击退东境入侵",
      changes: [], random: false, source: "agent", major: true,
    };
    const evC: SimulationEvent = {
      id: "evC", tick: 1, time_label: "t1", type: "cultural", participants: ["b"],
      region: "plains-mid", description: "B国修建了水利工程",
      changes: [{ entity: "b", metrics: { food: 5 } }], random: false, source: "agent",
    };

    const arb = await arbitrate({
      laws: s.laws, config: s.config, entities: s.entities, lore: s.lore, currentTick: 1,
    }, [evA, evB, evC]);

    // 数值仲裁按 participants[0] 的军力: e1=1000 < b=2000 → B 胜, evA(东境)落败
    const winner = arb.conflicts[0]?.resolved?.winner;
    assert.ok(arb.accepted.some((e) => e.id === evC.id), "败方无关事件必须保留");
    assert.ok(!arb.accepted.some((e) => e.id === evA.id), "败方冲突事件被移除: winner=" + winner);
    assert.ok(arb.blocked.some((e) => e.id === "blocked-evA"), "败方冲突事件以受阻记录可见");
  });
});

describe("B2 — 仲裁通过后才应用 agent delta", () => {
  test("被硬约束拒绝的事件其 metric_delta 不生效", async () => {
    const s = world(3);
    // 描述含规则核心词 → 关键词粗筛命中 → 事件被拒; 但 delta 声称人口 -50 万
    const mock = agentMock({
      decisions: [], events: [{ type: "奇迹", description: "祭司宣称能够起死回生" }],
      metric_delta: { population: -500_000 },
    });
    await runTicks(s, 1, { agentConfig: { llm: mock }, llm: mock });
    assert.ok(s.events.some((e) => e.description.startsWith("【受阻】")), "事件被拒并产生受阻记录");

    const s2 = world(4);
    const mock2 = agentMock({
      decisions: [], events: [{ type: "文化", description: "王国修整军队" }],
      metric_delta: { population: -500_000 },
    });
    await runTicks(s2, 1, { agentConfig: { llm: mock2 }, llm: mock2 });

    const rejectedPop = s.entities["e1"].metrics.population;
    const acceptedPop = s2.entities["e1"].metrics.population;
    // rejected: 仅物理基线(≈20万); accepted: delta -50万 生效并被 clamp 到下限(100)
    assert.ok(
      acceptedPop < rejectedPop * 0.01,
      "被拒事件 delta 不生效(仅物理基线), accepted 事件 delta 生效: rejected=" + rejectedPop + " accepted=" + acceptedPop,
    );
  });

  test("被 LLM 语义复核拒绝的事件同样不生效(且产生受阻记录)", async () => {
    const s = world(5);
    const judge = {
      real: true,
      call: async ({ systemPrompt, userMessage }) => {
        const all = systemPrompt + " " + userMessage;
        if (userMessage.includes("实体卡片")) {
          return JSON.stringify({
            decisions: [], events: [{ type: "奇迹", description: "大祭司令死者复活", changes: [] }],
            metric_delta: { population: 50_000 },
          });
        }
        if (all.includes("硬约束校验")) {
          const m = userMessage.match(/\[(agent-[^\]]+)\]/);
          return JSON.stringify({ violations: [{ event_id: m ? m[1] : "x", reason: "起死回生违反法则" }] });
        }
        return "null";
      },
    };
    const before = s.entities["e1"].metrics.population;
    await runTicks(s, 1, { agentConfig: { llm: judge }, llm: judge });
    assert.ok(s.events.some((e) => e.description.startsWith("【受阻】")), "语义复核拒绝 → 受阻记录");
    const after = s.entities["e1"].metrics.population;
    assert.ok(after < before * 1.03, "被拒事件 delta(+5万) 不生效: " + before + " → " + after);
  });
});

describe("B3 — 细化只锁空间细节, 不锁 agent 叙事", () => {
  test("agent 事件描述不进入 lore 空间事实; 细化层数封顶", async () => {
    const s = world(6, { randomness: 0.3 });
    const mock = createMockLLM(() => JSON.stringify({
      decisions: [], events: [{ type: "文化", description: "第 N tick, 王国延续着古老的传统" }], metric_delta: {},
    }));
    await runTicks(s, 10, { agentConfig: { llm: mock }, llm: mock });

    const spaceFacts = s.lore.facts.filter((f) => f.axis === "space" && f.source === "refinement");
    for (const f of spaceFacts) {
      assert.ok(!f.content.includes("王国延续着古老的传统"), "agent 叙事不锁为空间事实: " + f.content.slice(0, 40));
    }
    // 层数封顶: 任何 scope 的细化层 ≤ MAX_REFINEMENT_LAYERS(4)
    const byScope = new Map<string, number[]>();
    for (const f of spaceFacts) {
      if (!byScope.has(f.scope)) byScope.set(f.scope, []);
      byScope.get(f.scope)!.push(f.layer);
    }
    for (const [scope, layers] of byScope) {
      assert.ok(Math.max(...layers) <= 4, scope + " 细化层数封顶, got " + Math.max(...layers));
    }
  });

  test("被拒的空间事件不产生细化入库", async () => {
    const s = world(7);
    const ev: SimulationEvent = {
      id: "spatial-bad", tick: 1, time_label: "t1", type: "cultural", participants: ["e1"],
      region: "desert-south", description: "起死回生发生在绿洲", changes: [], random: false, source: "engine",
    };
    const arb = await arbitrate({
      laws: s.laws, config: s.config, entities: s.entities, lore: s.lore, currentTick: 1,
    }, [ev]);
    assert.ok(arb.blocked.length > 0, "违规空间事件被拒");
    assert.equal(arb.refinements.length, 0, "被拒事件无细化入库");
  });
});

describe("B4 — 分裂分割领土 + 邻居重路由", () => {
  test("分裂: 父实体保留前半领土, 子实体分得后半, 不重叠", () => {
    const parent = makeEntity("p", "大王国", "plains-mid", "人类", "kingdom",
      { population: 800_000, military: 5000, food: 500, legitimacy: 60, stability: 60 },
      { "农业": 25 }, {});
    parent.territory = ["plains-mid", "coast-east", "forest-valley", "steppe-west"];
    const ev: SimulationEvent = {
      id: "s-1", tick: 1, time_label: "t1", type: "secession", participants: ["p"],
      region: "plains-mid", description: "南部独立建国", changes: [], random: false, source: "agent",
    };
    const r = splitEntity(parent, ev, "南部邦联", 1);
    assert.ok(r.parent.territory!.includes("plains-mid"), "核心区留在父实体");
    const overlap = r.child.territory!.some((t) => r.parent.territory!.includes(t));
    assert.equal(overlap, false, "分裂后领土不重叠: 父=" + r.parent.territory.join(",") + " 子=" + r.child.territory.join(","));
    assert.ok(r.child.territory!.length > 0, "子实体分得领土");
    assert.equal(r.child.history, undefined, "子实体不继承父的指标历史");
  });

  test("吞并后其余实体邻居重路由: 被吞者 id 换成吞并者", async () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const a = makeEntity("a", "A国", "coast-east", "人类", "kingdom",
      { population: 300_000, military: 5000, food: 500, legitimacy: 60, stability: 60 }, { "农业": 20 }, {});
    const b = makeEntity("b", "B国", "plains-mid", "人类", "kingdom",
      { population: 200_000, military: 2000, food: 500, legitimacy: 60, stability: 60 }, { "农业": 15 }, {});
    const c = makeEntity("c", "C国", "mountains-north", "人类", "kingdom",
      { population: 150_000, military: 3000, food: 500, legitimacy: 60, stability: 60 }, { "农业": 10 }, {});
    a.geography.neighbors = ["b"];
    b.geography.neighbors = ["a", "c"];
    c.geography.neighbors = ["b"];
    const s = createSession({
      laws: EARTH_LAWS, regions, entities: [a, b, c],
      config: { ...defaultConfig(8), randomness: 0, surprise: 0 },
    });
    const mock = agentMock({
      decisions: [], events: [{ type: "conquest", target: "b", description: "A国征服了B国",
        changes: [{ entity: "b", absorbed_by: "a" }] }],
      metric_delta: {},
    });
    await runTicks(s, 1, { agentConfig: { llm: mock }, llm: mock });
    assert.equal(s.entities["b"].status, "extinct", "B 被吞并");
    assert.ok(!s.entities["c"].geography.neighbors.includes("b"), "C 的邻居移除 B");
    assert.ok(s.entities["c"].geography.neighbors.includes("a"), "C 的邻居并入 A");
    assert.ok(s.entities["a"].geography.neighbors.includes("c"), "A 的邻居并入 C");
  });
});

describe("A3 — 预算计量与熔断", () => {
  test("perTickGlobal 超限 → 稀有事件语义层被跳过", async () => {
    // autoJump 关闭: 预算测试关注"超限跳过稀有事件", 不受跳步干扰
    const s = world(9, { autoJump: false, budget: { perTickGlobal: 400, perEntity: 4000, hotspotMultiplier: 4 } });
    let rareCalls = 0;
    const llm = {
      real: true,
      call: async ({ userMessage }) => {
        if (userMessage.includes("实体卡片")) return JSON.stringify({ decisions: [], events: [], metric_delta: {} });
        rareCalls += 1; // 稀有事件 / 细分 / 规则复核
        return "null";
      },
    };
    const res = await runTicks(s, 5, { agentConfig: { llm }, llm });
    assert.equal(rareCalls, 0, "预算超限后稀有事件不再询问 LLM");
    assert.ok((res.cost?.calls ?? 0) >= 1, "成本被计量: calls=" + res.cost?.calls);
  });
});

describe("A4 — autoJump 与 fallback 随机门控", () => {
  test("autoJump: 平静期跳过 agent 推演, 每 3 tick 至少跑一次", async () => {
    const s = world(10);
    let agentCalls = 0;
    const counting = {
      real: false,
      call: async ({ userMessage }) => {
        if (userMessage.includes("实体卡片")) agentCalls += 1;
        return JSON.stringify({ decisions: [], events: [], metric_delta: {} });
      },
    };
    await runTicks(s, 10, { agentConfig: { llm: counting }, llm: counting });
    assert.ok(agentCalls >= 3 && agentCalls <= 5, "安静 10 tick 应跳步: agent 调用 " + agentCalls + " (期望 ~4)");
  });

  test("fallback 黑天鹅按 randomness 门控: randomness=0 无程序化黑天鹅", async () => {
    const s = world(11, { randomness: 0 });
    const mock = agentMock({ decisions: [], events: [], metric_delta: {} });
    await runTicks(s, 6, { agentConfig: { llm: mock }, llm: mock });
    const swans = s.events.filter((e) => e.id.startsWith("evt-bs-"));
    assert.equal(swans.length, 0, "randomness=0 不生成黑天鹅");
  });
});

describe("B5/B6 — 注册表与人口钳制", () => {
  test("注册表只含真正发展轴, 无物理常量(food_capacity 等)", () => {
    const s = world(12);
    const dims = Object.keys(s.registry.dims);
    assert.ok(dims.includes("航海") && dims.includes("农业") && dims.includes("冶金"), "真实发展轴注册: " + dims.join(","));
    for (const bad of ["food_capacity", "naval_potential", "mineral_potential", "agriculture_potential"]) {
      assert.ok(!dims.includes(bad), "物理常量不注册为维度: " + bad);
    }
  });

  test("超载实体的人口不因 agent 增长声明被硬拽到承载(无悬崖)", async () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const desert = makeEntity("d", "沙漠绿洲城邦", "desert-south", "人类", "kingdom",
      { population: 500_000, food: 500, military: 3000, legitimacy: 60, stability: 60 },
      { "农业": 10 }, {});
    const s = createSession({
      laws: EARTH_LAWS, regions, entities: [desert],
      config: { ...defaultConfig(13), randomness: 0, surprise: 0 },
    });
    const mock = agentMock({
      decisions: [], events: [{ type: "发展", description: "人口繁荣增长" }],
      metric_delta: { population: 100_000 },
    });
    await runTicks(s, 1, { agentConfig: { llm: mock }, llm: mock });
    const pop = s.entities["d"].metrics.population;
    assert.ok(pop > 400_000, "不出现 50万→4万 的悬崖: " + pop);
  });

  test("初始化超载人口给出一句话提示", () => {
    const regions = defaultRegions();
    for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
    const desert = makeEntity("d2", "沙漠城邦", "desert-south", "人类", "kingdom",
      { population: 500_000, food: 500, military: 3000, legitimacy: 60, stability: 60 },
      { "农业": 10 }, {});
    const s = createSession({
      laws: EARTH_LAWS, regions, entities: [desert],
      config: { ...defaultConfig(14), randomness: 0 },
    });
    const notes = s.entities["d2"].internal.recent_events.join(" ");
    assert.ok(notes.includes("超出区域承载"), "超载提示: " + notes);
  });
});

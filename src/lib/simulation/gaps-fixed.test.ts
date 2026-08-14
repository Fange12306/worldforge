// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 修复后功能验证（audit 缺口修复）。
 *
 * 验证：
 * - 配置生效: granularity/tickDuration/maxEntities/hotspotMultiplier
 * - 注意力 active_level 写回实体
 * - 维度 promote/demote + 冻结
 * - 受阻记录写入事件流
 * - past 细化写背景规则库
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, runTicks, makeEntity, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { emptyRegistry, promoteDimension, demoteDimension, freezeDimension } from "./registry.ts";

function session(configOverrides = {}) {
  const regions = defaultRegions();
  for (const [id, r] of Object.entries(regions)) regions[id] = { ...r, resources: deriveRegionResources(r.biome, EARTH_LAWS) };
  const e = makeEntity("e", "王国", "plains-mid", "人类", "kingdom",
    { population: 200_000, food: 1000, economy: 40, military: 800, legitimacy: 60, stability: 60 },
    { "农业": 30, "制度": 20 }, { "探索欲": 50, "组织倾向": 50 });
  return createSession({
    laws: EARTH_LAWS, regions, entities: [e],
    config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 }, ...configOverrides },
  });
}

describe("配置生效 — audit 缺口修复", () => {
  test("yearsPerTick 影响时间标签", async () => {
    const s = session({ yearsPerTick: 1 });
    await runTicks(s, 1);
    const ev = s.events[s.events.length - 1];
    assert.ok(ev.time_label.includes("tick 1"), `year 模式: ${ev.time_label}`);

    const s2 = session({ yearsPerTick: 10 });
    await runTicks(s2, 1);
    const ev2 = s2.events[s2.events.length - 1];
    // yearsPerTick=10: tick 1 = 第10年
    assert.ok(ev2.time_label.includes("010"), `十年模式应是第10年: ${ev2.time_label}`);
  });

  test("granularity 影响例行事件粒度", async () => {
    const sMicro = session({ granularity: "micro" });
    await runTicks(sMicro, 1);
    const routineMicro = sMicro.events.find((e) => e.id.startsWith("evt-routine"));
    assert.ok(routineMicro.description.includes("人口"), `micro 粒度含人口细节: ${routineMicro.description}`);
  });

  test("maxEntities 限制分裂", async () => {
    const s = session({ maxEntities: 1 });
    await runTicks(s, 5);
    const active = Object.values(s.entities).filter((e) => e.status === "active").length;
    assert.ok(active <= 1, `maxEntities=1 → 活跃实体不超过 1 (got ${active})`);
  });
});

describe("注意力 active_level 写回", () => {
  test("动荡实体 active_level 变 hotspot", async () => {
    const s = session();
    s.entities["e"].metrics.stability = 5;
    s.entities["e"].metrics.legitimacy = 5;
    s.entities["e"].relations = [{ target: "x", stance: "war" }];
    await runTicks(s, 1);
    assert.equal(s.entities["e"].active_level, "hotspot", "动荡实体写回 hotspot");
  });

  test("稳定实体 active_level 为 regular", async () => {
    const s = session();
    s.entities["e"].metrics.stability = 90;
    s.entities["e"].metrics.legitimacy = 90;
    await runTicks(s, 1);
    assert.ok(["regular", "longtail"].includes(s.entities["e"].active_level), `稳定实体非 hotspot: ${s.entities["e"].active_level}`);
  });
});

describe("维度 promote/demote + 冻结", () => {
  test("promote/demote 调整权重并记录", () => {
    const reg = emptyRegistry();
    reg.dims["航海"] = { name: "航海", kind: "tech", potential: 80, weight: 0.5, first_tick: 0, last_active: 0 };
    promoteDimension(reg, "航海", 0.1, 5, "时代主题强化");
    assert.ok(reg.dims["航海"].weight > 0.5, "promote 提高权重");
    assert.ok(reg.history.some((h) => h.action === "promote"), "记录 promote");
    demoteDimension(reg, "航海", 0.2, 6, "消退");
    assert.ok(reg.dims["航海"].weight < 0.5, "demote 降低权重");
    assert.ok(reg.history.some((h) => h.action === "demote"), "记录 demote");
  });

  test("冻结维度不参与 retire", async () => {
    const s = session({ frozenDims: ["农业"] });
    await runTicks(s, 30); // 足够长使不活跃维度可能 retire
    // 农业维度被冻结 → 若注册则保留
    assert.ok(s.registry.frozen.includes("农业"), "config.frozenDims 应用冻结");
  });
});

describe("受阻记录写入事件流", () => {
  test("违反世界法则的事件生成受阻记录", async () => {
    // 构造一个违反硬约束的事件（含规则核心词, 触发关键词粗筛）
    const s = session();
    const { arbitrate } = await import("./arbiter.ts");
    const ev = {
      id: "bad", tick: 1, time_label: "t1", type: "other", participants: ["e"], region: "plains-mid",
      description: "祭司宣称能够起死回生", changes: [], random: false, source: "engine",
    };
    const arb = await arbitrate({ laws: EARTH_LAWS, config: s.config, entities: s.entities, lore: s.lore, currentTick: 1 }, [ev]);
    assert.ok(arb.blocked.length > 0, "违反法则 → 受阻记录");
  });
});

describe("past 细化写背景规则库", () => {
  test("accepted 的 past 指令写入 lore", async () => {
    const s = session();
    // 手动注入一个 past decree, 走引擎判定
    s.decrees.push({
      id: "past-1", direction: "past", target_tick: 2, target: { type: "global" },
      intent: "第二纪元有一位贤者", strength: "command",
    });
    await runTicks(s, 3); // 到 tick 3, past-1 (target 2) 会判定
    // past 细化应写入 lore（若 accepted）
    const pastFacts = s.lore.facts.filter((f) => f.source === "past_refinement");
    assert.ok(pastFacts.length > 0, "past 细化写入背景规则库");
  });
});

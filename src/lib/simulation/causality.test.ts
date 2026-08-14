// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 因果链回填测试 — causals 补齐（改动 1）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createSession, makeEntity, runTicks, defaultRegions } from "./engine.ts";
import { deriveRegionResources } from "./physics.ts";
import { causalCandidates, backfillCausals } from "./causality.ts";
import type { SimulationEvent, SimulationSession } from "./types.ts";

function sampleSession() {
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
    config: { seed: 1, randomness: 0, surprise: 0, rigor: 0.8, budget: { perEntity: 4000, perTickGlobal: 100000, hotspotMultiplier: 4 } },
  });
}

function makeEv(overrides: Partial<SimulationEvent> & { id: string; tick: number }): SimulationEvent {
  return {
    time_label: `tick ${overrides.tick}`,
    type: "cultural",
    participants: ["e1"],
    region: "coast-east",
    description: "test",
    changes: [],
    random: false,
    source: "engine",
    ...overrides,
  };
}

describe("因果链回填 — causalCandidates", () => {
  test("同实体的机制性事件被选为前因", () => {
    const session = sampleSession();
    session.events.push(
      makeEv({ id: "old-famine", tick: 1, type: "disaster", changes: [{ entity: "e1", metrics: { population: -1000 } }] }),
      makeEv({ id: "old-routine", tick: 1, type: "other", description: "例行", changes: [] }),
    );
    const current = makeEv({ id: "now", tick: 3, type: "recovery", changes: [{ entity: "e1", metrics: { population: 500 } }] });
    const candidates = causalCandidates(session, current);
    assert.deepEqual(candidates.map((c) => c.id), ["old-famine"], "同实体机制事件入选, 例行排除");
  });

  test("同区域事件次之（无同实体时）", () => {
    const session = sampleSession();
    // 同区域(coast-east)但非 e1 参与
    session.events.push(
      makeEv({ id: "region-ev", tick: 1, type: "disaster", participants: ["e2"], region: "coast-east", changes: [{ entity: "e2", metrics: { stability: -5 } }] }),
      makeEv({ id: "other-region", tick: 1, type: "disaster", participants: ["e2"], region: "plains-mid", changes: [{ entity: "e2", metrics: { stability: -5 } }] }),
    );
    const current = makeEv({ id: "now", tick: 3, type: "recovery", changes: [{ entity: "e1", metrics: { stability: 5 } }] });
    const candidates = causalCandidates(session, current);
    assert.deepEqual(candidates.map((c) => c.id), ["region-ev"], "同区域入选, 异地排除");
  });

  test("max 限制条数", () => {
    const session = sampleSession();
    for (let t = 1; t <= 4; t++) {
      session.events.push(makeEv({ id: `f${t}`, tick: t, type: "disaster", changes: [{ entity: "e1", metrics: { population: -10 } }] }));
    }
    const current = makeEv({ id: "now", tick: 5 });
    assert.equal(causalCandidates(session, current).length, 2, "默认 max 2");
    assert.equal(causalCandidates(session, current, 3).length, 3, "max 3");
  });

  test("首个事件无前因", () => {
    const session = sampleSession();
    const current = makeEv({ id: "now", tick: 1 });
    assert.deepEqual(causalCandidates(session, current), [], "tick1 无更早事件");
  });
});

describe("因果链回填 — backfillCausals", () => {
  test("对 accepted 事件回填, 生成器自带 causals 不覆盖", () => {
    const session = sampleSession();
    session.events.push(makeEv({ id: "old", tick: 1, type: "disaster", changes: [{ entity: "e1", metrics: { population: -1000 } }] }));
    const a = makeEv({ id: "a", tick: 2, type: "recovery", changes: [{ entity: "e1", metrics: { population: 500 } }] });
    const b = makeEv({ id: "b", tick: 2, type: "cultural", causals: ["hand-written"] });
    backfillCausals(session, [a, b]);
    assert.deepEqual(a.causals, ["old"], "a 回填前因");
    assert.deepEqual(b.causals, ["hand-written"], "b 自带 causals 不覆盖");
  });

  test("端到端: runTicks 后事件带 causals 且指向真实存在的事件 id", async () => {
    const session = sampleSession();
    // 用一个触发结构性变化的 agent 产出, 让事件有机制后果
    const mock = {
      real: true,
      call: async ({ userMessage }) => {
        if (userMessage.includes("实体卡片")) {
          return JSON.stringify({ decisions: [], events: [{ type: "旱灾", description: "大旱导致人口锐减", changes: [{ entity: "e1", metrics: { population: -5000 } }], major: true }], metric_delta: { population: -5000 } });
        }
        return "null"; // 稀有事件: 平静
      },
    };
    await runTicks(session, 3, { agentConfig: { llm: mock }, llm: mock });
    const events = session.events.filter((e) => e.source === "agent");
    assert.ok(events.length >= 1, "有 agent 事件");
    // 第二个 agent 事件应回填前因(如果存在更早的机制事件), 且 causals 指向 session.events 里的真实 id
    for (const ev of events) {
      for (const cid of ev.causals ?? []) {
        assert.ok(session.events.some((e) => e.id === cid), `前因 ${cid} 是已存在事件`);
      }
    }
  });
});

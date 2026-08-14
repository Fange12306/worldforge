/**
 * 持久化 (§二 数据隔离) — 把推演会话存入 <world>/simulation/ 目录。
 *
 * 对应 SIMULATION_DESIGN.md §二：
 * 推演状态存独立 `simulation/` 目录（机器可读），**默认不回写**现有 entries/。
 * 与现有编辑器完全解耦，推演出错不影响正常使用。
 *
 * 目录结构：
 *   <world>/simulation/
 *     config.json     推演参数
 *     session.json    当前会话状态
 *     laws.json       世界法则
 *     space.json      空间全景
 *     registry.json   维度注册表
 *     lore.json       背景规则库
 *     decree.json     干预指令
 *     entities/*.json 实体卡片
 *     events/*.json   每 tick 事件
 *     archive/*.json  历史档案
 *
 * 通过 Tauri IPC（read_file / write_file 等现有命令）落盘。
 * 在 Node/测试环境无 Tauri → 提供内存 fallback。
 */

import type { GeographyUnit, SimulationSession, SpaceRegion } from "./types.ts";
import { buildGeography } from "./geography.ts";

export type PersistenceAdapter = {
  save: (session: SimulationSession, worldPath: string) => Promise<void>;
  load: (worldPath: string) => Promise<SimulationSession | null>;
};

// ── Tauri 适配器（真实落盘）──────────────────────────

async function writeJson(worldPath: string, relPath: string, data: unknown): Promise<void> {
  const { invoke } = await import("../api.ts");
  const content = JSON.stringify(data, null, 2);
  // 专用 simulation 命令（§二 代码隔离, simulation.rs）
  await invoke("simulation_write_file", {
    worldPath,
    relPath,
    content,
  });
}

async function readJson<T>(worldPath: string, relPath: string): Promise<T | null> {
  const { invoke } = await import("../api.ts");
  try {
    const text = await invoke<string>("simulation_read_file", {
      worldPath,
      relPath,
    });
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 把会话切分存为独立文件（§二 目录结构） */
async function saveSessionToDisk(session: SimulationSession, worldPath: string): Promise<void> {
  const { invoke } = await import("../api.ts");
  await writeJson(worldPath, "config.json", session.config);
  await writeJson(worldPath, "laws.json", session.laws);
  await writeJson(worldPath, "space.json", session.regions);
  await writeJson(worldPath, "geography.json", session.geography);
  await writeJson(worldPath, "registry.json", session.registry);
  await writeJson(worldPath, "lore.json", session.lore);
  await writeJson(worldPath, "decree.json", session.decrees);
  await writeJson(worldPath, "session.json", {
    id: session.id,
    world_id: session.world_id,
    current_tick: session.current_tick,
    started_at: session.started_at,
  });
  // 实体逐个存（一个文件一个实体）
  for (const [id, entity] of Object.entries(session.entities)) {
    await writeJson(worldPath, `entities/${id}.json`, entity);
  }
  // 档案
  await writeJson(worldPath, "archive.json", session.archive);
  // 文化-语言系统
  await writeJson(worldPath, "languages.json", session.languages);
  await writeJson(worldPath, "cultures.json", session.cultures);

  // 事件：按 tick 分组存
  const byTick = new Map<number, typeof session.events>();
  for (const ev of session.events) {
    if (!byTick.has(ev.tick)) byTick.set(ev.tick, []);
    byTick.get(ev.tick)!.push(ev);
  }
  const kept = new Set<string>();
  for (const [tick, events] of byTick) {
    const fname = `events/tick-${tick}.json`;
    await writeJson(worldPath, fname, events);
    kept.add(fname);
  }
  // 清理已删除 tick 的残留事件文件（避免重载混入旧引擎/旧会话的事件）
  const listFiles = await invoke<string[]>("simulation_list_files", { worldPath }).catch(() => [] as string[]);
  for (const f of listFiles) {
    // 清理: 过期事件 + 不属于当前会话的旧实体文件（重新初始化后旧世界的实体不能残留）
    const isStaleEvent = f.startsWith("events/") && f.endsWith(".json") && !kept.has(f);
    const isStaleEntity = f.startsWith("entities/") && f.endsWith(".json") && !Object.keys(session.entities).some((id) => f === `entities/${id}.json`);
    if (isStaleEvent || isStaleEntity) {
      await invoke("simulation_remove_file", { worldPath, relPath: f }).catch(() => {});
    }
  }
}

/** 从磁盘加载会话（重建 entities/events/archive 引用） */
async function loadSessionFromDisk(worldPath: string): Promise<SimulationSession | null> {
  const { invoke } = await import("../api.ts");
  const config = await readJson<SimulationSession["config"]>(worldPath, "config.json");
  const laws = await readJson<SimulationSession["laws"]>(worldPath, "laws.json");
  const regions = await readJson<Record<string, unknown>>(worldPath, "space.json");
  const registry = await readJson<SimulationSession["registry"]>(worldPath, "registry.json");
  const lore = await readJson<SimulationSession["lore"]>(worldPath, "lore.json");
  const decrees = await readJson<SimulationSession["decrees"]>(worldPath, "decree.json");
  const meta = await readJson<{ id: string; world_id: string; current_tick: number; started_at: number }>(worldPath, "session.json");
  const archive = await readJson<SimulationSession["archive"]>(worldPath, "archive.json");
  if (!config || !laws) return null;

  // 列出 simulation/ 下的文件（专用命令）
  const listFiles = await invoke<string[]>("simulation_list_files", {
    worldPath,
  }).catch(() => [] as string[]);

  const entities: Record<string, any> = {};
  for (const f of listFiles) {
    if (f.startsWith("entities/") && f.endsWith(".json")) {
      const entity = await readJson(worldPath, f);
      if (entity) entities[(entity as any).id] = entity;
    }
  }

  const events: SimulationSession["events"] = [];
  for (const f of listFiles) {
    if (f.startsWith("events/") && f.endsWith(".json")) {
      const batch = await readJson<SimulationSession["events"]>(worldPath, f);
      if (batch) events.push(...batch);
    }
  }
  events.sort((a, b) => a.tick - b.tick);

  const geography = (await readJson<Record<string, GeographyUnit>>(worldPath, "geography.json"))
    ?? buildGeography((regions ?? {}) as Record<string, SpaceRegion>);

  return {
    id: meta?.id ?? "loaded",
    world_id: meta?.world_id ?? "default",
    current_tick: meta?.current_tick ?? 0,
    laws,
    regions: (regions ?? {}) as SimulationSession["regions"],
    geography,
    entities,
    registry: registry ?? { dims: {}, history: [], frozen: [] },
    lore: lore ?? { facts: [], max_layer: 0 },
    config,
    events,
    decrees: decrees ?? [],
    archive: archive ?? [],
    languages: (await readJson(worldPath, "languages.json")) ?? {},
    cultures: (await readJson(worldPath, "cultures.json")) ?? {},
    started_at: meta?.started_at ?? 0,
  };
}

/** 生产持久化适配器（Tauri） */
export function createDiskPersistence(): PersistenceAdapter {
  return { save: saveSessionToDisk, load: loadSessionFromDisk };
}

// ── 内存适配器（测试/无 Tauri fallback）──────────────

const memoryStore = new Map<string, SimulationSession>();

export function createMemoryPersistence(): PersistenceAdapter {
  return {
    async save(session, worldPath) {
      // 深拷贝存内存（避免引用共享）
      memoryStore.set(worldPath, JSON.parse(JSON.stringify(session)));
    },
    async load(worldPath) {
      const s = memoryStore.get(worldPath);
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },
  };
}

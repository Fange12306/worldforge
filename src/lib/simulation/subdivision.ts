/**
 * 区域多实体自动细分（改动 C）— 区域出现 2+ 活跃实体时, 动态细分下一级。
 *
 * 语义（用户需求）:
 * - 层级深度由文明规模决定: 部落时代只占黄河流域中部, 王国/王朝演化后区域细分更细。
 * - 当某区域出现 2+ 活跃实体, 引擎检测信号 → LLM 判定是否细分 + 切成哪几个命名子区划 + 每实体归属。
 * - 细分建 layer+1 子区划（资源/neighbors 继承父, 透传 shape/position）, 实体 region/territory 重指。
 *
 * 设计（用户拍板）:
 * - 面积由 LLM 给 share、引擎落地; shape/position 影响空间推理但不代入公式（注入 agent 输入）。
 * - 引擎直接调 LLM 生成方案（独立调用, 仿 generateRareEvent）——细分是空间事件牵涉 2+ 实体,
 *   走 territory_claim 会被治理上限门控且混淆"领土扩张"vs"空间细化"。
 * - 防重复细分: 每 SUBDIVISION_INTERVAL tick 全局检查; 候选要求 !subdivided && children.length===0 && layer<5。
 *
 * 依赖: 仿 black-swan 模式——engine import 本模块, 本模块不 import engine, 避免 index 导出环。
 * 纯逻辑 + LLM 注入, 可单测。
 */

import { addTerritory } from "./geography.ts";
import { parseJSONFromLLM, safeCall, type LLMBindings } from "./llm.ts";
import { regionAreaKm2 } from "./scale.ts";
import type { EntityCard, SimulationEvent, SimulationSession, SpaceRegion } from "./types.ts";

/** 全局细分检查间隔（tick）——防每 tick 重复判定 */
export const SUBDIVISION_INTERVAL = 5;

/** 最大细分层级（避免无限细分） */
const MAX_LAYER = 5;

function slugify(name: string): string {
  const s = name.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9一-龥-]/g, "");
  return s.slice(0, 24) || "new";
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ── 建命名子区划（从 applyTerritoryClaims 抽出, 同时维护 regions + geography）──

export type NamedSubregionInput = {
  id: string;
  name: string;
  character?: string;
  share?: number;
  shape?: string;
  position?: string;
};

/**
 * 在父区划下建一个命名子区划, 同时写 session.regions 与 session.geography。
 * 资源/neighbors/环境继承父; layer = 父+1; 返回子区划。若已存在同 id, 返回现有。
 */
export function createNamedSubregion(
  session: SimulationSession,
  parent: SpaceRegion,
  input: NamedSubregionInput,
): SpaceRegion {
  if (session.regions[input.id]) return session.regions[input.id];
  const child: SpaceRegion = {
    id: input.id,
    name: input.name,
    biome: parent.biome,
    resources: parent.resources,
    neighbors: [parent.id],
    connections: parent.connections ? { [parent.id]: { direction: "内", via: "相邻" } } : undefined,
    parent: parent.id,
    layer: Math.max(1, parent.layer + 1),
    refined: true,
    character: input.character ?? `在 ${parent.name} 内的新划区`,
    share: input.share,
    shape: input.shape,
    position: input.position,
  };
  session.regions[input.id] = child;
  parent.children = dedupe([...(parent.children ?? []), input.id]);
  if (session.geography[parent.id]) {
    const parentGeo = session.geography[parent.id];
    session.geography[input.id] = {
      id: input.id,
      name: input.name,
      unitKind: "region",
      biome: parent.biome,
      neighbors: [parent.id],
      parent: parent.id,
      children: [],
      namesByEntity: {},
      resources: parent.resources,
      layer: Math.max(1, (parentGeo.layer ?? 0) + 1),
      refined: true,
      character: child.character,
      shape: child.shape,
      position: child.position,
    };
    parentGeo.children = dedupe([...(parentGeo.children ?? []), input.id]);
  }
  return child;
}

// ── 候选收集 ───────────────────────────────────────────

export type SubdivisionCluster = {
  regionId: string;
  region: SpaceRegion;
  entities: EntityCard[];
};

/**
 * 收集需要评估细分的区域簇。
 * 候选: 活跃实体 ≥2 且共享同一 region; 区域未细分过、无子区划、layer < MAX。
 * 若任一实体 territory 含簇区之外区划 → 该实体已扩张, 细分语义不成立, 跳过。
 */
export function collectSubdivisionClusters(session: SimulationSession): SubdivisionCluster[] {
  const active = Object.values(session.entities).filter((e) => e.status === "active");
  const byRegion = new Map<string, EntityCard[]>();
  for (const e of active) {
    const rid = e.geography.region;
    if (!rid || !session.regions[rid]) continue;
    if (!byRegion.has(rid)) byRegion.set(rid, []);
    byRegion.get(rid)!.push(e);
  }
  const clusters: SubdivisionCluster[] = [];
  for (const [rid, entities] of byRegion) {
    if (entities.length < 2) continue;
    const region = session.regions[rid];
    if (!region || region.subdivided) continue;
    if ((region.children?.length ?? 0) > 0) continue;
    if ((region.layer ?? 0) >= MAX_LAYER) continue;
    // 任一实体已扩张出簇区 → 跳过
    const expanded = entities.some((e) =>
      (e.territory ?? [rid]).some((tid) => tid !== rid),
    );
    if (expanded) continue;
    clusters.push({ regionId: rid, region, entities });
  }
  return clusters;
}

// ── LLM 判定细分方案 ───────────────────────────────────

export type SubdivisionPlan = {
  split: boolean;
  reason?: string;
  subregions: Array<{
    id: string;
    name: string;
    character?: string;
    share?: number;
    shape?: string;
    position?: string;
    /** 归属本子区划的实体 id */
    entities: string[];
  }>;
};

/**
 * 让 LLM 综合判断: 该区域 2+ 实体是否值得细分下一级, 切成哪几个命名子区划, 每实体归属。
 * 返回 null = 不细分（平静/融合）。
 * 无真实 LLM → 程序化 fallback: 按实体数均分("X东部/X西部")。
 */
export async function decideSubdivision(
  session: SimulationSession,
  cluster: SubdivisionCluster,
  tick: number,
  llm?: LLMBindings,
): Promise<SubdivisionPlan | null> {
  const { region, entities } = cluster;
  const area = regionAreaKm2(region, session.laws);
  const entityDesc = entities.map((e) =>
    `${e.name}(${e.identity.species}, 人口${e.metrics.population}, 政体${e.identity.political_form})`,
  ).join("、");

  if (!llm?.real) {
    // 程序化 fallback: 按实体数均分命名子区划
    const n = entities.length;
    if (n < 2) return null;
    const dirs = ["东部", "西部", "中部", "南部", "北部"];
    const subregions = entities.map((e, i) => ({
      id: `${region.id}:${slugify(e.name)}`,
      name: `${region.name}${dirs[i % dirs.length]}`,
      character: `位于${region.name}${dirs[i % dirs.length]}`,
      share: 1 / n,
      entities: [e.id],
    }));
    return { split: true, reason: "区域出现多个实体, 按文明均分细分", subregions };
  }

  const system = [
    `你是架空世界的地理细分决策者。一个区域出现了多个实体, 需要判断是否把该区域细分为更小的命名子区划, 让每个实体归属一块。`,
    `世界: ${session.laws.name}（${session.laws.spatial_scale}）。`,
    `**细分是历史性大动作, 多数情况下区域保持共享即可**——只有当实体确实各自形成独立地域重心时才细分。`,
    `若判断不细分, 输出 {"split": false, "reason": "..."}。`,
    `若细分, 每个子区划给 id(英文 slug)/name(中文)/character(一句地形)/share(占父区比例, 和≤1)/shape(形状)/position(位于父区何处)/entities(归属实体 id 数组, 必须全部覆盖下方列出的实体, 不遗漏不重复)。`,
    `share 与文明规模匹配: 每个实体的核心区占比应与其人口/规模相称。`,
    `输出严格 JSON 单个对象。`,
  ].join("\n");

  const user = [
    `# 区域「${region.name}」`,
    `层级: layer ${region.layer ?? 0}, 面积约 ${Math.round(area).toLocaleString()} 平方公里`,
    `地形: ${region.character ?? region.biome}${region.shape ? `, 形状: ${region.shape}` : ""}${region.position ? `, 位置: ${region.position}` : ""}`,
    ``,
    `# 区域内的活跃实体(${entities.length} 个)`,
    entityDesc,
    ``,
    `# 上下文`,
    `tick ${tick}。该区域是否应细分为更小命名子区划? 若应, 切成哪几块、每块归属哪个实体?`,
  ].join("\n");

  const response = await safeCall(llm, { systemPrompt: system, userMessage: user, maxTokens: 700, json: true });
  if (!response) return null;
  try {
    const parsed = parseJSONFromLLM<SubdivisionPlan>(response);
    if (!parsed || parsed.split !== true) return null;
    // 校验: 实体归属完整覆盖
    const covered = new Set(parsed.subregions?.flatMap((s) => s.entities ?? []));
    const allCovered = entities.every((e) => covered.has(e.id));
    if (!allCovered || (parsed.subregions?.length ?? 0) < 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── 应用细分 ───────────────────────────────────────────

/**
 * 应用细分方案: 建 layer+1 子区划, 实体 region/territory 重指, 置 subdivided, 写事件 + 锁 lore。
 * 返回事件（供事件流/仲裁）; 已细分或方案无效 → null。
 */
export function applySubdivision(
  session: SimulationSession,
  cluster: SubdivisionCluster,
  plan: SubdivisionPlan,
  tick: number,
): SimulationEvent | null {
  if (!plan?.split || (plan.subregions?.length ?? 0) < 2) return null;
  const { region, entities } = cluster;
  if (region.subdivided || (region.children?.length ?? 0) > 0) return null;

  const subregionNames: string[] = [];
  for (const s of plan.subregions) {
    const child = createNamedSubregion(session, region, {
      id: `${region.id}:${s.id ?? slugify(s.name)}`,
      name: s.name,
      character: s.character,
      share: s.share,
      shape: s.shape,
      position: s.position,
    });
    subregionNames.push(s.name);
    // 归属实体重指
    for (const eid of s.entities ?? []) {
      const ent = session.entities[eid];
      if (!ent || ent.status !== "active") continue;
      ent.geography = { ...ent.geography, region: child.id, neighbors: [region.id] };
      ent.territory = addTerritory([], [child.id]);
    }
  }
  region.subdivided = true;

  // 事件（进仲裁, participants = 簇实体, region = 父区）
  const ev: SimulationEvent = {
    id: `subdivide-${tick}-${region.id}`,
    tick,
    time_label: `tick ${tick}`,
    type: "region-subdivide",
    participants: entities.map((e) => e.id),
    region: region.id,
    description: `「${region.name}」因多个文明并存, 细分为 ${subregionNames.join("、")}（各文明分据其地）`,
    changes: entities.map((e) => ({ entity: e.id, stance: "neighbor" })),
    random: false,
    source: "engine",
    major: true,
  };

  // 细化即锁定: 子区划成为已确定世界事实
  for (const s of plan.subregions) {
    const cid = `${region.id}:${s.id ?? slugify(s.name)}`;
    const child = session.regions[cid];
    if (child) {
      session.lore.facts.push({
        id: `lore-subdiv-${tick}-${cid}`,
        axis: "space",
        layer: child.layer,
        scope: cid,
        content: `${child.name}（${child.character ?? child.biome}）, 由「${region.name}」细分而来`,
        source: "refinement",
        locked_tick: tick,
        notes: "多实体区域自动细分",
      });
      if (child.layer > session.lore.max_layer) session.lore.max_layer = child.layer;
    }
  }
  return ev;
}

/**
 * 每 tick 入口: 到间隔则收集候选簇, 逐个 LLM 判定 + 应用。
 * 返回生成的事件（runTicks 加入 tickEvents 走仲裁）。
 */
export async function maybeSubdivideRegions(
  session: SimulationSession,
  tick: number,
  llm?: LLMBindings,
): Promise<SimulationEvent[]> {
  if (tick % SUBDIVISION_INTERVAL !== 0) return [];
  const clusters = collectSubdivisionClusters(session);
  const events: SimulationEvent[] = [];
  for (const cluster of clusters) {
    const plan = await decideSubdivision(session, cluster, tick, llm);
    if (!plan) continue;
    const ev = applySubdivision(session, cluster, plan, tick);
    if (ev) events.push(ev);
  }
  return events;
}

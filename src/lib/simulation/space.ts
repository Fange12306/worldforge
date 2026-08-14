/**
 * 空间交互的传递性模型 (§5.1/§4.0②) — 信息随空间距离衰减。
 *
 * 核心: 实体 A 感知实体 B 的强度 awareness(A→B) = base(行军年) × terrain(地形) × relation(关系)。
 * - 相邻实体获得直接信息, 间接相邻损失信息, 越远损失越多。
 * - 受时代技术水平(λ 右移)与地形(biome 阻隔)影响。
 * - awareness < 0.03 视为不可知(如部落时代美洲对非洲)。
 *
 * 纯函数, 无 LLM, 可单测。复用 scale.ts 的行军时间与 measure.ts 的距离换算。
 */

import type { EntityCard, SimulationSession, SpaceRegion, WorldLaws } from "./types.ts";
import { toKm } from "./measure.ts";

// ── 距离: 区域图 Dijkstra 最短路 ───────────────────────

/** 区域间距离(km)。直接邻接用 distances, 否则用邻接链传播(Dijkstra)。 */
export function regionDistanceKm(
  fromRegionId: string,
  toRegionId: string,
  regions: Record<string, SpaceRegion>,
  world: WorldLaws,
): number {
  if (fromRegionId === toRegionId) return 0;
  // 邻接距离表(只含直接邻居; 无距离数据时用默认 500km 边)
  const adj = new Map<string, Map<string, number>>();
  for (const [id, r] of Object.entries(regions)) {
    const m = new Map<string, number>();
    for (const [nid, d] of Object.entries(r.distances ?? {})) {
      if (regions[nid]) m.set(nid, toKm(world, d));
    }
    for (const nid of r.neighbors ?? []) {
      if (regions[nid] && !m.has(nid)) m.set(nid, 500);
    }
    adj.set(id, m);
  }
  // Dijkstra
  const dist = new Map<string, number>();
  const visited = new Set<string>();
  dist.set(fromRegionId, 0);
  const pq: Array<[string, number]> = [[fromRegionId, 0]];
  while (pq.length > 0) {
    pq.sort((a, b) => a[1] - b[1]);
    const [cur, d] = pq.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === toRegionId) return d;
    for (const [nid, w] of adj.get(cur) ?? []) {
      if (visited.has(nid)) continue;
      const nd = d + w;
      if (nd < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, nd);
        pq.push([nid, nd]);
      }
    }
  }
  // 不连通 → 默认远距(假设每跳 500km × 估计跳数)
  return 500 * 10;
}

// ── 地形修正 ───────────────────────────────────────────

/** biome → 地形阻隔系数(越低越难穿越) */
const TERRAIN_FACTOR: Record<string, number> = {
  plains: 1.0, steppe: 1.0, coast: 1.0,
  forest: 0.85, tundra: 0.7, desert: 0.6,
  mountains: 0.55, ocean: 0.35, space: 0.1,
};
const DEFAULT_TERRAIN = 1.0;

/**
 * 路径地形修正: 从 from 区域到 to 区域的 terrain 因子。
 * 沿最短路逐段连乘两端区域因子几何平均; 任一端 ocean 额外受航海技术缓和。
 */
export function terrainFactor(
  fromRegionId: string,
  toRegionId: string,
  regions: Record<string, SpaceRegion>,
  navalTech = 0,
): number {
  const path = shortestPathRegions(fromRegionId, toRegionId, regions);
  if (path.length <= 1) return 1.0;
  let product = 1.0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = inferBiomeOf(regions[path[i]]?.biome);
    const b = inferBiomeOf(regions[path[i + 1]]?.biome);
    let fa = TERRAIN_FACTOR[a] ?? DEFAULT_TERRAIN;
    let fb = TERRAIN_FACTOR[b] ?? DEFAULT_TERRAIN;
    // 海洋额外受航海技术缓和
    if (a === "ocean" || b === "ocean") {
      const oceanRelief = 0.35 + 0.65 * (navalTech / 100);
      fa *= oceanRelief;
      fb *= oceanRelief;
    }
    product *= Math.sqrt(fa * fb); // 几何平均
  }
  return Math.max(0.05, product);
}

/** 区域最短路(区域 id 序列)。用 BFS(无权图, 各边近似相等)。 */
function shortestPathRegions(
  fromId: string,
  toId: string,
  regions: Record<string, SpaceRegion>,
): string[] {
  if (fromId === toId) return [fromId];
  const prev = new Map<string, string>();
  const queue = [fromId];
  const visited = new Set([fromId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nid of regions[cur]?.neighbors ?? []) {
      if (!regions[nid] || visited.has(nid)) continue;
      visited.add(nid);
      prev.set(nid, cur);
      if (nid === toId) {
        // 回溯路径
        const path = [nid];
        let p = nid;
        while (prev.has(p)) { p = prev.get(p)!; path.unshift(p); }
        return path;
      }
      queue.push(nid);
    }
  }
  return [fromId, toId]; // 不连通, 直接双点(terrain 按直连算)
}

function inferBiomeOf(biome?: string): string {
  if (!biome) return "plains";
  const b = biome.toLowerCase();
  if (["ocean", "sea", "海"].some((k) => b.includes(k))) return "ocean";
  if (["mountain", "山", "矿"].some((k) => b.includes(k))) return "mountains";
  if (["desert", "沙", "漠"].some((k) => b.includes(k))) return "desert";
  if (["forest", "林", "森", "沼泽"].some((k) => b.includes(k))) return "forest";
  if (["tundra", "冰", "雪"].some((k) => b.includes(k))) return "tundra";
  if (["steppe", "草"].some((k) => b.includes(k))) return "steppe";
  if (["coast", "岛", "湾"].some((k) => b.includes(k))) return "coast";
  return "plains";
}

// ── 时代行军速度(km/年) ────────────────────────────────

/** 部落时代基准日行(km/天), 军事技术加速。 */
export function kmPerDay(militaryTech = 0): number {
  return Math.min(40, 15 + (militaryTech / 10) * 5);
}

/** 行军年数: 距离 km / (日行 × 365) */
export function marchYearsKm(distanceKm: number, militaryTech = 0): number {
  return distanceKm / (kmPerDay(militaryTech) * 365);
}

/** 人类可读行军时间 {年, 月, 天} */
export function marchTimeHuman(distanceKm: number, militaryTech = 0): string {
  const years = marchYearsKm(distanceKm, militaryTech);
  if (years < 1 / 365) return "数日";
  if (years < 1) {
    const days = Math.round(years * 365);
    return days < 30 ? `${days} 天` : `${Math.round(days / 30)} 个月`;
  }
  if (years < 2) return `约 ${Math.round(years * 12)} 个月`;
  return `约 ${Math.round(years)} 年`;
}

// ── awareness 感知强度 ─────────────────────────────────

/** 距离衰减: base = 0.8 · e^(−t/λ)。λ 随技术右移。 */
function baseDecay(marchYears: number, lambda: number): number {
  return 0.8 * Math.exp(-marchYears / lambda);
}

/** 技术: λ 随航海/生产/制度右移(可达距离翻倍) */
function techLambda(entity: EntityCard): number {
  const t = entity.tech ?? {};
  return 0.5 * (1 + (t["航海"] ?? 0) / 300 + (t["生产"] ?? 0) / 300 + (t["制度"] ?? 0) / 300);
}

/** 关系增益: A→B 的单向关系 */
function relationGain(entity: EntityCard, targetId: string): number {
  const rel = entity.relations?.find((r) => r.target === targetId);
  const stance = rel?.stance ?? "neutral";
  const gains: Record<string, number> = {
    war: 1.6, alliance: 1.5, vassal: 1.4, rival: 1.3, tension: 1.3, neutral: 1.0, absorbed: 1.0,
  };
  return gains[stance] ?? 1.0;
}

/**
 * 实体 A 感知实体 B 的强度 ∈ [0, 0.95]。
 * awareness = base(行军年) × terrain(地形) × relation(关系)。
 */
export function awareness(
  entity: EntityCard,
  targetId: string,
  session: SimulationSession,
): number {
  if (entity.id === targetId) return 1;
  const aRegion = entity.geography.region;
  const bRegion = session.entities[targetId]?.geography.region;
  if (!aRegion || !bRegion) return 0;
  const regions = session.regions ?? {};
  const world = session.laws;

  const distKm = regionDistanceKm(aRegion, bRegion, regions, world);
  const miles = marchYearsKm(distKm, entity.tech?.["军事"] ?? 0);
  const lambda = techLambda(entity);
  const base = baseDecay(miles, lambda);
  const terrain = terrainFactor(aRegion, bRegion, regions, entity.tech?.["航海"] ?? 0);
  const rel = relationGain(entity, targetId);
  return Math.min(0.95, Math.max(0, base * terrain * rel));
}

// ── 分层 ───────────────────────────────────────────────

export type AwarenessTier = "direct" | "indirect" | "legend" | "unknown";

/** 感知强度 → 分层(agent 注入量级) */
export function awarenessTier(a: number): AwarenessTier {
  if (a >= 0.35) return "direct";
  if (a >= 0.15) return "indirect";
  if (a >= 0.03) return "legend";
  return "unknown";
}

/** 分层的可读描述(供 prompt) */
export function tierLabel(tier: AwarenessTier): string {
  switch (tier) {
    case "direct": return "直接了解";
    case "indirect": return "间接了解(据说)";
    case "legend": return "远方传说";
    case "unknown": return "完全未知";
  }
}

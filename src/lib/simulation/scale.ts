/**
 * 尺度合理性 (§4.1) — 数值联动的物理常识约束。
 *
 * 解决"沙漠凭空养出千万大军"这类自洽灾难:
 * - 人口密度: 人口 / 区域面积(人/km²), 与时代合理密度上限比较。
 * - 行军时间: 邻接距离 / 时代速度 → 行军 tick 数(agent 决策参考)。
 * - 密度压力: 密度超限 → 稳定/合法压力(物理层软约束)。
 *
 * 纯函数, 无 LLM, 可单测。复用 measure.ts 的单位换算。
 */

import type { EntityCard, SpaceRegion, WorldLaws } from "./types.ts";
import { toKm, toKm2 } from "./measure.ts";

// ── 时代密度上限 ───────────────────────────────────────

/**
 * 时代合理人口密度上限(人/km²)。
 * 由农业技术 + 组织复杂度插值: 部落时代低, 农业王国高, 帝国更高。
 * 参考(现实): 狩猎采集 ~0.5-2, 刀耕火种 ~5-20, 传统农业 ~30-150, 精耕农业 ~200-500。
 */
export function eraDensityCap(
  agricultureTech = 0,
  organization = 0,
): number {
  // 农业技术 0-100 → 密度: 基础 3 + 技术×1.2 + 组织×0.5
  const base = 3 + agricultureTech * 1.2 + organization * 0.5;
  // 上限: 精耕农业帝国约 500 人/km²
  return Math.min(500, Math.max(1, Math.round(base)));
}

// ── 人口密度 ───────────────────────────────────────────

/** 区域面积(平方公里)。无尺寸 → 用食物承载估算(约 1 万 km² 起)。 */
export function regionAreaKm2(region: SpaceRegion, world: WorldLaws): number {
  if (region?.dimensions?.area) {
    return toKm2(world, region.dimensions.area);
  }
  // 无面积数据 → 由食物承载估算(默认区域约 3-10 万 km²)
  const food = region?.resources?.food_capacity ?? 50;
  return 20_000 + food * 1500;
}

/** 人口密度(人/km²) */
export function populationDensity(
  entity: EntityCard,
  region: SpaceRegion,
  world: WorldLaws,
): number {
  const area = regionAreaKm2(region, world);
  if (area <= 0) return 0;
  return entity.metrics.population / area;
}

/** 密度压力(0-1): 密度超上限的程度。≤上限 → 0, 超上限 → 线性到 2 倍为 1。 */
export function densityPressure(
  density: number,
  cap: number,
): number {
  if (cap <= 0) return 0;
  if (density <= cap) return 0;
  return Math.min(1, (density - cap) / cap);
}

// ── 行军时间 ───────────────────────────────────────────

/**
 * 时代行军速度(km/tick)。
 * 部落时代 ~20km/天 × 每 tick 天数; 有军事技术更快。
 * yearsPerTick: 每 tick 年数 → 天数 = yearsPerTick × 365。
 */
export function eraSpeedKmPerTick(
  world: WorldLaws,
  militaryTech = 0,
  yearsPerTick = 10,
): number {
  // 基础日行: 部落 15km, 军事技术加成(每 10 点 +5km), 上限 40km
  const kmPerDay = Math.min(40, 15 + (militaryTech / 10) * 5);
  const daysPerTick = yearsPerTick * 365;
  return kmPerDay * daysPerTick;
}

/**
 * 行军时间(tick): 距离(km) / 时代速度。
 * 返回小数, 供 agent 决策(如 "到邻邦需 0.5 tick", 即半年)。
 */
export function marchTimeTicks(
  distanceKm: number,
  speedKmPerTick: number,
): number {
  if (speedKmPerTick <= 0) return Infinity;
  return distanceKm / speedKmPerTick;
}

/** 邻接距离(公里)。无距离 → 估算 500km。 */
export function neighborDistanceKm(
  region: SpaceRegion,
  neighborId: string,
  world: WorldLaws,
): number {
  const d = region?.distances?.[neighborId];
  if (d) return toKm(world, d); // 距离是世界单位, 用 toKm 换算真实公里(修复: 原 d/1000 对非公里制错误)
  return 500;
}

/** 便捷: 到某邻邦的行军 tick 数 */
export function marchTicksTo(
  region: SpaceRegion,
  neighborId: string,
  world: WorldLaws,
  militaryTech = 0,
  yearsPerTick = 10,
): number {
  const speed = eraSpeedKmPerTick(world, militaryTech, yearsPerTick);
  const distKm = neighborDistanceKm(region, neighborId, world);
  return marchTimeTicks(distKm, speed);
}

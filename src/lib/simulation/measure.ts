/**
 * 度量单位系统 + 空间尺度 + 环境三层。
 *
 * 对应设计讨论：
 * - 空间初始化时尺度确定（大陆面积/长宽/距离）。
 * - 所有度量单位可换算成真实世界单位（世界的自定义单位带 to_si 换算率）。
 * - 地理/气候/生态三层初始确定; 地理固定只细化, 气候长周期慢变, 生态最动态（被文明改变 + 自然演替）。
 *
 * 本模块：
 * 1. 单位换算（世界单位 ↔ 真实 SI 单位）。
 * 2. 空间尺度（大陆尺度 → 各区域尺寸/距离派生）。
 * 3. 环境生成（从大陆尺度 + 区域尺度派生地理/气候/生态）。
 */

import type { MeasurementSystem, RegionDimensions, RegionEnvironment, SpaceRegion, WorldLaws } from "./types.ts";
import { inferBiome } from "./regime.ts";

// ── 单位换算 ──────────────────────────────────────────

/** 世界单位 → 真实单位（SI） */
export function toSI(world: WorldLaws, kind: "length" | "area", value: number): number {
  const ms = world.measurement_system;
  if (!ms) return value; // 无度量系统 → 视为已是真实单位
  const unit = kind === "length" ? ms.length : ms.area;
  return value * unit.to_si;
}

/** 真实单位（SI）→ 世界单位 */
export function fromSI(world: WorldLaws, kind: "length" | "area", siValue: number): number {
  const ms = world.measurement_system;
  if (!ms) return siValue;
  const unit = kind === "length" ? ms.length : ms.area;
  return siValue / unit.to_si;
}

/** 世界的 length 单位 → 公里（人类可读真实单位） */
export function toKm(world: WorldLaws, worldUnits: number): number {
  return toSI(world, "length", worldUnits) / 1000;
}

/** 世界的 area 单位 → 平方公里 */
export function toKm2(world: WorldLaws, worldArea: number): number {
  return toSI(world, "area", worldArea) / 1_000_000;
}

/** 格式化真实距离（人类可读, 自动选 km/m） */
export function formatRealDistance(siMeters: number): string {
  if (siMeters >= 1000) return `${(siMeters / 1000).toFixed(1)} km`;
  return `${Math.round(siMeters)} m`;
}

// ── 空间尺度派生（大陆 → 区域尺寸/距离）──────────────

export type ScaleDeriveOpts = {
  /** 大陆尺度（真实 km） */
  continentKm: { width: number; height: number };
  /** 区域是否大致均匀（否则按 biome 差异分配） */
  uniform?: boolean;
  /** 文明所在地区域 id（§4.0② 分层 LOD: 文明区细 layer 1, 其余次大陆级 layer 0） */
  knownRegionIds?: string[];
};

/**
 * 为一批区域派生确定性尺寸（世界单位）与邻接距离。
 * 从大陆总尺度分配: 区域尺寸由大陆尺度 × 区域占比派生, 邻接距离 = 两区域中心距。
 */
export function deriveRegionScales(
  laws: WorldLaws,
  regions: Record<string, SpaceRegion>,
  opts: ScaleDeriveOpts,
): Record<string, SpaceRegion> {
  const ids = Object.keys(regions);
  const n = ids.length;
  const continentKm = opts.continentKm;

  // 区域网格近似: 把大陆分成 n 块（每块约 width/cols × height/rows）
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW_km = continentKm.width / cols;
  const cellH_km = continentKm.height / rows;

  const ms = laws.measurement_system;
  const updated: Record<string, SpaceRegion> = { ...regions };
  const known = new Set(opts.knownRegionIds ?? []);

  // 点2: 顶层有 share 时按 share 定面积(海洋/大陆各自占比), 否则网格铺开
  const topShareAll = ids.every((id) => typeof updated[id].share === "number");
  const continentAreaKm2 = continentKm.width * continentKm.height;
  const topAreasKm2 = topShareAll
    ? allocateChildAreas(continentAreaKm2, ids.map((id) => ({ id, share: updated[id].share })))
    : null;

  // 给每个区域一个网格坐标（确定性, 从 id 哈希）
  ids.forEach((id, i) => {
    const cx = (i % cols) + 0.5;
    const cy = Math.floor(i / cols) + 0.5;
    let w_km = cellW_km * (0.7 + ((i * 37) % 30) / 100); // 轻微变化
    let h_km = cellH_km * (0.7 + ((i * 53) % 30) / 100);
    if (topAreasKm2) {
      const areaKm2 = topAreasKm2.get(id) ?? (w_km * h_km);
      h_km = w_km > 0 ? areaKm2 / w_km : h_km; // 面积随 share, 宽保持网格
    }

    // 世界单位
    const w_world = ms ? fromSI(laws, "length", w_km * 1000) : w_km;
    const h_world = ms ? fromSI(laws, "length", h_km * 1000) : h_km;
    const area_km2 = w_km * h_km;
    const area_world = ms ? fromSI(laws, "area", area_km2 * 1_000_000) : area_km2;

    // 分层 LOD（§4.0②）: 文明所在地 layer 1(细), 其余次大陆级 layer 0(概略)。
    // 有 parent 的层级区划保留初始化算出的 layer(恒河平原=1, 中游=2); 无 parent 的扁平区按 known 设。
    const isKnown = known.has(id);
    const hasParent = !!updated[id].parent;
    updated[id] = {
      ...updated[id],
      layer: hasParent ? (updated[id].layer ?? 0) : (isKnown ? 1 : 0),
      refined: isKnown,
      dimensions: { width: w_world, height: h_world, area: area_world },
    };

    // 邻接距离 = 网格中心距（世界单位）
    const distances: Record<string, number> = {};
    for (const nb of updated[id].neighbors ?? []) {
      const nbIdx = ids.indexOf(nb);
      if (nbIdx < 0) continue;
      const nx = (nbIdx % cols) + 0.5;
      const ny = Math.floor(nbIdx / cols) + 0.5;
      const dist_km = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2) * cellW_km;
      distances[nb] = ms ? fromSI(laws, "length", dist_km * 1000) : dist_km;
    }
    updated[id].distances = distances;
  });

  return updated;
}

/**
 * 分配子区面积（改动 A + 点 1 修正）。
 *
 * - **有 share**: 按权重归一化到父面积, area_i = parentAreaKm2 × w_i / Σw, Σ子面积 = 父面积。
 * - **无 share**: 按网格铺开 + 自然抖动, 每个子区独立分配, 可小于父/n,
 *   总和 ≤ 父面积（多余 = 父区域内未命名空间/荒野）——"均分网格 ≠ 面积全相等",
 *   部落文明只占华北平原一小片, 其余是无人荒野。
 */
export function allocateChildAreas(
  parentAreaKm2: number,
  kids: { id: string; share?: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (kids.length === 0 || parentAreaKm2 <= 0) return out;
  const hasShare = kids.some((k) => typeof k.share === "number");
  if (hasShare) {
    // 有 share → 归一化到父面积（Σ = 父面积）
    const wSum = kids.reduce((s, k) => s + (k.share ?? 1), 0);
    for (const k of kids) {
      const w = k.share ?? 1;
      out.set(k.id, (parentAreaKm2 * w) / wSum);
    }
    return out;
  }
  // 无 share → 网格铺开 + 抖动, 允许缝隙（Σ ≤ 父面积）
  const cell = parentAreaKm2 / kids.length;
  kids.forEach((k, i) => {
    const jitter = 0.75 + ((i * 37) % 25) / 100; // 0.75-1.0 自然差异
    out.set(k.id, cell * jitter);
  });
  return out;
}

/**
 * 层级区划尺寸/距离派生（§4.0② 有名字的分层区划）:
 * - 顶层(layer 0)用大陆尺度铺网格。
 * - 每个有 children 的节点, 在**自身 dimensions 内**对子区划局部细分——子区划尺寸 = 父面积均分(+哈希抖动),
 *   子间距离 = 局部网格中心距(远小于全球平铺), 子面积总和 ≈ 父面积。
 * - 跨父区划的距离经父节点传导(Dijkstra 已支持, space.ts)。
 */
export function deriveHierarchyScales(
  laws: WorldLaws,
  regions: Record<string, SpaceRegion>,
  continentKm: { width: number; height: number },
): Record<string, SpaceRegion> {
  const ms = laws.measurement_system;
  const updated: Record<string, SpaceRegion> = { ...regions };
  const ids = Object.keys(regions);

  // 1. 顶层(layer 0)用大陆尺度铺网格
  const topLevel = ids.filter((id) => !updated[id].parent);
  if (topLevel.length === 0) return deriveRegionScales(laws, regions, { continentKm });
  const nTop = topLevel.length;
  const cols = Math.ceil(Math.sqrt(nTop));
  const rows = Math.ceil(nTop / cols);
  const cellW_km = continentKm.width / cols;
  const cellH_km = continentKm.height / rows;

  // 改动 A: 顶层面积按 share 归一化(全有 share 时用 share 定面积, 否则网格均分)
  const topShareAll = topLevel.every((id) => typeof updated[id].share === "number");
  const continentAreaKm2 = continentKm.width * continentKm.height;
  const topAreasKm2 = topShareAll
    ? allocateChildAreas(continentAreaKm2, topLevel.map((id) => ({ id, share: updated[id].share })))
    : null;

  topLevel.forEach((id, i) => {
    const cx = (i % cols) + 0.5;
    const cy = Math.floor(i / cols) + 0.5;
    let w_km = cellW_km * (0.7 + ((i * 37) % 30) / 100);
    let h_km = cellH_km * (0.7 + ((i * 53) % 30) / 100);
    if (topAreasKm2) {
      // 面积随 share, 保持宽为网格宽, 高 = area/宽
      const areaKm2 = topAreasKm2.get(id) ?? (w_km * h_km);
      h_km = w_km > 0 ? areaKm2 / w_km : h_km;
    }
    const w_world = ms ? fromSI(laws, "length", w_km * 1000) : w_km;
    const h_world = ms ? fromSI(laws, "length", h_km * 1000) : h_km;
    updated[id] = {
      ...updated[id],
      layer: updated[id].layer ?? 0,
      dimensions: { width: w_world, height: h_world, area: ms ? fromSI(laws, "area", w_km * h_km * 1_000_000) : w_km * h_km },
    };
    // 顶层邻接距离
    const distances: Record<string, number> = {};
    for (const nb of updated[id].neighbors ?? []) {
      const nbIdx = topLevel.indexOf(nb);
      if (nbIdx < 0) continue;
      const nx = (nbIdx % cols) + 0.5;
      const ny = Math.floor(nbIdx / cols) + 0.5;
      const dist_km = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2) * cellW_km;
      distances[nb] = ms ? fromSI(laws, "length", dist_km * 1000) : dist_km;
    }
    updated[id].distances = distances;
  });

  // 2. 递归细分: 每个有父级(parent)的区域, 在父 dimensions 内铺子网格。
  //    不依赖 children 数组——遍历所有 parent===父 的区域, 保证每个区域都有面积。
  const subdivide = (parentId: string): void => {
    const parent = updated[parentId];
    if (!parent.dimensions) return;
    // 所有直接子区划 = parent 指向该父的区域(优先 children, 兜底从 regions 查 parent)
    const kids = (parent.children ?? []).filter((c) => updated[c])
      .concat(ids.filter((id) => updated[id].parent === parentId && !(parent.children ?? []).includes(id)));
    if (kids.length === 0) return;
    const pw = parent.dimensions.width;
    const ph = parent.dimensions.height;
    const kCols = Math.ceil(Math.sqrt(kids.length));
    const kRows = Math.ceil(kids.length / kCols);
    const childW_km = (ms ? toKm(laws, pw) : pw) / kCols;
    const childH_km = (ms ? toKm(laws, ph) : ph) / kRows;

    // 改动 A: 子区面积按 share 分配(无 share → 均分, 兼容旧行为)。
    // 面积决定物理层承载; 宽保持网格, 高 = 面积/宽, 保证面积随 share。
    const parentAreaKm2 = toKm2(laws, parent.dimensions.area);
    const areasKm2 = allocateChildAreas(parentAreaKm2, kids.map((k) => ({ id: k, share: updated[k].share })));

    kids.forEach((kid, ki) => {
      const kx = (ki % kCols) + 0.5;
      const ky = Math.floor(ki / kCols) + 0.5;
      const cw_km = childW_km * (0.8 + ((ki * 37) % 20) / 100);
      // 高由面积决定(面积随 share, 高 = area/宽), 而不是哈希抖动
      const kidAreaKm2 = areasKm2.get(kid) ?? (childW_km * childH_km);
      const ch_km = cw_km > 0 ? kidAreaKm2 / cw_km : childH_km;
      const cw_world = ms ? fromSI(laws, "length", cw_km * 1000) : cw_km;
      const ch_world = ms ? fromSI(laws, "length", ch_km * 1000) : ch_km;
      updated[kid] = {
        ...updated[kid],
        layer: (parent.layer ?? 0) + 1,
        dimensions: { width: cw_world, height: ch_world, area: ms ? fromSI(laws, "area", cw_km * ch_km * 1_000_000) : cw_km * ch_km },
      };
      // 兄弟邻接距离(局部网格中心距)
      const distances: Record<string, number> = {};
      for (const nk of updated[kid].neighbors ?? []) {
        if (!kids.includes(nk) || nk === kid) continue;
        const nki = kids.indexOf(nk);
        const nx = (nki % kCols) + 0.5;
        const ny = Math.floor(nki / kCols) + 0.5;
        const dist_km = Math.sqrt((nx - kx) ** 2 + (ny - ky) ** 2) * childW_km;
        distances[nk] = ms ? fromSI(laws, "length", dist_km * 1000) : dist_km;
      }
      // 连到父(经父传导跨父距离)
      distances[parentId] = distances[parentId] ?? (ms ? fromSI(laws, "length", childW_km * 1000) : childW_km);
      updated[kid].distances = { ...(updated[kid].distances ?? {}), ...distances };
      // 递归细分孙辈
      subdivide(kid);
    });
  };
  for (const id of topLevel) subdivide(id);

  // 2.5 兜底: 仍有区域缺 dimensions(顶层无 parent 但没进 topLevel? 或孤儿)→ 给默认面积
  for (const id of ids) {
    if (!updated[id].dimensions) {
      const w = ms ? fromSI(laws, "length", 500 * 1000) : 500;
      updated[id] = {
        ...updated[id],
        dimensions: { width: w, height: w, area: ms ? fromSI(laws, "area", 500 * 500 * 1_000_000) : 500 * 500 },
      };
    }
  }

  // 3. 父区划连到子区划(双向, 供 Dijkstra 传导)
  for (const id of ids) {
    const r = updated[id];
    for (const c of r.children ?? []) {
      if (!updated[c]) continue;
      updated[id].distances = { ...(updated[id].distances ?? {}), [c]: updated[c].distances?.[id] ?? (ms ? fromSI(laws, "length", 100 * 1000) : 100) };
      updated[c].neighbors = [...(updated[c].neighbors ?? []), id];
    }
  }

  return updated;
}

// ── 环境三层生成（从尺度 + biome 派生）────────────────

/** 气候参数表（由 biome 决定, 物理常识） */
const BIOME_CLIMATE: Record<string, { temp: number; precip: number; seasons: string[]; vegetation: number; arable: number; biodiversity: number }> = {
  coast:     { temp: 16, precip: 800, seasons: ["湿润季", "干燥季"], vegetation: 55, arable: 60, biodiversity: 70 },
  plains:    { temp: 13, precip: 600, seasons: ["春", "夏", "秋", "冬"], vegetation: 50, arable: 75, biodiversity: 45 },
  mountains: { temp: 5,  precip: 1000, seasons: ["雪季", "融季", "生长季", "寒季"], vegetation: 40, arable: 15, biodiversity: 60 },
  desert:    { temp: 24, precip: 100, seasons: ["酷热季", "温和季"], vegetation: 8, arable: 5, biodiversity: 20 },
  steppe:    { temp: 10, precip: 350, seasons: ["雨季", "旱季"], vegetation: 45, arable: 40, biodiversity: 40 },
  forest:    { temp: 12, precip: 900, seasons: ["春", "夏", "秋", "冬"], vegetation: 90, arable: 35, biodiversity: 85 },
  tundra:    { temp: -2, precip: 200, seasons: ["极昼季", "极夜季"], vegetation: 20, arable: 3, biodiversity: 25 },
  ocean:     { temp: 15, precip: 900, seasons: ["风暴季", "平静季"], vegetation: 10, arable: 0, biodiversity: 75 },
  space:     { temp: -100, precip: 0, seasons: ["恒夜"], vegetation: 0, arable: 0, biodiversity: 0 },
};

/** 为区域生成环境三层（从 biome 派生, 确定性） */
export function deriveRegionEnvironment(
  region: SpaceRegion,
  elevationBase = 300,
): RegionEnvironment {
  const std = inferBiome(region.biome);
  const c = BIOME_CLIMATE[std] ?? BIOME_CLIMATE.plains;
  const elevation = std === "mountains" ? 2000 + (elevationBase % 1000)
    : std === "coast" || std === "ocean" ? 50
    : elevationBase;

  return {
    geography: {
      elevation,
      terrain: terrainName(std),
      rivers: std === "plains" || std === "forest" ? 2 : std === "desert" ? 0 : 1,
      coastline: std === "coast" || std === "ocean" ? 200 : 0,
    },
    climate: {
      temperature: c.temp,
      precipitation: c.precip,
      seasons: c.seasons,
      variability: 0.1 + (std === "desert" || std === "tundra" ? 0.2 : 0.05),
    },
    ecology: {
      vegetation: c.vegetation,
      arable_land: c.arable,
      biodiversity: c.biodiversity,
      modified: false,
    },
  };
}

function terrainName(biome: string): string {
  switch (biome) {
    case "coast": return "沿海低地";
    case "plains": return "平原";
    case "mountains": return "山地";
    case "desert": return "沙漠";
    case "steppe": return "草原";
    case "forest": return "林地";
    case "tundra": return "苔原";
    case "ocean": return "海洋";
    case "space": return "星域";
    default: return "未知地形";
  }
}

// ── 环境演化（生态被文明改变 + 自然演替）──────────────

export type EcologyChange = {
  vegetation_delta: number;   // 植被变化（负=砍伐, 正=恢复）
  arable_delta: number;       // 可耕地变化（灌溉/垦殖 → 增, 荒漠化 → 减）
  biodiversity_delta: number; // 多样性变化
  description: string;
};

/**
 * 生态演化（最动态层）:
 * - 文明行为改变生态（砍伐/垦殖/灌溉/战争焦土）——由历史驱动
 * - 自然演替（森林扩张/沙漠化）——慢速自发
 * 返回变化量, 由调用方应用到 region.environment.ecology。
 */
export function evolveEcology(
  env: RegionEnvironment,
  opts: {
    populationPressure?: number;   // 人口压力 → 砍伐/垦殖
    warScorched?: boolean;         // 战争焦土
    agricultureTech?: number;      // 农业技术 → 灌溉/垦殖能力
    longTimescale?: boolean;       // 是否长周期（气候慢变）
  } = {},
): EcologyChange {
  const e = env.ecology;
  const pop = opts.populationPressure ?? 0;
  const agri = opts.agricultureTech ?? 0;

  // 文明改变: 人口压力 → 砍伐/垦殖（生态被历史改变）
  let vegDelta = 0, arabDelta = 0, bioDelta = 0;
  if (pop > 0.8) {
    vegDelta -= 2;
    arabDelta += 3 * (0.5 + agri / 100);
  } else if (pop > 0.4) {
    vegDelta -= 0.5;
    arabDelta += 0.5;
  }
  // 战争焦土
  if (opts.warScorched) {
    vegDelta -= 3;
    bioDelta -= 2;
  }
  // 自然演替（慢速）
  vegDelta += (e.vegetation < 30 ? 0.3 : -0.1);
  // 长周期 → 气候漂移影响生态（沙漠化/森林扩张）
  if (opts.longTimescale && env.climate.variability > 0.15) {
    vegDelta -= 0.5;
    arabDelta -= 0.3;
  }

  // clamp 到 0-100
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const changed = Math.abs(vegDelta) > 0.1 || Math.abs(arabDelta) > 0.1;
  return {
    vegetation_delta: Math.round(clamp(e.vegetation + vegDelta) - e.vegetation),
    arable_delta: Math.round(clamp(e.arable_land + arabDelta) - e.arable_land),
    biodiversity_delta: Math.round(clamp(e.biodiversity + bioDelta) - e.biodiversity),
    description: changed ? "生态环境发生了改变" : "生态保持稳定",
  };
}

// ── 预设度量系统（测试/兜底）──────────────────────────

/** 真实世界度量（米/平方米）——用于测试与世界法则兜底 */
export const EARTH_MEASUREMENT: MeasurementSystem = {
  length: { name: "公里", kind: "length", to_si: 1000 },
  area: { name: "平方公里", kind: "area", to_si: 1_000_000 },
  weight: { name: "吨", kind: "weight", to_si: 1000 },
  volume: { name: "立方米", kind: "volume", to_si: 1 },
  time: { name: "年", kind: "time", to_si: 31_536_000 },
  worldScale: { width: 3000, height: 2500, description: "类地球大陆" },
};

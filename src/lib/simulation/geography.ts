/**
 * 独立地理地图（§4.0②）— 区域 + 自然实体的统一表示 + 命名主观性。
 *
 * - 每个地理单元(区域/山脉/河流/湖泊/海洋)有全局唯一 id。
 * - 名称取决于发现者: namesByEntity[entityId] 记录不同实体称谓, 无则 fallback 默认名。
 * - 记录同级邻接(neighbors) + 上下级关系(parent/children)。
 * - 自然实体 kind 自由字符串, 不预设枚举。
 *
 * 纯函数, 无 LLM, 可单测。
 */

import type { GeographyUnit, SimulationSession, SpaceRegion } from "./types.ts";

/** 从 regions 初始化地理地图（区域 + 可选自然实体）。 */
export function buildGeography(
  regions: Record<string, SpaceRegion>,
  features: GeographyUnit[] = [],
): Record<string, GeographyUnit> {
  const geography: Record<string, GeographyUnit> = {};
  for (const [id, r] of Object.entries(regions)) {
    geography[id] = {
      id,
      name: r.name ?? id,
      unitKind: "region",
      biome: r.biome,
      neighbors: [...(r.neighbors ?? [])],
      connections: r.connections,
      parent: r.parent,
      children: [],
      namesByEntity: { ...(r.namesByEntity ?? {}) },
      dimensions: r.dimensions,
      environment: r.environment,
      resources: r.resources,
      layer: r.layer,
      refined: r.refined,
      shape: r.shape,
      position: r.position,
    };
  }
  // 自然实体挂到所属区域; 并登记到区域的 children
  for (const f of features) {
    if (geography[f.id]) continue; // 区域 id 冲突
    geography[f.id] = { ...f, namesByEntity: { ...(f.namesByEntity ?? {}) } };
    if (f.region && geography[f.region]) {
      geography[f.region].children = [...(geography[f.region].children ?? []), f.id];
    }
  }
  return geography;
}

/** 实体视角的地理单元名（命名主观性: 有该实体称谓用之, 否则 fallback 默认名）。 */
export function nameFor(
  session: Pick<SimulationSession, "geography" | "regions">,
  unitId: string,
  entityId: string,
): string {
  const unit = session.geography?.[unitId];
  if (unit) {
    return unit.namesByEntity?.[entityId] ?? unit.name;
  }
  // fallback 到 region(兼容未初始化 geography)
  const region = session.regions?.[unitId];
  return region?.namesByEntity?.[entityId] ?? region?.name ?? unitId;
}

// ── 领土工具（实体.territory = 控制的区划 id 列表, 任意层级）──

/** 去重合并领土区划。 */
export function addTerritory(territory: string[] | undefined, ids: string[]): string[] {
  return [...new Set([...(territory ?? []), ...ids])];
}

/** 展开领土: 含子区划的完整区划集合(递归展开 children)。 */
export function expandTerritory(
  territory: string[],
  geography: Record<string, GeographyUnit>,
): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id)) return;
    out.push(id);
    const unit = geography[id];
    for (const c of unit?.children ?? []) visit(c);
  };
  for (const id of territory) visit(id);
  return out;
}

/** 领土总面积(km²)。用 dimensions, 无则 scale 兜底(简化: 每区划面积累加)。 */
export function territoryArea(
  territory: string[],
  geography: Record<string, GeographyUnit>,
  areaOf: (unit: GeographyUnit) => number,
): number {
  let total = 0;
  for (const id of territory) {
    const unit = geography[id];
    if (unit) total += areaOf(unit);
  }
  return total;
}

/** 为实体登记对某地理单元的称谓（命名主观性: 发现者用自己语言命名）。 */
export function setNameFor(
  geography: Record<string, GeographyUnit>,
  unitId: string,
  entityId: string,
  name: string,
): void {
  const unit = geography[unitId];
  if (!unit) return;
  unit.namesByEntity = unit.namesByEntity ?? {};
  unit.namesByEntity[entityId] = name;
}

/** 细化地理单元: 生成子单元(parent 指向, layer+1), 同步邻接/children。 */
export function refineGeographyUnit(
  geography: Record<string, GeographyUnit>,
  parentId: string,
  childId: string,
  childName: string,
  childKind?: string,
): GeographyUnit | null {
  const parent = geography[parentId];
  if (!parent) return null;
  const child: GeographyUnit = {
    id: childId,
    name: childName,
    unitKind: childKind ? "feature" : "region",
    kind: childKind,
    biome: childKind ? undefined : parent.biome,
    neighbors: [parentId],
    parent: parentId,
    children: [],
    namesByEntity: {},
    region: childKind ? parentId : undefined,
    resources: parent.resources,
    layer: (parent.layer ?? 0) + 1,
    refined: true,
  };
  geography[childId] = child;
  parent.children = [...(parent.children ?? []), childId];
  parent.neighbors = [...parent.neighbors, childId];
  return child;
}

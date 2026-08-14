/**
 * 从现有词条导入世界法则（§4 法则来源 2 / §4.0）。
 *
 * 对应 SIMULATION_DESIGN.md §4 法则来源：
 * 2. （进阶）从现有世界词条的 `constraints` 字段**导入**——把已有设定自动转成世界法则。
 *
 * 从现有 entries/*.md 的 frontmatter constraints 提取规则，转成 WorldLaws.rules。
 * 通过 Tauri IPC（list_entries / read_entry）读取，纯 lib 可测（mock IPC）。
 */

import type { WorldLaws } from "./types.ts";

export type EntryConstraint = {
  rule: string;
  severity: "hard" | "soft";
  timeline_id?: string;
};

/** 从约束列表生成世界法则的规则层（hard → rules, soft → narrative; 保留 timeline_id 作用域） */
export function constraintsToLaws(
  constraints: EntryConstraint[],
  base: Partial<WorldLaws> = {},
): WorldLaws {
  // §4.3 timeline_id 作用域: 带 timeline_id 的硬约束进 timeline_rules, 无的进通用 rules
  const genericRules = constraints
    .filter((c) => c.severity === "hard" && !c.timeline_id)
    .map((c) => c.rule);
  const scopedRules = constraints
    .filter((c) => c.severity === "hard" && c.timeline_id)
    .map((c) => ({ rule: c.rule, timeline_id: c.timeline_id! }));
  const narrative = constraints
    .filter((c) => c.severity === "soft")
    .map((c) => c.rule);

  return {
    id: base.id ?? "imported",
    name: base.name ?? "从词条导入的世界",
    physics: base.physics ?? {
      food_per_capita: 1,
      pop_growth_base: 0.02,
      military_per_pop: 0.002,
      military_tech_mult: 0.5,
      stability_recovery: 0.02,
      stability_decay: 0.05,
      overpopulation_pressure: 0.05,
    },
    rules: [...(base.rules ?? []), ...genericRules],
    timeline_rules: [...(base.timeline_rules ?? []), ...scopedRules],
    narrative: [...(base.narrative ?? []), ...narrative],
    ontology: base.ontology ?? [],
    spatial_scale: base.spatial_scale ?? "类地球大陆",
  };
}

/** 从 IPC 读取所有词条的约束（§4 法则来源 2） */
export async function importConstraintsFromEntries(
  worldPath: string,
): Promise<EntryConstraint[]> {
  const { invoke } = await import("../api.ts");
  // 列出所有词条
  const entries = await invoke<Array<{ id: string }>>("list_entries", { worldPath });
  const all: EntryConstraint[] = [];
  for (const e of entries) {
    try {
      const entry = await invoke<{ constraints?: EntryConstraint[] }>("read_entry", {
        worldPath,
        entryId: e.id,
      });
      if (entry.constraints?.length) {
        all.push(...entry.constraints);
      }
    } catch {
      // 跳过读取失败的词条
    }
  }
  return all;
}

/** 便捷：直接生成"从词条导入"的世界法则 */
export async function buildLawsFromEntries(
  worldPath: string,
  base: Partial<WorldLaws> = {},
): Promise<WorldLaws> {
  const constraints = await importConstraintsFromEntries(worldPath);
  return constraintsToLaws(constraints, base);
}

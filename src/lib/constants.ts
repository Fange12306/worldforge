export const APP_NAME = "WorldForge";

/** Universal entry types — applicable to any world, any genre.
 *  ⚠️ "event" removed (Phase 5) — events are now standalone timeline entities. */
export const ENTRY_TYPES = [
  "character",    // 人物：角色、生物、存在
  "location",     // 地点：场所、区域、世界
  "organization", // 组织：团体、势力、机构、国家
  "system",       // 体系：魔法/科技/经济/政治/宗教等规则体系
  "artifact",     // 物品：重要物件、圣物、遗物、工具
  "era",          // 纪元：时代、时期、纪年
  "concept",      // 概念：抽象理念、哲学、文化、习俗
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  character: "人物",
  location: "地点",
  organization: "组织",
  system: "体系",
  artifact: "物品",
  era: "纪元",
  concept: "概念",
};

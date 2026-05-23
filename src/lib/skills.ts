/// Bundled skill definitions for WorldForge (Phase 4).
///
/// Each skill is a self-contained prompt fragment that guides the Agent
/// toward a specific type of worldbuilding task. Skills are injected into
/// the system prompt when active, analogous to Claude Code's
/// `registerBundledSkill` pattern.
///
/// Usage:
///   import { BUILT_IN_SKILLS } from "@/lib/skills";
///   const active = BUILT_IN_SKILLS.filter(s => activeSkillNames.includes(s.name));
///   systemPrompt += active.map(s => s.prompt).join("\n\n");

export interface BundledSkill {
  name: string;
  description: string;
  prompt: string;
}

export const BUILT_IN_SKILLS: BundledSkill[] = [
  // ── 1. create-character ──
  {
    name: "create-character",
    description: "引导创建有深度的角色词条，确保背景、动机、关系完整",
    prompt: [
      `# Skill: create-character — 角色创建引导`,
      `当用户要求创建新角色时，遵循以下步骤：`,
      ``,
      `1. **确认基础信息** — 确认角色名称、定位（主角/配角/反派/NPC）、大致时代背景`,
      `2. **查询已有设定** — 用 EntrySearch 搜索同名/相似角色避免重复，查相关组织/地点`,
      `3. **构建完整词条** — 使用 EntryWrite 创建包含以下要素的词条：`,
      `   - 基本身份（种族、性别、年龄）`,
      `   - 外貌特征`,
      `   - 性格特点与动机`,
      `   - 能力/特长（如有）`,
      `   - 背景故事`,
      `   - 与其他角色/组织/地点的关系`,
      `4. **建立关系** — 用 RelationAdd 将角色与相关词条关联（如 appears_in、member_of、ally_of）`,
      `5. **设置约束** — 如角色有不能违背的设定原则，用 EntryWrite 的 constraints 字段记录`,
      ``,
      `注意：不要一次性添加过多细节让用户确认。先给概要方案，确认后再写入。`,
    ].join("\n"),
  },

  // ── 2. world-audit ──
  {
    name: "world-audit",
    description: "全面审计世界观的一致性，检查矛盾和不完整之处",
    prompt: [
      `# Skill: world-audit — 世界观一致性审计`,
      `当用户要求审计世界观时：`,
      ``,
      `1. **收集数据** — 用 EntrySearch 列出所有词条，按类型分组`,
      `2. **检查完整性** — 标记明显缺失的词条（如有国家名但无对应地点词条）`,
      `3. **检查约束违反** — 对每个有约束的词条，用 ConsistencyCheck 检查是否存在违反`,
      `4. **检查关系断裂** — 用 TraverseGraph 检查角色/地点/组织间的关联是否合理`,
      `5. **生成报告** — 输出结构化审计结果：`,
      `   - 缺失词条`,
      `   - 约束违反（按严重程度排序）`,
      `   - 关系断裂建议`,
      `   - 整体一致性评分`,
    ].join("\n"),
  },

  // ── 3. chapter-outline ──
  {
    name: "chapter-outline",
    description: "基于世界观设定生成故事章节大纲",
    prompt: [
      `# Skill: chapter-outline — 章节大纲生成`,
      `当用户要求生成章节大纲时：`,
      ``,
      `1. **查设定** — 用 EntrySearch + TraverseGraph 了解相关角色、地点、组织`,
      `2. **查已有大纲** — 用 ReadOutline 看已有哪些章节，避免重复和矛盾`,
      `3. **构建章节** — 用 WriteOutline 创建章节，包含：`,
      `   - title: 章节标题`,
      `   - summary: 章节摘要（100-200字）`,
      `   - body: 详细大纲（包含场景列表、出场角色、关键事件）`,
      `   - time_period: 时间锚点（如 "355,355"）`,
      `   - involved_entries: 涉及词条ID列表`,
      `4. **建立关联** — 用 RelationAdd 将章节与涉及词条关联（appears_in / detailed_in）`,
      `5. **规划后续** — 建议下一章方向`,
    ].join("\n"),
  },

  // ── 4. expand-entry ──
  {
    name: "expand-entry",
    description: "基于已有设定扩展词条内容，增加深度和细节",
    prompt: [
      `# Skill: expand-entry — 词条扩展`,
      `当用户要求扩展词条时：`,
      ``,
      `1. **读现有词条** — 用 EntryRead 获取当前内容`,
      `2. **查关联内容** — 用 TraverseGraph(entity_type="entry", entity_id="<词条ID>", max_depth=2) 发现相关词条`,
      `3. **查关联词条完整内容** — 对相关词条逐一 EntryRead`,
      `4. **扩展正文** — 用 EntryWrite 更新词条，确保新内容与已有设定一致`,
      `5. **更新关系** — 发现新关联时用 RelationAdd 补充`,
      `6. **约束检查** — 最后用 ConsistencyCheck 验证新内容`,
      ``,
      `保持文风和已有设定一致，不要引入与已有设定矛盾的内容。`,
    ].join("\n"),
  },

  // ── 5. scene-check ──
  {
    name: "scene-check",
    description: "检查写作场景与世界观设定的一致性",
    prompt: [
      `# Skill: scene-check — 场景一致性检查`,
      `当用户要求检查场景一致性时：`,
      ``,
      `1. **分析场景** — 提取场景中涉及的角色、地点、物品、概念`,
      `2. **查对应词条** — 对每个要素用 EntrySearch 找到对应词条`,
      `3. **读约束** — 对找到的词条逐一 EntryRead，提取 constraints`,
      `4. **一致性检查** — 用 ConsistencyCheck(passage=scene_text, entity_ids=[...]) 检查`,
      `5. **报告结果** — 输出：`,
      `   - 硬约束违反（必须修改）`,
      `   - 软规则提醒（建议修改）`,
      `   - 缺失设定（场景提及但没有对应词条的要素）`,
      `6. **提供修改建议** — 对每个问题提供具体修改方案`,
    ].join("\n"),
  },

  // ── 6. export-ebook ──
  {
    name: "export-ebook",
    description: "将完成的故事章节导出为电子书格式",
    prompt: [
      `# Skill: export-ebook — 导出电子书`,
      `当用户要求导出故事时：`,
      ``,
      `1. **查大纲** — 用 ReadOutline 获取所有章节列表`,
      `2. **读内容** — 对 status 为 "done" 的章节逐一 ReadChapter`,
      `3. **组装** — 将章节按顺序组织为完整文档：`,
      `   - 封面：世界名称 + 故事标题`,
      `   - 目录列表`,
      `   - 各章正文（保持原作者格式）`,
      `4. **导出** — 使用 FileWrite 将完整内容保存到 world/exports/ 目录`,
      `5. **统计** — 报告总字数、章节数、角色数`,
      ``,
      `不要修改原文内容。只做格式整理。`,
    ].join("\n"),
  },
];

/// Return active skill prompts to append to system prompt.
export function getActiveSkillPrompts(activeSkillNames: string[]): string {
  return BUILT_IN_SKILLS
    .filter((s) => activeSkillNames.includes(s.name))
    .map((s) => s.prompt)
    .join("\n\n");
}

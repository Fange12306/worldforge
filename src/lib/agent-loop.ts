/**
 * Agent Loop — orchestrates LLM calls + tool execution.
 * Modeled after Claude Code's QueryEngine: stream → tool_use → execute → feed back → repeat.
 */

import { invoke } from "./api";
import { useStore } from "./store";
import type { Entry } from "./types";
import { BUILT_IN_SKILLS } from "./skills";

// ── Types ──

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolResult = {
  toolUseId: string;
  toolName?: string;
  content: string;
};

// ── Stream callback ──

export type StreamCallbacks = {
  onTextDelta: (text: string) => void;
  onThinkingDelta: (text: string) => void;
  onThinkingDone: () => void;
  onToolUse: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolResult: (result: ToolResult, toolName?: string) => void;
  onComplete: (finalText: string, thinking: string) => void;
  onError: (error: string) => void;
};

// ── Tool implementations ──

const tools: ToolDef[] = [
  {
    name: "EntryRead",
    description: "Read a full setting entry by ID. Returns the complete frontmatter and body content.",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "The entry ID (derived from name, e.g. '艾琳-暗月')" },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "EntrySearch",
    description: "Search entries by name/type/tag. Returns {id, name, type, path, tags} — usually enough info. Only call EntryRead on results you need full body for.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword. Leave empty to list all entries. Use entry name, type label (人物/地点/组织 etc), or tag." },
        entry_type: { type: "string", description: "Optional: filter by entry type slug (character/location/organization/system/artifact/era/concept)" },
      },
      required: [],
    },
  },
  {
    name: "EntryWrite",
    description: "Create or update a setting entry. Pass entry_id to update, omit to create. IMPORTANT: put all generated setting details into the 'body' parameter as markdown — chat text is NOT saved to the file.",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "Existing entry ID (omit to create new)" },
        name: { type: "string", description: "Entry display name" },
        entry_type: { type: "string", description: "Entry type. Required for new entries." },
        body: { type: "string", description: "Markdown body content" },
      },
      required: ["name"],
    },
  },
  {
    name: "WebSearch",
    description: "Search the web. Returns titles, URLs, and snippets. Use WebFetch to read full content of a specific URL.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "integer", description: "Number of results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "WebFetch",
    description: "Fetch and extract readable text content from a URL. Use after WebSearch to read full articles.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "GrepEntries",
    description: "Full-text search in entry files. Returns {path, matches: [\"line#: text\"]}. Line excerpts usually sufficient — only EntryRead results you need full body for.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Keyword or text to search for in entry files" },
        max_results: { type: "integer", description: "Max results (default 20)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "EntryLink",
    description: "Create a relationship between two entries. Adds bidirectional links to both entries' frontmatter.",
    input_schema: {
      type: "object",
      properties: {
        from_id: { type: "string", description: "Source entry ID" },
        to_id: { type: "string", description: "Target entry ID" },
        relation: { type: "string", description: "关系描述（如 '弟子'、'位于'、'持有'）" },
      },
      required: ["from_id", "to_id", "relation"],
    },
  },
  {
    name: "SceneAnalyze",
    description: "Analyze a story scene for narrative structure, character motivation, pacing, and foreshadowing. Does not modify any files.",
    input_schema: {
      type: "object",
      properties: {
        scene_text: { type: "string", description: "The scene text to analyze" },
        aspect: { type: "string", description: "What to analyze: 'structure', 'characters', 'pacing', 'foreshadowing', or 'all'" },
      },
      required: ["scene_text"],
    },
  },
  {
    name: "ListFiles",
    description: "List files in the world directory (excludes entries/). Use BEFORE FileRead to see what files exist.",
    input_schema: {
      type: "object",
      properties: {
        subdir: { type: "string", description: "Optional subdirectory to list (e.g., 'drafts', 'outline')" },
      },
      required: [],
    },
  },
  {
    name: "ReadOutline",
    description: "List all chapters in the story outline. Returns chapter order, title, status (outline/drafting/done), summary, and whether it has body text.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "ReadChapter",
    description: "Read the full content (including body text) of a specific chapter by its order number.",
    input_schema: {
      type: "object",
      properties: {
        chapter_order: { type: "number", description: "Chapter order number (1, 2, 3...)" },
      },
      required: ["chapter_order"],
    },
  },
  {
    name: "WriteOutline",
    description: "Create or update a chapter in the outline. IMPORTANT: put the actual chapter text into the 'body' parameter — chat text alone is NOT saved. Only pass the fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        chapter_order: { type: "number", description: "Chapter order number (1, 2, 3...)" },
        title: { type: "string", description: "Chapter title" },
        status: { type: "string", description: "Chapter status: 'outline', 'drafting', or 'done'" },
        summary: { type: "string", description: "Brief summary of this chapter" },
        body: { type: "string", description: "The actual chapter text / draft content" },
        time_period: { type: "string", description: "World timeline period, e.g. '355,355' for a single year or '341,349' for a range" },
        involved_entries: { type: "string", description: "Comma-separated entry IDs that appear in this chapter, e.g. '艾琳-暗月,暗月要塞'" },
      },
      required: ["chapter_order", "title"],
    },
  },
  {
    name: "FileRead",
    description: "Read a file from the world directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the world directory (e.g., 'outline.md', 'drafts/chapter1.md')" },
      },
      required: ["path"],
    },
  },
  {
    name: "MemoryRead",
    description: "Read a world memory file. Memories store writing decisions, user feedback, and world-building notes that persist across sessions.",
    input_schema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Memory file name (e.g., '弃用设定.md', or from list_memories)" },
      },
      required: ["file_name"],
    },
  },
  {
    name: "MemoryWrite",
    description: "Write (create or update) a world memory file. Use when the user explicitly approves a setting change, gives feedback you should remember, or when you make a world-building decision that future sessions need to know. REQUIRES PERMISSION.",
    input_schema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Memory file name (kebab-case Chinese, e.g., '暗月教设定决策', '精灵武器约束'). Include .md extension." },
        content: { type: "string", description: "Full markdown content of the memory." },
        description: { type: "string", description: "One-line summary for the MEMORY.md index." },
      },
      required: ["file_name", "content", "description"],
    },
  },
  {
    name: "QueryRelations",
    description: "Find all entities (entries, outline chapters, timeline events) related to a given entity. Pass entity_type as 'entry'/'outline'/'timeline'. Returns edges with from/to/description. Read-only, no permission needed.",
    input_schema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "Entity type: 'entry' (词条), 'outline' (大纲章节), or 'timeline' (时间线事件)" },
        entity_id: { type: "string", description: "Entity ID (e.g., '艾琳-暗月')" },
      },
      required: ["entity_type", "entity_id"],
    },
  },
  {
    name: "RelationAdd",
    description: "Create a relation between two entities. Both can be any type (entry/outline/timeline). REQUIRES PERMISSION. Prefer calling multiple times for 1:N relations rather than one-to-many.",
    input_schema: {
      type: "object",
      properties: {
        from_type: { type: "string", description: "Source entity type: 'entry', 'outline', 'timeline'" },
        from_id: { type: "string", description: "Source entity ID" },
        to_type: { type: "string", description: "Target entity type" },
        to_id: { type: "string", description: "Target entity ID" },
        description: { type: "string", description: "关系描述（如 '弟子'、'持有'、'位于'、'盟友'）" },
      },
      required: ["from_type", "from_id", "to_type", "to_id", "description"],
    },
  },
  {
    name: "RelationRemove",
    description: "Remove a relation between two entities. REQUIRES PERMISSION.",
    input_schema: {
      type: "object",
      properties: {
        from_type: { type: "string", description: "Source entity type" },
        from_id: { type: "string", description: "Source entity ID" },
        to_type: { type: "string", description: "Target entity type" },
        to_id: { type: "string", description: "Target entity ID" },
        description: { type: "string", description: "关系描述" },
      },
      required: ["from_type", "from_id", "to_type", "to_id", "description"],
    },
  },
  {
    name: "TraverseGraph",
    description: "BFS traversal from an entity across the unified relation graph. Returns all reachable entities up to max_depth hops away, with distance and relation info. Use this to discover indirect connections (e.g., 'who else is connected to this character through 2 hops').",
    input_schema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "Starting entity type: 'entry', 'outline', 'timeline', 'event'" },
        entity_id: { type: "string", description: "Starting entity ID" },
        max_depth: { type: "number", description: "Max traversal depth in hops (1 or 2 recommended)", default: 2 },
      },
      required: ["entity_type", "entity_id", "max_depth"],
    },
  },
  {
    name: "ConsistencyCheck",
    description: "Check a passage of text against constraints from relevant entries. Auto-loads constraints via graph traversal from a starting entity, then runs keyword matching. Returns violations with level (hard/soft), rule, passage excerpt, and suggestion. Use when writing/editing content to ensure world consistency.",
    input_schema: {
      type: "object",
      properties: {
        passage: { type: "string", description: "The text passage to check for consistency violations." },
        entity_type: { type: "string", description: "Starting entity type for graph traversal: 'entry', 'outline', 'timeline'. Use with entity_id." },
        entity_id: { type: "string", description: "Starting entity ID for graph traversal. The tool will traverse 1 hop to find related entries and load their constraints." },
        entity_ids: { type: "array", items: { type: "string" }, description: "Alternative: directly specify which entry IDs to load constraints from (skips graph traversal)." },
      },
      oneOf: [
        { required: ["passage", "entity_type", "entity_id"] },
        { required: ["passage", "entity_ids"] },
      ],
    },
  },
  {
    name: "UseSkill",
    description: "Load a workflow guide (skill) for a specific worldbuilding task. Call this when the user asks for guidance on a task that has a matching skill. Returns the full skill prompt with step-by-step instructions. List available skills: call without 'name' argument.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to load (e.g., 'create-character', 'world-audit', 'chapter-outline', 'expand-entry', 'scene-check', 'export-ebook'). Omit to list available skills." },
      },
    },
  },
  // ── Phase 5: Timeline & Event tools ──
  {
    name: "ListTimelines",
    description: "List all timelines in the current world. Returns {id, name, description, is_default, time_format}. Most worlds have exactly one default timeline.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "CreateTimeline",
    description: "Create a new timeline (parallel world). The first timeline is auto-marked as default. You must specify the time format at creation time.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Timeline display name" },
        description: { type: "string", description: "Optional description" },
        time_format_json: { type: "string", description: "Optional JSON TimeFormat. If omitted, uses standard medieval fantasy format." },
      },
      required: ["name"],
    },
  },
  {
    name: "ListEvents",
    description: "List events on a timeline, with optional filters. Returns events sorted by time_point ascending.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID (required)" },
        story_id: { type: "string", description: "Filter by story" },
        entry_id: { type: "string", description: "Filter by entry" },
        chapter_ref: { type: "string", description: "Filter by chapter: 'story_id:order'" },
      },
      required: ["timeline_id"],
    },
  },
  {
    name: "CreateEvent",
    description: "Create a new event on a timeline. Events bridge entries and outline chapters. After creation, linked entries' timeline_summary caches are automatically updated.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID" },
        time_point: { type: "string", description: "8-segment time string, e.g. '000-3-000225-05-00-00-00-00' for era 3, year 225, month 5. Zero-padded." },
        summary: { type: "string", description: "Required: event description" },
        precision: { type: "number", description: "Optional: precision index into time_format.units (0=era, 1=year, 2=month, 3=day, 4=hour, 5=minute, 6=second). Display truncates at this level." },
        linked_entries: { type: "string", description: "Comma-separated list. Each item: '词条ID|该词条视角的简述'. Different entries separated by comma. Example: '黎明号|着陆失败暴露了暗物质侵蚀的后遗症,赵远航|下令返航,新地球|地表信号脉冲导致失败'" },
        linked_chapters: { type: "string", description: "Comma-separated: 'story_id:order,story_id:order'" },
        relationship_changes: { type: "string", description: "Newline-separated: 'entry_a|entry_b|add|ally_of|description\\\\nentry_c|entry_d|delete|enemy_of'" },
      },
      required: ["timeline_id", "time_point", "summary"],
    },
  },
  {
    name: "UpdateEvent",
    description: "Update an existing event. All cascade effects (timeline_summary, relation graph, chapter sync) are triggered automatically.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID" },
        event_id: { type: "string", description: "Event ID" },
        time_point: { type: "string", description: "Updated time_point (optional)" },
        summary: { type: "string", description: "Updated summary (optional)" },
        precision: { type: "number", description: "Updated precision index (optional)" },
        linked_entries: { type: "string", description: "Updated linked_entries (optional)" },
        linked_chapters: { type: "string", description: "Updated linked_chapters (optional)" },
        relationship_changes: { type: "string", description: "Updated relationship_changes (optional)" },
      },
      required: ["timeline_id", "event_id"],
    },
  },
  {
    name: "DeleteEvent",
    description: "Delete an event. All associated relations and caches are cleaned up.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID" },
        event_id: { type: "string", description: "Event ID to delete" },
      },
      required: ["timeline_id", "event_id"],
    },
  },
];

// ── Permission state ──

let writeApproved = false;
let lastConvId: string | null = null;

export type PermissionChoice = "once" | "session" | "deny";

export function resetPermissions(convId?: string) {
  if (convId && convId !== lastConvId) {
    writeApproved = false;
    lastConvId = convId;
  }
}

const WRITE_TOOLS = new Set([
  "EntryWrite", "WriteOutline", "MemoryWrite",
  "RelationAdd", "RelationRemove",
  "CreateEvent", "UpdateEvent", "DeleteEvent",
  "CreateTimeline", "UpdateTimeline", "DeleteTimeline",
]);

async function checkPermission(name: string, input: Record<string, unknown>): Promise<boolean> {
  if (!WRITE_TOOLS.has(name)) return true;
  if (writeApproved) return true;
  return new Promise((resolve) => {
    const labelMap: Record<string, string> = {
      WriteOutline: `Ch${input.chapter_order} ${input.title || ""}`,
      CreateEvent: `事件: ${input.summary || ""}`,
      UpdateEvent: `更新事件: ${input.event_id || ""}`,
      DeleteEvent: `删除事件: ${input.event_id || ""}`,
      CreateTimeline: `时间轴: ${input.name || ""}`,
    };
    const detail = labelMap[name] || `${input.name || input.entry_id || ""}`;
    const evt = new CustomEvent("worldforge-permission", {
      detail: {
        toolName: name,
        details: detail,
        callback: (choice: "once" | "session" | "deny") => {
          if (choice === "session") writeApproved = true;
          resolve(choice !== "deny");
        },
      },
    });
    window.dispatchEvent(evt);
  });
}

// ── Tool executor ──

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  worldPath: string,
  storyId: string,
): Promise<string> {
  // Check permission before write operations
  if (!await checkPermission(name, input)) {
    return `用户拒绝了此操作。请不要重试 ${name}，直接告诉用户操作已被拒绝。`;
  }
  switch (name) {
    case "EntryRead": {
      const entry = await invoke<Entry>("read_entry", {
        worldPath,
        entryId: input.entry_id as string,
      });
      return JSON.stringify(entry, null, 2);
    }
    case "EntrySearch": {
      const entries = await invoke<Entry[]>("list_entries", { worldPath });
      const q = ((input.query as string) || "").toLowerCase().trim();
      const type = input.entry_type as string | undefined;

      const MAX = 200; // PHASE6: 替换为四层压缩 Tier 0/1 轻量返回，消除此上限
      if (!q) {
        if (entries.length > MAX) {
          return `共 ${entries.length} 条，超显示上限。前 ${MAX} 条:\n${JSON.stringify(entries.slice(0, MAX))}\n请用 query 或 entry_type 缩小范围。`;
        }
        return JSON.stringify(entries);
      }

      const filtered = entries.filter((e) => {
        if (type && e.type !== type) return false;
        const matchName = e.name.toLowerCase().includes(q);
        const matchTag = e.tags?.some((t: string) => t.toLowerCase().includes(q));
        const typeLabels: Record<string, string> = {
          character: "人物", location: "地点", organization: "组织",
          system: "体系", artifact: "物品", era: "纪元", concept: "概念",
        };
        const matchType = (typeLabels[e.type] || e.type).includes(q);
        return matchName || matchTag || matchType;
      });
      if (filtered.length > MAX) {
        return `找到 ${filtered.length} 条，超显示上限。前 ${MAX} 条:\n${JSON.stringify(filtered.slice(0, MAX))}\n请缩小搜索范围。`;
      }
      return JSON.stringify(filtered);
    }
    case "EntryWrite": {
      if (input.entry_id) {
        await invoke("update_entry", {
          worldPath,
          entryId: input.entry_id as string,
          name: input.name as string,
          body: (input.body as string) || "",
        });
        return `词条 "${input.name}" 更新成功。`;
      } else {
        const entryType = (input.entry_type as string) || "concept";
        await invoke("create_entry", {
          worldPath,
          name: input.name as string,
          entryType,
        });
        return `词条 "${input.name}" [${entryType}] 创建成功。`;
      }
    }
    case "WebFetch": {
      return await invoke<string>("web_fetch", { url: input.url as string });
    }
    case "WebSearch": {
      const results = await invoke<{ title: string; url: string; snippet: string }[]>(
        "web_search",
        { query: input.query as string, count: (input.count as number) || 5 },
      );
      return results.map((r) => `- ${r.title}\n  ${r.snippet}\n  ${r.url}`).join("\n\n");
    }
    case "GrepEntries": {
      const results = await invoke<{ path: string; matches: string[] }[]>("grep_entries", {
        worldPath,
        pattern: input.pattern as string,
        maxResults: (input.max_results as number) || 20,
      });
      return JSON.stringify(results, null, 2);
    }
    case "EntryLink": {
      return await invoke<string>("link_entries", {
        worldPath,
        fromId: input.from_id as string,
        toId: input.to_id as string,
        relation: input.relation as string,
      });
    }
    case "SceneAnalyze": {
      const analysis = await invoke<{
        word_count: number;
        paragraph_count: number;
        estimated_reading_minutes: number;
        dialogue_ratio: number;
        referenced_entries: string[];
        structure_hints: string[];
      }>("scene_analyze", {
        worldPath,
        sceneText: input.scene_text as string,
      });
      const lines = [
        `字数: ${analysis.word_count} | 段落: ${analysis.paragraph_count} | 预计阅读: ${analysis.estimated_reading_minutes} 分钟`,
        `对话比例: ${Math.round(analysis.dialogue_ratio * 100)}%`,
      ];
      if (analysis.referenced_entries.length > 0) {
        lines.push(`涉及词条: ${analysis.referenced_entries.join(", ")}`);
      }
      if (analysis.structure_hints.length > 0) {
        lines.push(`结构提示:\n${analysis.structure_hints.map((h) => `  - ${h}`).join("\n")}`);
      }
      return lines.join("\n");
    }
    case "ReadOutline": {
      const chapters = await invoke<Array<{
        order: number; title: string; status: string; summary: string; has_body: boolean; word_count: number;
      }>>("read_outline", { worldPath, storyId });
      if (chapters.length === 0) return "暂无大纲章节。";
      return chapters.map((c) => {
        const statusLabel = c.status === "done" ? "✓" : c.status === "drafting" ? "✎" : "○";
        const info = c.has_body ? `${c.word_count}字` : "无正文";
        return `${statusLabel} Ch${c.order} ${c.title} [${info}]${c.summary ? ` — ${c.summary}` : ""}`;
      }).join("\n");
    }
    case "ReadChapter": {
      const order = input.chapter_order as number;
      return await invoke<string>("read_chapter", { worldPath, storyId, chapterOrder: order });
    }
    case "WriteOutline": {
      const params: Record<string, unknown> = {
        worldPath, storyId,
        chapterOrder: input.chapter_order as number,
        title: input.title as string,
      };
      if (input.status !== undefined) params.status = input.status as string;
      if (input.summary !== undefined) params.summary = input.summary as string;
      if (input.body !== undefined) params.body = input.body as string;
      if (input.time_period !== undefined) params.timePeriod = input.time_period as string;
      if (input.involved_entries !== undefined) params.involvedEntries = input.involved_entries as string;
      if (input.linked_events !== undefined) params.linkedEvents = input.linked_events as string;
      await invoke("write_outline", params);
      return `Ch${input.chapter_order} 已更新。`;
    }
    case "ListFiles": {
      const files = await invoke<string[]>("list_files", { worldPath, subdir: input.subdir as string || "" });
      return files.length > 0 ? files.join("\n") : "(目录为空或不存在)";
    }
    case "FileRead": {
      return await invoke<string>("read_file", {
        worldPath,
        filePath: input.path as string,
      });
    }
    case "MemoryRead": {
      return await invoke<string>("read_memory", {
        worldPath,
        fileName: input.file_name as string,
      });
    }
    case "MemoryWrite": {
      await invoke("write_memory", {
        worldPath,
        fileName: input.file_name as string,
        content: input.content as string,
        description: input.description as string,
      });
      return "记忆已保存到 world/memory/ 目录。";
    }
    case "QueryRelations": {
      const edges = await invoke<any[]>("query_relations", {
        worldPath,
        entityType: input.entity_type as string,
        entityId: input.entity_id as string,
      });
      if (edges.length === 0) return "该实体没有关联。";
      return edges.map((e) =>
        `[${e.from.type}]${e.from.id} --[${e.description}]--> [${e.to.type}]${e.to.id}`
      ).join("\n");
    }
    case "RelationAdd": {
      const graph = await invoke<any>("add_relation", {
        worldPath,
        fromType: input.from_type as string,
        fromId: input.from_id as string,
        toType: input.to_type as string,
        toId: input.to_id as string,
        description: input.description as string,
      });
      return `关系已建立: [${input.from_type}]${input.from_id} --[${input.description}]--> [${input.to_type}]${input.to_id}`;
    }
    case "RelationRemove": {
      await invoke("remove_relation", {
        worldPath,
        fromType: input.from_type as string,
        fromId: input.from_id as string,
        toType: input.to_type as string,
        toId: input.to_id as string,
        description: input.description as string,
      });
      return `关系已移除: [${input.from_type}]${input.from_id} --[${input.description}]--> [${input.to_type}]${input.to_id}`;
    }
    case "TraverseGraph": {
      const results = await invoke<any[]>("traverse_graph", {
        worldPath,
        entityType: input.entity_type as string,
        entityId: input.entity_id as string,
        maxDepth: input.max_depth as number,
      });
      if (results.length === 0) return "该实体没有关联节点。";
      return results.map((r) =>
        `[${r.entity.type}]${r.entity.id} (距离: ${r.distance}, 经由: [${r.via_entity.type}]${r.via_entity.id} --${r.via_description}--)`
      ).join("\n");
    }
    case "ConsistencyCheck": {
      const passage = input.passage as string;
      // Collect constraint sources — either from graph traversal or direct IDs
      let targetIds: string[];
      if (input.entity_ids && Array.isArray(input.entity_ids)) {
        targetIds = input.entity_ids as string[];
      } else {
        // Traverse 1 hop from starting entity, filter to entries only
        const related = await invoke<any[]>("traverse_graph", {
          worldPath,
          entityType: input.entity_type as string,
          entityId: input.entity_id as string,
          maxDepth: 1,
        });
        const seen = new Set<string>([input.entity_id as string]);
        for (const r of related) {
          if (r.entity.type === "entry") seen.add(r.entity.id);
        }
        targetIds = Array.from(seen);
      }
      // Load constraints from each target entry
      const allConstraints: { rule: string; severity: string }[] = [];
      for (const id of targetIds) {
        try {
          const entry = await invoke<Entry>("read_entry", { worldPath, entryId: id });
          if (entry.constraints && entry.constraints.length > 0) {
            allConstraints.push(...entry.constraints);
          }
        } catch {
          // Silently skip entries that fail to load
        }
      }
      if (allConstraints.length === 0) {
        return "未找到任何约束。请先在词条中定义约束（constraints），或指定有约束的词条。";
      }
      // Run consistency check
      const violations = await invoke<any[]>("check_consistency", {
        passage,
        constraints: allConstraints,
      });
      // Dispatch event for frontend UI
      if (violations.length > 0) {
        window.dispatchEvent(new CustomEvent("worldforge-consistency", {
          detail: { violations, passage },
        }));
      }
      if (violations.length === 0) {
        return `已检查 ${allConstraints.length} 条约束，未发现潜在冲突。`;
      }
      const lines = violations.map((v, i) =>
        `[${i + 1}] [${v.level === "hard" ? "硬约束" : "软约束"}] ${v.rule}\n    涉及段落: ${v.passage}\n    建议: ${v.suggestion}`
      );
      return `发现 ${violations.length} 处潜在冲突:\n\n${lines.join("\n\n")}`;
    }
    case "UseSkill": {
      if (!input.name) {
        return "可用技能:\n" + BUILT_IN_SKILLS.map((s) => `  /${s.name}: ${s.description}`).join("\n");
      }
      const skill = BUILT_IN_SKILLS.find((s) => s.name === input.name);
      if (!skill) {
        return `未找到技能 '${input.name}'。可用技能: ${BUILT_IN_SKILLS.map((s) => s.name).join(", ")}`;
      }
      return `## Skill: ${skill.name}\n\n${skill.description}\n\n${skill.prompt}`;
    }
    // ── Phase 5: Timeline & Event tools ──
    case "ListTimelines": {
      const timelines = await invoke<any[]>("list_timelines", { worldPath });
      return JSON.stringify(timelines, null, 2);
    }
    case "CreateTimeline": {
      const params: Record<string, unknown> = { worldPath, name: input.name as string };
      if (input.description) params.description = input.description;
      if (input.time_format_json) params.timeFormatJson = input.time_format_json;
      const timeline = await invoke<any>("create_timeline", params);
      return `时间轴已创建: ${JSON.stringify(timeline, null, 2)}`;
    }
    case "ListEvents": {
      const params: Record<string, unknown> = {
        worldPath,
        timelineId: input.timeline_id as string,
      };
      if (input.story_id) params.storyId = input.story_id;
      if (input.entry_id) params.entryId = input.entry_id;
      if (input.chapter_ref) params.chapterRef = input.chapter_ref;
      const events = await invoke<any[]>("list_events", params);
      return JSON.stringify(events, null, 2);
    }
    case "CreateEvent": {
      const params: Record<string, unknown> = {
        worldPath,
        timelineId: input.timeline_id as string,
        timePoint: input.time_point as string,
        summary: input.summary as string,
      };
      if (input.precision != null) params.precision = input.precision as number;
      if (input.linked_entries) params.linkedEntries = input.linked_entries;
      if (input.linked_chapters) params.linkedChapters = input.linked_chapters;
      if (input.relationship_changes) params.relationshipChanges = input.relationship_changes;
      const event = await invoke<any>("create_event", params);
      return `事件已创建: ${JSON.stringify(event, null, 2)}`;
    }
    case "UpdateEvent": {
      const params: Record<string, unknown> = {
        worldPath,
        timelineId: input.timeline_id as string,
        eventId: input.event_id as string,
      };
      if (input.time_point) params.timePoint = input.time_point;
      if (input.summary) params.summary = input.summary;
      if (input.precision != null) params.precision = input.precision as number;
      if (input.linked_entries) params.linkedEntries = input.linked_entries;
      if (input.linked_chapters) params.linkedChapters = input.linked_chapters;
      if (input.relationship_changes) params.relationshipChanges = input.relationship_changes;
      const event = await invoke<any>("update_event", params);
      return `事件已更新: ${JSON.stringify(event, null, 2)}`;
    }
    case "DeleteEvent": {
      await invoke("delete_event", {
        worldPath,
        timelineId: input.timeline_id as string,
        eventId: input.event_id as string,
      });
      return "事件已删除。";
    }
    default:
      return `未知工具: ${name}`;
  }
}

// ── Agent Loop ──

export async function runAgentLoop(
  worldPath: string,
  systemPrompt: string,
  conversation: AgentMessage[],
  callbacks: StreamCallbacks,
  provider = "anthropic",
  model = "claude-sonnet-4-20250514",
  storyId = "",
) {
  const MAX_RECOVERY = 3;
  let turns = 0;
  let recoveryCount = 0;
  let fullText = "";
  let thinkingText = "";
  const messages = [...conversation];

  // max_tokens per provider. Each model has a hard API limit on output tokens
  // — exceeding it causes stop_reason="max_tokens" and recovery kicks in.
  // Anthropic requires this param; OpenAI-compatible accepts it optionally.
  const maxTokensByProvider: Record<string, number> = {
    anthropic: 64000,
    openai: 16384,
    deepseek: 8192,
  };
  const maxTokens = maxTokensByProvider[provider] || 64000;

  // Claude Code 做法: 无限循环, 靠自然完成(end_turn)或用户中断退出, 不做硬轮次截断
  while (true) {
    turns++;

    try {
      // Build tool use tracking for this turn
      const pendingToolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let turnText = "";

      // ── Step 1: Set up event listener BEFORE sending API request ──
      // setupStreamListener does dynamic import + Tauri listen, both async.
      // We MUST await it to ensure the listener is registered before stream_chat
      // sends events. Otherwise events arrive before the listener exists → lost.
      let streamDone = false;
      let lastStopReason = "";
      let streamResolve: () => void;
      const streamPromise = new Promise<void>((resolve) => { streamResolve = resolve; });

      const unlisten = await setupStreamListener((event) => {
        if (streamDone) return;
        switch (event.type) {
          case "text_delta":
            turnText += event.text || "";
            callbacks.onTextDelta(event.text || "");
            break;
          case "thinking_delta":
            thinkingText += event.text || "";
            callbacks.onThinkingDelta(event.text || "");
            break;
          case "thinking_done":
            callbacks.onThinkingDone();
            break;
          case "tool_use":
            pendingToolUses.push({
              id: event.id || "",
              name: event.name || "",
              input: (event.input || {}) as Record<string, unknown>,
            });
            callbacks.onToolUse(event.id || "", event.name || "", (event.input || {}) as Record<string, unknown>);
            break;
          case "usage":
            useStore.getState().addTokens(event.input_tokens ?? 0, event.output_tokens ?? 0);
            break;
          case "stream_end":
            streamDone = true;
            lastStopReason = event.stop_reason || "";
            streamResolve();
            break;
          case "error":
            streamDone = true;
            callbacks.onError(event.message || "未知错误");
            streamResolve();
            break;
        }
      });

      // ── Step 2: Send API request (listener is guaranteed ready) ──

      // Claude Code sends ALL tools on EVERY request — no keyword filtering.
      // Tool behavior is constrained by the system prompt, not by hiding tools.
      await invoke("stream_chat", {
        messages,
        systemPrompt: systemPrompt,
        model,
        tools,
        provider,
        maxTokens,
      });

      // Wait for stream to complete
      try { await streamPromise; } catch {}

      // Clean up listener
      unlisten();

      fullText += turnText;

      // Add assistant message to history (may be partial if truncated)
      messages.push({ role: "assistant", content: turnText });

      // Execute all tool calls that arrived — no artificial per-turn cap

      for (const tool of pendingToolUses) {
        try {
          const result = await executeTool(tool.name, tool.input, worldPath, storyId);
          callbacks.onToolResult({ toolUseId: tool.id, toolName: tool.name, content: result }, tool.name);
          messages.push({
            role: "user",
            content: `[工具结果: ${tool.name}]\n${result}`,
          });
        } catch (e: any) {
          messages.push({
            role: "user",
            content: `[工具结果: ${tool.name}]\nError: ${e}`,
          });
        }
      }

      // ── Max tokens recovery (modeled after Claude Code's query.ts) ──
      // Anthropic: stop_reason="max_tokens", OpenAI-compatible: finish_reason="length"
      // Both mean output was truncated. Recovery continues from where it cut off.
      const isTruncated = lastStopReason === "max_tokens" || lastStopReason === "length";
      if (isTruncated && recoveryCount < MAX_RECOVERY) {
        recoveryCount++;
        messages.push({
          role: "user",
          content: `Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces. Do NOT re-read the same entries unless their content has changed this turn.`,
        });
        continue;
      }

      // If no tool calls and no recovery needed, we're done
      if (pendingToolUses.length === 0) {
        callbacks.onComplete(fullText, thinkingText);
        return;
      }
    } catch (e: any) {
      callbacks.onError(String(e));
      return;
    }
  }

  // Should never reach here — loop exits via onComplete/onError return
  callbacks.onComplete(fullText, thinkingText);
}

// ── Tauri event listener helper ──

interface StreamEventPayload {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  message?: string;
  stop_reason?: string;
  input_tokens?: number;
  output_tokens?: number;
}

async function setupStreamListener(
  handler: (event: StreamEventPayload) => void,
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<any>("stream-event", (event) => {
      handler(event.payload);
    });
    return () => unlisten();
  } catch (e) {
    handler({ type: "error", message: `事件系统不可用: ${e}` });
    return () => {};
  }
}

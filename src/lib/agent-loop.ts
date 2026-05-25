/**
 * Agent Loop — orchestrates LLM calls + tool execution.
 * Modeled after Claude Code's QueryEngine: stream → tool_use → execute → feed back → repeat.
 */

import { invoke } from "./api";
import { useStore } from "./store";
import type { Entry } from "./types";
import { estimateTokens } from "./context-window";
import type { ContextBreakdown } from "./context-window";

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
    name: "FinalAnswer",
    description: "Mark the current user request complete after you have already written the full final answer as normal assistant text. This tool has no side effects and should carry no long content.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "EntryRead",
    description: "Read a full setting entry by ID. Returns the complete frontmatter and body content.",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "The entry ID from EntrySearch results. This is a UUID for entries created after v0.6.0, or a legacy name-based slug for older entries. Always use the exact 'id' value returned by EntrySearch — do not derive it from the name yourself." },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "EntrySearch",
    description: "Search entries by name/type/tag, or full-text search entry files. Pass 'pattern' for full-text grep within entry bodies; pass 'query' + optional 'entry_type' for name/type/tag lookup. Returns {id, name, type, path, tags} for name search, or {path, matches} for full-text.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword for name/type/tag lookup. Leave empty to list all entries." },
        entry_type: { type: "string", description: "Optional: filter by entry type slug (character/location/organization/system/artifact/era/concept)" },
        pattern: { type: "string", description: "Full-text search keyword to grep within entry bodies. When set, returns {path, matches} instead of entry list." },
      },
      required: [],
    },
  },
  {
    name: "EntryWrite",
    description: "Create, update, or delete a setting entry. Pass entry_id + delete:true to delete. Pass entry_id to update (creates if missing). Omit entry_id to create new. IMPORTANT: put all generated setting details into the 'body' parameter as markdown — chat text is NOT saved to the file.",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "Existing entry ID. Omit to create new. Required when deleting." },
        delete: { type: "boolean", description: "Set to true to DELETE this entry (requires entry_id). Irreversible." },
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
  // (EntryLink removed — use Relation for all static relationships)
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
    name: "OutlineRead",
    description: "Read the story outline. Pass chapter_order to read a specific chapter's full content; omit to list all chapters with title, status, summary, and word count.",
    input_schema: {
      type: "object",
      properties: {
        chapter_order: { type: "number", description: "Optional: chapter order number to read full body. Omit to list all chapters." },
      },
      required: [],
    },
  },
  {
    name: "OutlineWrite",
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
        linked_events: { type: "string", description: "Comma-separated 'timeline_id:event_id' pairs for linking chapter to timeline events. Format: 'tl-id:evt-id,tl-id:evt-id2'" },
      },
      required: ["chapter_order", "title"],
    },
  },
  {
    name: "FileRead",
    description: "List directory or read a file from the world directory. Omit 'path' to list root directory. Pass a directory path (ending with /) to list that subdirectory. Pass a file path to read its contents.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory path relative to world directory. Omit to list root. End with / for dir listing. Otherwise reads file content." },
      },
      required: [],
    },
  },
  {
    name: "Memory",
    description: "Read, write, or delete a world memory file. Omit 'content' to read; pass 'content' to create or update; pass delete:true to delete. Memories persist across sessions. REQUIRES PERMISSION for write/delete.",
    input_schema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Memory file name (kebab-case Chinese, e.g., '暗月教设定决策'). Include .md extension." },
        content: { type: "string", description: "Full markdown content. Omit to read the file. Pass to create/update." },
        description: { type: "string", description: "One-line summary for the MEMORY.md index. Only needed when writing new files." },
        delete: { type: "boolean", description: "Set to true to DELETE this memory file. Irreversible. REQUIRES PERMISSION." },
      },
      required: ["file_name"],
    },
  },
  {
    name: "ExploreGraph",
    description: "Explore the unified relation graph. Pass mode='direct' to find all entities directly related to a given entity (returns edges with from/to/description). Pass mode='traverse' for BFS multi-hop traversal (returns reachable entities with distance and path info). entity_type: 'entry'/'outline'/'timeline'/'event'. Optionally filter by timeline_id to scope to a specific timeline's events. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "Entity type: 'entry', 'outline', 'timeline', or 'event'" },
        entity_id: { type: "string", description: "Entity ID (e.g., '艾琳-暗月')" },
        mode: { type: "string", description: "'direct' = one-hop neighbors; 'traverse' = BFS multi-hop. Default 'direct'." },
        max_depth: { type: "number", description: "Max traversal depth for mode='traverse' (1 or 2 recommended). Default 2." },
        timeline_id: { type: "string", description: "Restrict to this timeline's edges. When set, returns cross-timeline edges plus edges scoped to this timeline." },
      },
      required: ["entity_type", "entity_id"],
    },
  },
  {
    name: "Relation",
    description: "Create or remove a relation between two entities. Pass delete:true to remove. Both entities can be any type (entry/outline/timeline). REQUIRES PERMISSION.",
    input_schema: {
      type: "object",
      properties: {
        from_type: { type: "string", description: "Source entity type: 'entry', 'outline', 'timeline'" },
        from_id: { type: "string", description: "Source entity ID" },
        to_type: { type: "string", description: "Target entity type" },
        to_id: { type: "string", description: "Target entity ID" },
        description: { type: "string", description: "关系描述（如 '弟子'、'持有'、'位于'、'盟友'）" },
        delete: { type: "boolean", description: "Set to true to REMOVE this relation. REQUIRES PERMISSION." },
      },
      required: ["from_type", "from_id", "to_type", "to_id", "description"],
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
  // ── Phase 5: Timeline & Event tools ──
  {
    name: "ListTimelines",
    description: "List all timelines in the current world. Returns {id, name, description, is_default, time_format}. Most worlds have exactly one default timeline.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "TimelineWrite",
    description: "Create, update, or delete a timeline. Pass timeline_id + delete:true to delete (world must have ≥2 timelines). Pass timeline_id to update an existing timeline. Omit timeline_id to create new. The first timeline in a world is auto-marked as default.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Existing timeline ID. Omit to create new. Required for update/delete." },
        delete: { type: "boolean", description: "Set to true to DELETE this timeline and all its events (requires timeline_id). World must have ≥2 timelines." },
        name: { type: "string", description: "Timeline display name. Required for new timelines." },
        description: { type: "string", description: "Optional description" },
        time_format_json: { type: "string", description: "Optional JSON TimeFormat (only for new timelines). If omitted, uses standard medieval fantasy format." },
        is_default: { type: "boolean", description: "Set as the default timeline (update only)" },
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
    name: "EventWrite",
    description: "Create, update, or delete an event on a timeline. Pass event_name + delete:true to delete. Pass event_name to update (by readable slug within the timeline). Omit event_name to create new. Events bridge entries and outline chapters.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID (required)" },
        event_name: { type: "string", description: "Readable event slug. Set this when creating. Use it to reference the event for update/delete. e.g. '着陆失败-黎明号'" },
        delete: { type: "boolean", description: "Set to true to DELETE this event (requires event_name). Irreversible." },
        time_point: { type: "string", description: "8-segment time string. Required for new events, optional for updates (to move the event). e.g. '000-3-000225-05-00-00-00-00'" },
        summary: { type: "string", description: "Event description. Required for new events." },
        name: { type: "string", description: "Set/change the readable event slug (optional). Only needed when creating or renaming." },
        precision: { type: "number", description: "Optional: precision index into time_format.units (0=era, 1=year, 2=month, 3=day, 4=hour, 5=minute, 6=second). Display truncates at this level." },
        linked_entries: { type: "string", description: "Comma-separated list. Each item: '词条ID|该词条视角的简述'. Example: '黎明号|着陆失败暴露了暗物质侵蚀的后遗症,赵远航|下令返航'" },
        linked_chapters: { type: "string", description: "Comma-separated: 'story_id:order,story_id:order'" },
        relationship_changes: { type: "string", description: "Newline-separated: 'entry_a|entry_b|add|ally_of|description\\\\nentry_c|entry_d|delete|enemy_of'" },
      },
      required: ["timeline_id"],
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
  "EntryWrite", "OutlineWrite", "Memory",
  "EventWrite", "TimelineWrite",
]);

// Destructive — always require per-use confirmation, never approved for session
const DANGEROUS_TOOLS = new Set([
  "Relation",
]);

async function checkPermission(name: string, input: Record<string, unknown>): Promise<boolean> {
  const isWrite = WRITE_TOOLS.has(name) || DANGEROUS_TOOLS.has(name);
  if (!isWrite) return true;

  // Delete operations within Write tools escalate to dangerous (always confirm per use)
  const isDelete = input.delete === true;
  const isDangerous = DANGEROUS_TOOLS.has(name) || isDelete;
  if (isDangerous) {
    return new Promise((resolve) => {
      const labelMap: Record<string, string> = {
        Relation: `${input.delete ? "移除" : "建立"}关联: ${input.description || ""}`,
        EntryWrite: `⚠️ 删除词条: ${input.entry_id || ""}`,
        EventWrite: `⚠️ 删除事件: ${input.event_name || ""}`,
        TimelineWrite: `⚠️ 删除时间轴: ${input.timeline_id || ""}`,
      };
      const label = isDelete ? (labelMap[name] || `⚠️ 删除: ${input.event_name || input.entry_id || input.timeline_id || ""}`) : (input.description || "");
      const evt = new CustomEvent("worldforge-permission", {
        detail: {
          toolName: name,
          details: label,
          isDangerous: true,
          callback: (choice: "once" | "session" | "deny") => {
            resolve(choice !== "deny");
          },
        },
      });
      window.dispatchEvent(evt);
    });
  }

  // Normal write tools: session-level approval
  if (writeApproved) return true;
  return new Promise((resolve) => {
    const labelMap: Record<string, string> = {
      OutlineWrite: `Ch${input.chapter_order} ${input.title || ""}`,
      EventWrite: `事件: ${input.event_name || input.summary || ""}`,
      TimelineWrite: `时间轴: ${input.timeline_id ? "更新 " + input.timeline_id : "创建 " + (input.name || "")}`,
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

// ── Consistency check helper ──
// Runs two-stage semantic check before writes. Hard violations block the write.
async function runConsistencyCheck(
  worldPath: string,
  passage: string,
  entityType: string,
  entityId: string | null,
  timelineId?: string | null,
): Promise<{ hard: string[]; soft: string[] } | null> {
  if (!entityId) return null; // New entities — no graph context yet
  if (!passage || passage.trim().length < 10) return null; // Too short to check

  // Collect related entry IDs via graph traversal
  let targetIds: string[];
  try {
    const related = await invoke<any[]>("traverse_graph", {
      worldPath, entityType, entityId, maxDepth: 1,
    });
    const seen = new Set<string>([entityId]);
    for (const r of related) {
      if (r.entity.type === "entry") seen.add(r.entity.id);
    }
    targetIds = Array.from(seen);
  } catch {
    return null; // Graph traversal failed — skip check
  }

  // Load constraints
  const constraints: { rule: string; severity: string; timeline_id?: string }[] = [];
  for (const id of targetIds) {
    try {
      const entry = await invoke<Entry>("read_entry", { worldPath, entryId: id });
      if (entry.constraints?.length > 0) constraints.push(...entry.constraints);
    } catch { /* skip */ }
  }
  if (constraints.length === 0) return null;

  // Run two-stage check
  let violations: any[];
  try {
    violations = await invoke<any[]>("check_consistency_semantic", {
      passage, constraints, timelineId: timelineId || null,
    });
  } catch {
    return null;
  }

  const hard: string[] = [];
  const soft: string[] = [];
  for (const v of violations) {
    const msg = `[${v.level === "hard" ? "硬约束" : "软约束"}] ${v.rule}\n    判定理由: ${v.reason}`;
    if (v.level === "hard") hard.push(msg);
    else soft.push(msg);
  }

  if (hard.length > 0 || soft.length > 0) {
    window.dispatchEvent(new CustomEvent("worldforge-consistency", {
      detail: { violations, passage },
    }));
  }
  return { hard, soft };
}

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
      const pattern = input.pattern as string | undefined;
      // Full-text grep mode
      if (pattern) {
        const results = await invoke<{ path: string; matches: string[] }[]>("grep_entries", {
          worldPath,
          pattern,
          maxResults: (input.max_results as number) || 20,
        });
        return JSON.stringify(results, null, 2);
      }
      // Name/type/tag search mode
      const entries = await invoke<Entry[]>("list_entries", { worldPath });
      const q = ((input.query as string) || "").toLowerCase().trim();
      const type = input.entry_type as string | undefined;

      const MAX = 200;
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
      const eBody = (input.body as string) || "";
      const eId = input.entry_id as string | undefined;
      // Delete path
      if (input.delete === true) {
        if (!eId) return "❌ 删除词条需要指定 entry_id。";
        await invoke("delete_entry", { worldPath, entryId: eId });
        return `词条 "${eId}" 已删除。`;
      }
      // Consistency check before write (only for updates — new entries have no graph context)
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (eId) {
        ccResult = await runConsistencyCheck(worldPath, eBody, "entry", eId);
        if (ccResult && ccResult.hard.length > 0) {
          return `❌ 硬约束违反，写入已被阻止:\n\n${ccResult.hard.join("\n\n")}\n\n请修改内容后重试。`;
        }
      }
      if (input.entry_id) {
        await invoke("update_entry", {
          worldPath,
          entryId: input.entry_id as string,
          name: input.name as string,
          body: eBody,
        });
        let msg = `词条 "${input.name}" 更新成功。`;
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n⚠️ 软约束提醒:\n${ccResult.soft.join("\n")}`;
        }
        return msg;
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
    case "SceneAnalyze": {
      const params: Record<string, unknown> = {
        worldPath,
        sceneText: input.scene_text as string,
      };
      if (input.aspect) params.aspect = input.aspect;
      const analysis = await invoke<{
        word_count: number;
        paragraph_count: number;
        estimated_reading_minutes: number;
        dialogue_ratio: number;
        referenced_entries: string[];
        structure_hints: string[];
      }>("scene_analyze", params);
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
    case "OutlineRead": {
      const order = input.chapter_order as number | undefined;
      // Read specific chapter
      if (order != null) {
        return await invoke<string>("read_chapter", { worldPath, storyId, chapterOrder: order });
      }
      // List all chapters
      const chapters = await invoke<Array<{
        id: string; order: number; title: string; status: string; summary: string; has_body: boolean; word_count: number;
      }>>("read_outline", { worldPath, storyId });
      if (chapters.length === 0) return "暂无大纲章节。";
      return chapters.map((c) => {
        const statusLabel = c.status === "done" ? "✓" : c.status === "drafting" ? "✎" : "○";
        const info = c.has_body ? `${c.word_count}字` : "无正文";
        return `${statusLabel} Ch${c.order} ${c.title} [${info}] id=${c.id}${c.summary ? ` — ${c.summary}` : ""}`;
      }).join("\n");
    }
    case "OutlineWrite": {
      const chBody = (input.body as string) || "";
      // Consistency check before write: traverse from story via outline entity type
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (chBody.trim().length >= 10) {
        ccResult = await runConsistencyCheck(worldPath, chBody, "outline", storyId);
        if (ccResult && ccResult.hard.length > 0) {
          return `❌ 硬约束违反，写入已被阻止:\n\n${ccResult.hard.join("\n\n")}\n\n请修改内容后重试。`;
        }
      }
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
      let msg = `Ch${input.chapter_order} 已更新。`;
      if (ccResult && ccResult.soft.length > 0) {
        msg += `\n\n⚠️ 软约束提醒:\n${ccResult.soft.join("\n")}`;
      }
      return msg;
    }
    case "FileRead": {
      const fp = input.path as string | undefined;
      // No path or path ending with /: list directory
      if (!fp || fp.endsWith("/")) {
        const subdir = fp ? fp.replace(/\/$/, "") : "";
        const files = await invoke<string[]>("list_files", { worldPath, subdir });
        return files.length > 0 ? files.join("\n") : "(目录为空或不存在)";
      }
      // Read file
      return await invoke<string>("read_file", {
        worldPath,
        filePath: fp,
      });
    }
    case "Memory": {
      const memFile = input.file_name as string;
      // Delete path
      if (input.delete === true) {
        await invoke("delete_memory", { worldPath, fileName: memFile });
        return `记忆 "${memFile}" 已删除。`;
      }
      // Read path: no content provided
      if (!input.content) {
        return await invoke<string>("read_memory", { worldPath, fileName: memFile });
      }
      // Write path
      await invoke("write_memory", {
        worldPath,
        fileName: memFile,
        content: input.content as string,
        description: input.description as string,
      });
      return "记忆已保存到 world/memory/ 目录。";
    }
    case "ExploreGraph": {
      const mode = (input.mode as string) || "direct";
      if (mode === "traverse") {
        const results = await invoke<any[]>("traverse_graph", {
          worldPath,
          entityType: input.entity_type as string,
          entityId: input.entity_id as string,
          maxDepth: (input.max_depth as number) || 2,
          timelineId: input.timeline_id,
        });
        if (results.length === 0) return "该实体没有可达节点。";
        return results.map((r) => {
          const en = r.entity.name || r.entity.id.slice(0, 8);
          const vn = r.via_entity.name || r.via_entity.id.slice(0, 8);
          return `[${r.entity.type}]${en} (距离: ${r.distance}, 经由: [${r.via_entity.type}]${vn} --${r.via_description}--)`;
        }).join("\n");
      }
      const edges = await invoke<any[]>("query_relations", {
        worldPath,
        entityType: input.entity_type as string,
        entityId: input.entity_id as string,
        timelineId: input.timeline_id,
      });
      if (edges.length === 0) return "该实体没有关联。";
      return edges.map((e) => {
        const fn = e.from.name || e.from.id.slice(0, 8);
        const tn = e.to.name || e.to.id.slice(0, 8);
        return `[${e.from.type}]${fn} --[${e.description}]--> [${e.to.type}]${tn}`;
      }).join("\n");
    }
    case "Relation": {
      // Remove path
      if (input.delete === true) {
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
      // Add path
      await invoke("add_relation", {
        worldPath,
        fromType: input.from_type as string,
        fromId: input.from_id as string,
        toType: input.to_type as string,
        toId: input.to_id as string,
        description: input.description as string,
      });
      return `关系已建立: [${input.from_type}]${input.from_id} --[${input.description}]--> [${input.to_type}]${input.to_id}`;
    }
    case "ConsistencyCheck": {
      const passage = input.passage as string;
      const timelineId = input.timeline_id as string | undefined;
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
      const allConstraints: { rule: string; severity: string; timeline_id?: string }[] = [];
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
      // Two-stage semantic consistency check (Rust coarse filter → independent LLM)
      const violations = await invoke<any[]>("check_consistency_semantic", {
        passage,
        constraints: allConstraints,
        timelineId: timelineId || null,
      });
      // Dispatch event for frontend UI
      if (violations.length > 0) {
        window.dispatchEvent(new CustomEvent("worldforge-consistency", {
          detail: { violations, passage },
        }));
      }
      if (violations.length === 0) {
        return `已检查 ${allConstraints.length} 条约束，未发现违反。`;
      }
      const lines = violations.map((v, i) =>
        `[${i + 1}] [${v.level === "hard" ? "硬约束" : "软约束"}] ${v.rule}\n    判定理由: ${v.reason}`
      );
      return `发现 ${violations.length} 处违反:\n\n${lines.join("\n\n")}`;
    }
    // ── Phase 5: Timeline & Event tools ──
    case "ListTimelines": {
      const timelines = await invoke<any[]>("list_timelines", { worldPath });
      return JSON.stringify(timelines, null, 2);
    }
    case "TimelineWrite": {
      const tlId = input.timeline_id as string | undefined;
      // Delete path
      if (input.delete === true) {
        if (!tlId) return "❌ 删除时间轴需要指定 timeline_id。";
        await invoke("delete_timeline", { worldPath, timelineId: tlId });
        return `时间轴 "${tlId}" 已删除。`;
      }
      if (tlId) {
        // Update existing timeline
        const params: Record<string, unknown> = {
          worldPath,
          timelineId: tlId,
        };
        if (input.name) params.name = input.name;
        if (input.description) params.description = input.description;
        if (input.is_default !== undefined) params.isDefault = input.is_default;
        const timeline = await invoke<any>("update_timeline", params);
        return `时间轴已更新: ${JSON.stringify(timeline, null, 2)}`;
      } else {
        // Create new timeline
        const params: Record<string, unknown> = { worldPath, name: input.name as string };
        if (input.description) params.description = input.description;
        if (input.time_format_json) params.timeFormatJson = input.time_format_json;
        const timeline = await invoke<any>("create_timeline", params);
        return `时间轴已创建: ${JSON.stringify(timeline, null, 2)}`;
      }
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
    case "EventWrite": {
      const evTlId = input.timeline_id as string;
      const evName = input.event_name as string | undefined;
      const evSummary = (input.summary as string) || "";
      const hasName = !!evName;
      // Delete path
      if (input.delete === true) {
        if (!evName) return "❌ 删除事件需要指定 event_name。";
        await invoke("delete_event", {
          worldPath,
          timelineId: evTlId,
          eventName: evName,
        });
        return `事件 "${evName}" 已删除。`;
      }
      // Consistency check
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (evSummary.trim().length >= 10) {
        const ccEntityType = hasName ? "event" : "timeline";
        const ccEntityId = hasName ? evName : evTlId;
        ccResult = await runConsistencyCheck(worldPath, evSummary, ccEntityType, ccEntityId, evTlId);
        if (ccResult && ccResult.hard.length > 0) {
          return `❌ 硬约束违反，写入已被阻止:\n\n${ccResult.hard.join("\n\n")}\n\n请修改内容后重试。`;
        }
      }
      if (evName) {
        // Update existing event
        const params: Record<string, unknown> = {
          worldPath,
          timelineId: evTlId,
          eventName: evName,
        };
        if (input.time_point) params.timePoint = input.time_point;
        if (input.summary) params.summary = input.summary;
        if (input.name) params.nameUpdate = input.name;
        if (input.precision != null) params.precision = input.precision as number;
        if (input.linked_entries) params.linkedEntries = input.linked_entries;
        if (input.linked_chapters) params.linkedChapters = input.linked_chapters;
        if (input.relationship_changes) params.relationshipChanges = input.relationship_changes;
        const event = await invoke<any>("update_event", params);
        let msg = `事件已更新: ${JSON.stringify(event, null, 2)}`;
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n⚠️ 软约束提醒:\n${ccResult.soft.join("\n")}`;
        }
        return msg;
      } else {
        // Create new event
        const params: Record<string, unknown> = {
          worldPath,
          timelineId: evTlId,
          timePoint: input.time_point as string,
          summary: evSummary,
        };
        if (input.name) params.name = input.name;
        if (input.precision != null) params.precision = input.precision as number;
        if (input.linked_entries) params.linkedEntries = input.linked_entries;
        if (input.linked_chapters) params.linkedChapters = input.linked_chapters;
        if (input.relationship_changes) params.relationshipChanges = input.relationship_changes;
        const event = await invoke<any>("create_event", params);
        let msg = `事件已创建: ${JSON.stringify(event, null, 2)}`;
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n⚠️ 软约束提醒:\n${ccResult.soft.join("\n")}`;
        }
        return msg;
      }
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
  reasoningEffort?: string,
  convId?: string,
  maxTokensOverride?: number,
) {
  const MAX_RECOVERY = 3;
  let turns = 0;
  let recoveryCount = 0;
  let totalToolUses = 0;
  let finalAnswerNudgeCount = 0;
  let awaitingFinalAnswer = false;
  let fullText = "";
  let thinkingText = "";
  const messages = [...conversation];

  // Tool call cache — deduplicate identical (name, input) pairs within one agent run.
  // Prevents re-executing the same search/read and signals repetition back to the model.
  const toolCache = new Map<string, string>();

  // max_tokens per provider. Each model has a hard API limit on output tokens
  // — exceeding it causes stop_reason="max_tokens" and recovery kicks in.
  // Anthropic requires this param; OpenAI-compatible accepts it optionally.
  // Model config override takes precedence.
  const maxTokensByProvider: Record<string, number> = {
    anthropic: 64000,
    openai: 16384,
    deepseek: 16384,
  };
  const maxTokens = maxTokensOverride || maxTokensByProvider[provider] || 64000;

  // Claude Code 做法: 无限循环, 靠自然完成(end_turn)或用户中断退出, 不做硬轮次截断
  while (true) {
    turns++;

    try {
      // Build tool use tracking for this turn
      const pendingToolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let turnText = "";
      const confirmationTurn = awaitingFinalAnswer;

      // ── Step 1: Set up event listener BEFORE sending API request ──
      // setupStreamListener does dynamic import + Tauri listen, both async.
      // We MUST await it to ensure the listener is registered before stream_chat
      // sends events. Otherwise events arrive before the listener exists → lost.
      let streamDone = false;
      let lastStopReason = "";
      let streamResolve: () => void;
      const streamPromise = new Promise<void>((resolve) => { streamResolve = resolve; });

      const unlisten = await setupStreamListener(convId || "", (event) => {
        if (streamDone) return;
        switch (event.type) {
          case "text_delta":
            turnText += event.text || "";
            if (!confirmationTurn) callbacks.onTextDelta(event.text || "");
            break;
          case "thinking_delta":
            thinkingText += event.text || "";
            if (!confirmationTurn) callbacks.onThinkingDelta(event.text || "");
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
            if (event.name !== "FinalAnswer") {
              callbacks.onToolUse(event.id || "", event.name || "", (event.input || {}) as Record<string, unknown>);
            }
            break;
          case "usage":
            useStore.getState().addTokens(event.input_tokens ?? 0, event.output_tokens ?? 0, convId);
            // Update context window breakdown
            {
              const inputTokens = event.input_tokens ?? 0;
              if (inputTokens > 0) {
                const skillsIdx = systemPrompt.lastIndexOf("# Skills");
                const corePrompt = skillsIdx > 0 ? systemPrompt.slice(0, skillsIdx) : systemPrompt;
                const skillsText = skillsIdx > 0 ? systemPrompt.slice(skillsIdx) : "";
                const msgsText = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
                const toolsText = JSON.stringify(tools);
                const totalChars = msgsText.length + corePrompt.length + skillsText.length + toolsText.length;
                const inputShare = (chars: number) => totalChars > 0
                  ? Math.round(inputTokens * chars / totalChars)
                  : 0;
                const breakdown: ContextBreakdown = {
                  messages: inputShare(msgsText.length),
                  systemTools: inputShare(toolsText.length),
                  mcpTools: 0,
                  systemPrompt: inputShare(corePrompt.length),
                  skills: inputShare(skillsText.length),
                  total: inputTokens,
                };
                useStore.getState().updateContextUsage(inputTokens, breakdown, convId);
              }
            }
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

      try {
        // Claude Code sends ALL tools on EVERY request — no keyword filtering.
        // Tool behavior is constrained by the system prompt, not by hiding tools.
        await invoke("stream_chat", {
          messages,
          systemPrompt: systemPrompt,
          model,
          tools,
          provider,
          maxTokens,
          reasoningEffort: reasoningEffort || null,
          conversationId: convId || null,
        });

        // Wait for stream to complete
        try { await streamPromise; } catch {}
      } finally {
        // Always clean up listener — prevents double-event bugs on interruption
        unlisten();
      }

      if (!confirmationTurn) fullText += turnText;

      const finalAnswerTool = pendingToolUses.find((tool) => tool.name === "FinalAnswer");
      if (finalAnswerTool) {
        if (!fullText.trim()) {
          messages.push({
            role: "user",
            content: `FinalAnswer 只能作为完成标记使用。请先用普通 assistant 文本流式输出完整最终答复，然后再调用 FinalAnswer。`,
          });
          continue;
        }
        callbacks.onComplete(fullText, thinkingText);
        return;
      }

      // Add assistant message to history (may be partial if truncated)
      if (!confirmationTurn) {
        messages.push({ role: "assistant", content: turnText });
      }

      // Execute all tool calls that arrived — no artificial per-turn cap

      totalToolUses += pendingToolUses.length;
      for (const tool of pendingToolUses) {
        if (tool.name === "FinalAnswer") continue;
        awaitingFinalAnswer = false;
        const cacheKey = `${tool.name}::${JSON.stringify(tool.input)}`;
        const cached = toolCache.get(cacheKey);
        if (cached !== undefined) {
          const result = `[缓存 — 与之前相同参数的结果一致，不要再重复调用]\n${cached}`;
          callbacks.onToolResult({ toolUseId: tool.id, toolName: tool.name, content: result }, tool.name);
          messages.push({ role: "user", content: `[工具结果: ${tool.name}]\n${result}` });
          continue;
        }
        try {
          const result = await executeTool(tool.name, tool.input, worldPath, storyId);
          toolCache.set(cacheKey, result);
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
      if (isTruncated) {
        callbacks.onError(`输出被 max_tokens 截断，且 ${MAX_RECOVERY} 次自动续写恢复已用完。`);
        return;
      }

      // If no tool calls and no recovery needed, we're done
      if (pendingToolUses.length === 0) {
        if (totalToolUses > 0 && finalAnswerNudgeCount < 2) {
          finalAnswerNudgeCount++;
          awaitingFinalAnswer = true;
          messages.push({
            role: "user",
            content: `你刚才的普通 assistant 文本已作为候选最终答复展示给用户。现在进入内部确认步骤：如果这份答复已经完整，只调用空参数 FinalAnswer，且不要输出任何普通文本；如果还缺信息，请调用合适工具继续完成任务。`,
          });
          continue;
        }
        if (totalToolUses > 0) {
          callbacks.onError("模型在使用工具后没有调用 FinalAnswer，任务完成状态不明确。");
          return;
        }
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
  conversation_id?: string;
}

const _activeListeners = new Map<string, () => void>();

async function setupStreamListener(
  conversationId: string,
  handler: (event: StreamEventPayload) => void,
): Promise<() => void> {
  // Clean up any previous listener for this same conversation
  const prev = _activeListeners.get(conversationId);
  if (prev) { prev(); _activeListeners.delete(conversationId); }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<any>("stream-event", (event) => {
      const payload = event.payload as StreamEventPayload;
      // Filter: only process events for this conversation
      if (payload.conversation_id !== conversationId) return;
      handler(payload);
    });
    const cleanup = () => { unlisten(); _activeListeners.delete(conversationId); };
    _activeListeners.set(conversationId, cleanup);
    return cleanup;
  } catch (e) {
    handler({ type: "error", message: `事件系统不可用: ${e}` });
    return () => {};
  }
}

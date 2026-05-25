/**
 * Agent Loop — orchestrates LLM calls + tool execution.
 * Modeled after Claude Code's QueryEngine: stream → tool_use → execute → feed back → repeat.
 */

import { invoke } from "./api";
import { useStore } from "./store";
import type { Entry } from "./types";
import { estimateTokens } from "./context-window";
import type { ContextBreakdown } from "./context-window";
import { getT } from "./i18n";

function t() {
  return getT(useStore.getState().language).agent;
}

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

function getTools(): ToolDef[] {
  const ta = t();
  return [
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
    description: "Create, update, or delete a setting entry. CRITICAL: when creating (no entry_id) or updating, you MUST put all generated content into the 'body' parameter as markdown — anything said in chat or thinking is NOT saved to the file.",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "Existing entry ID. Omit to create new. Required when deleting." },
        delete: { type: "boolean", description: "Set to true to DELETE this entry (requires entry_id). Irreversible." },
        name: { type: "string", description: "Entry display name" },
        entry_type: { type: "string", description: "Entry type slug (character/location/organization/system/artifact/era/concept). Required for new entries; can also be used to change an existing entry's type." },
        body: { type: "string", description: "MANDATORY: the entry's full markdown body content. If you don't pass this, the file will be empty. Anything you want to save must go here." },
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
        delete: { type: "boolean", description: "Set to true to DELETE this chapter. Irreversible." },
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
    description: "List, read, write, or delete a world memory file. Omit 'file_name' and 'content' to list all (returns name + description). Omit 'content' to read a specific file; pass 'content' to create or update; pass delete:true to delete. REQUIRES PERMISSION for write/delete.",
    input_schema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Memory file name (kebab-case Chinese, e.g., '暗月教设定决策'). Include .md extension. Omit to list all memories." },
        content: { type: "string", description: "Full markdown content. Omit to read the file. Pass to create/update." },
        description: { type: "string", description: "One-line summary for the MEMORY.md index. Only needed when writing new files." },
        delete: { type: "boolean", description: "Set to true to DELETE this memory file. Irreversible. REQUIRES PERMISSION." },
      },
      required: [],
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
        description: { type: "string", description: ta.relationDesc },
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
    description: "Create, update, or delete an event on a timeline. Pass event_name + delete:true to delete. Pass event_name to update an existing event. Omit event_name to create new (slug auto-generated from summary). Events bridge entries and outline chapters.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID (required)" },
        event_name: { type: "string", description: "Event slug for update/delete reference. Omit when creating new — slug will be auto-generated from summary." },
        delete: { type: "boolean", description: "Set to true to DELETE this event (requires event_name). Irreversible." },
        time_point: { type: "string", description: "8-segment time string. Required for new events, optional for updates (to move the event). e.g. '000-3-000225-05-00-00-00-00'" },
        summary: { type: "string", description: "Event description. Required for new events." },
        precision: { type: "number", description: "Optional: precision index into time_format.units (0=era, 1=year, 2=month, 3=day, 4=hour, 5=minute, 6=second). Display truncates at this level." },
        linked_entries: { type: "string", description: ta.eventLinkedEntries },
        linked_chapters: { type: "string", description: "Comma-separated: 'story_id:order,story_id:order'" },
        relationship_changes: { type: "string", description: "Newline-separated: 'entry_a|entry_b|add|ally_of|description\\\\nentry_c|entry_d|delete|enemy_of'" },
      },
      required: ["timeline_id"],
    },
  },
  ];
}

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
        Relation: t().toolRelation(!!input.delete, (input.description as string) || ""),
        EntryWrite: t().toolEntryWriteDelete((input.entry_id as string) || ""),
        EventWrite: t().toolEventWriteDelete((input.event_name as string) || ""),
        TimelineWrite: t().toolTimelineDelete((input.timeline_id as string) || ""),
      };
      const genericId = (input.event_name || input.entry_id || input.timeline_id || "") as string;
      const label = isDelete ? (labelMap[name] || t().toolGenericDelete(genericId)) : (input.description || "");
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
      EventWrite: t().toolEventLabel((input.event_name as string) || "", (input.summary as string) || ""),
      TimelineWrite: t().toolTimelineLabel((input.timeline_id as string) || "", (input.name as string) || ""),
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
    const msg = `[${v.level === "hard" ? t().hardConstraint : t().softConstraint}] ${v.rule}\n    ${t().constraintReason}: ${v.reason}`;
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
    return t().permissionDenied(name);
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
          const msg = t().searchTooMany(entries.length, MAX);
          const nl = msg.indexOf("\n");
          return nl >= 0
            ? `${msg.slice(0, nl)}\n${JSON.stringify(entries.slice(0, MAX))}\n${msg.slice(nl + 1)}`
            : `${msg}\n${JSON.stringify(entries.slice(0, MAX))}`;
        }
        return JSON.stringify(entries);
      }

      const filtered = entries.filter((e) => {
        if (type && e.type !== type) return false;
        const matchName = e.name.toLowerCase().includes(q);
        const matchTag = e.tags?.some((t: string) => t.toLowerCase().includes(q));
        const typeLabels = getT(useStore.getState().language).entryTypes;
        const matchType = (typeLabels[e.type] || e.type).includes(q);
        return matchName || matchTag || matchType;
      });
      if (filtered.length > MAX) {
        const msg = t().searchFilteredTooMany(filtered.length, MAX);
        const nl = msg.indexOf("\n");
        return nl >= 0
          ? `${msg.slice(0, nl)}\n${JSON.stringify(filtered.slice(0, MAX))}\n${msg.slice(nl + 1)}`
          : `${msg}\n${JSON.stringify(filtered.slice(0, MAX))}`;
      }
      return JSON.stringify(filtered);
    }
    case "EntryWrite": {
      const eBody = (input.body as string) || "";
      const eId = input.entry_id as string | undefined;
      // Delete path
      if (input.delete === true) {
        if (!eId) return t().deleteNeedsId;
        await invoke("delete_entry", { worldPath, entryId: eId });
        return t().entryDeleted(eId);
      }
      // Consistency check before write (only for updates — new entries have no graph context)
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (eId) {
        ccResult = await runConsistencyCheck(worldPath, eBody, "entry", eId);
        if (ccResult && ccResult.hard.length > 0) {
          return t().hardConstraintBlock(ccResult.hard.join("\n\n"));
        }
      }
      if (input.entry_id) {
        const updateParams: Record<string, unknown> = {
          worldPath,
          entryId: input.entry_id as string,
          name: input.name as string,
          body: eBody,
        };
        if (input.entry_type) updateParams.entryType = input.entry_type;
        await invoke("update_entry", updateParams);
        let msg = t().entryUpdated(input.name as string);
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n${t().softConstraintReminder(ccResult.soft.join("\n"))}`;
        }
        return msg;
      } else {
        const entryType = (input.entry_type as string) || "concept";
        const createParams: Record<string, unknown> = {
          worldPath,
          name: input.name as string,
          entryType,
        };
        if (input.body) createParams.body = input.body;
        await invoke("create_entry", createParams);
        return t().entryCreated(input.name as string, entryType);
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
        t().sceneStats(analysis.word_count, analysis.paragraph_count, analysis.estimated_reading_minutes),
        t().sceneDialogueRatio(Math.round(analysis.dialogue_ratio * 100)),
      ];
      if (analysis.referenced_entries.length > 0) {
        lines.push(`${t().sceneReferencedEntries}: ${analysis.referenced_entries.join(", ")}`);
      }
      if (analysis.structure_hints.length > 0) {
        lines.push(`${t().sceneStructureHints}:\n${analysis.structure_hints.map((h) => `  - ${h}`).join("\n")}`);
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
      if (chapters.length === 0) return t().outlineEmpty;
      return chapters.map((c) => {
        const statusLabel = c.status === "done" ? "✓" : c.status === "drafting" ? "✎" : "○";
        const wordsLabel = getT(useStore.getState().language).common.words;
        const info = c.has_body ? `${c.word_count}${wordsLabel}` : t().outlineNoBody;
        return `${statusLabel} Ch${c.order} ${c.title} [${info}] id=${c.id}${c.summary ? ` — ${c.summary}` : ""}`;
      }).join("\n");
    }
    case "OutlineWrite": {
      const chBody = (input.body as string) || "";
      // Delete path
      if (input.delete === true) {
        await invoke("delete_chapter", { worldPath, storyId, chapterOrder: input.chapter_order as number });
        return t().chapterDeleted(input.chapter_order as number);
      }
      // Consistency check before write: traverse from story via outline entity type
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (chBody.trim().length >= 10) {
        ccResult = await runConsistencyCheck(worldPath, chBody, "outline", storyId);
        if (ccResult && ccResult.hard.length > 0) {
          return t().hardConstraintBlock(ccResult.hard.join("\n\n"));
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
      let msg = t().chapterUpdated(input.chapter_order as number);
      if (ccResult && ccResult.soft.length > 0) {
        msg += `\n\n${t().softConstraintReminder(ccResult.soft.join("\n"))}`;
      }
      return msg;
    }
    case "FileRead": {
      const fp = input.path as string | undefined;
      // No path or path ending with /: list directory
      if (!fp || fp.endsWith("/")) {
        const subdir = fp ? fp.replace(/\/$/, "") : "";
        const files = await invoke<string[]>("list_files", { worldPath, subdir });
        return files.length > 0 ? files.join("\n") : t().dirEmpty;
      }
      // Read file
      return await invoke<string>("read_file", {
        worldPath,
        filePath: fp,
      });
    }
    case "Memory": {
      const memFile = input.file_name as string | undefined;
      // Delete path
      if (input.delete === true) {
        if (!memFile) return t().deleteNeedsId;
        await invoke("delete_memory", { worldPath, fileName: memFile });
        return t().memoryDeleted(memFile);
      }
      // List path: no file_name + no content
      if (!memFile && !input.content) {
        const entries = await invoke<Array<{ name: string; description: string }>>("list_memories", { worldPath });
        if (entries.length === 0) return t().memoryEmpty;
        return entries.map((e) => `- ${e.name}${e.description ? ` — ${e.description}` : ""}`).join("\n");
      }
      // Read path: file_name provided, no content
      if (memFile && !input.content) {
        return await invoke<string>("read_memory", { worldPath, fileName: memFile });
      }
      // Write path
      if (!memFile) return t().deleteNeedsId;
      const memParams: Record<string, unknown> = {
        worldPath,
        fileName: memFile,
        content: input.content as string,
      };
      if (input.description) memParams.description = input.description;
      await invoke("write_memory", memParams);
      return t().memorySaved;
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
        if (results.length === 0) return t().graphNoReachable;
        return results.map((r) => {
          const en = r.entity.name || r.entity.id.slice(0, 8);
          const vn = r.via_entity.name || r.via_entity.id.slice(0, 8);
          return t().graphTraversalNode(r.entity.type, en, r.distance, r.via_entity.type, vn, r.via_description);
        }).join("\n");
      }
      const edges = await invoke<any[]>("query_relations", {
        worldPath,
        entityType: input.entity_type as string,
        entityId: input.entity_id as string,
        timelineId: input.timeline_id,
      });
      if (edges.length === 0) return t().graphNoRelations;
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
        return t().relationRemoved(input.from_type as string, input.from_id as string, input.description as string, input.to_type as string, input.to_id as string);
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
      return t().relationCreated(input.from_type as string, input.from_id as string, input.description as string, input.to_type as string, input.to_id as string);
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
        return t().noConstraintsFound;
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
        return t().constraintsChecked(allConstraints.length);
      }
      const lines = violations.map((v, i) =>
        t().violationItem(i + 1, v.level === "hard" ? t().hardConstraint : t().softConstraint, v.rule, v.reason)
      );
      return `${t().violationsFound(violations.length)}\n\n${lines.join("\n\n")}`;
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
        if (!tlId) return t().timelineDeleteNeedsId;
        await invoke("delete_timeline", { worldPath, timelineId: tlId });
        return t().timelineDeleted(tlId);
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
        return t().timelineUpdatedResult(JSON.stringify(timeline, null, 2));
      } else {
        // Create new timeline
        const params: Record<string, unknown> = { worldPath, name: input.name as string };
        if (input.description) params.description = input.description;
        if (input.time_format_json) params.timeFormatJson = input.time_format_json;
        const timeline = await invoke<any>("create_timeline", params);
        return t().timelineCreatedResult(JSON.stringify(timeline, null, 2));
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
        if (!evName) return t().eventDeleteNeedsName;
        await invoke("delete_event", {
          worldPath,
          timelineId: evTlId,
          eventName: evName,
        });
        return t().eventDeleted(evName);
      }
      // Consistency check
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (evSummary.trim().length >= 10) {
        const ccEntityType = hasName ? "event" : "timeline";
        const ccEntityId = hasName ? evName : evTlId;
        ccResult = await runConsistencyCheck(worldPath, evSummary, ccEntityType, ccEntityId, evTlId);
        if (ccResult && ccResult.hard.length > 0) {
          return t().hardConstraintBlock(ccResult.hard.join("\n\n"));
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
        if (input.precision != null) params.precision = input.precision as number;
        if (input.linked_entries) params.linkedEntries = input.linked_entries;
        if (input.linked_chapters) params.linkedChapters = input.linked_chapters;
        if (input.relationship_changes) params.relationshipChanges = input.relationship_changes;
        const event = await invoke<any>("update_event", params);
        let msg = t().eventUpdatedResult(JSON.stringify(event, null, 2));
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n${t().softConstraintReminder(ccResult.soft.join("\n"))}`;
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
        if (input.precision != null) params.precision = input.precision as number;
        if (input.linked_entries) params.linkedEntries = input.linked_entries;
        if (input.linked_chapters) params.linkedChapters = input.linked_chapters;
        if (input.relationship_changes) params.relationshipChanges = input.relationship_changes;
        const event = await invoke<any>("create_event", params);
        let msg = t().eventCreatedResult(JSON.stringify(event, null, 2));
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n${t().softConstraintReminder(ccResult.soft.join("\n"))}`;
        }
        return msg;
      }
    }
    default:
      return t().unknownTool(name);
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
  abortRef?: { current: boolean },
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
    // User pressed stop — bail out immediately, don't start new API calls
    if (abortRef?.current) return;
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
                const toolsText = JSON.stringify(getTools());
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
            callbacks.onError(event.message || t().unknownError);
            streamResolve();
            break;
        }
      });

      // ── Step 2: Send API request (listener is guaranteed ready) ──

      try {
        // Start the stream request, then immediately wait for stream_end event.
        // ⚠️ Order matters: we must await streamPromise BEFORE invokePromise.
        // The Rust backend emits StreamEnd before returning, but Tauri's IPC
        // may deliver the invoke response faster than the event. Sequential
        // await (invoke → streamPromise) would deadlock if invoke resolved
        // before stream_end arrived — streamPromise would never be checked.
        const invokePromise = invoke("stream_chat", {
          messages,
          systemPrompt: systemPrompt,
          model,
          tools: getTools(),
          provider,
          maxTokens,
          reasoningEffort: reasoningEffort || null,
          conversationId: convId || null,
        });

        // Wait for stream to complete, with a safety timeout.
        // If invoke fails (network error), invokePromise rejects below.
        try {
          await Promise.race([
            streamPromise,
            invokePromise.then(() => undefined),
          ]);
        } catch {}

        // Now ensure both are settled
        await invokePromise;
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
            content: t().finalAnswerEmpty,
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
          const result = `${t().cacheHit}\n${cached}`;
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
        callbacks.onError(t().maxTokensExhausted(MAX_RECOVERY));
        return;
      }

      // If no tool calls and no recovery needed, we're done
      if (pendingToolUses.length === 0) {
        if (totalToolUses > 0 && finalAnswerNudgeCount < 2) {
          finalAnswerNudgeCount++;
          awaitingFinalAnswer = true;
          messages.push({
            role: "user",
            content: t().finalAnswerNudge,
          });
          continue;
        }
        if (totalToolUses > 0) {
          callbacks.onError(t().finalAnswerMissing);
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
    handler({ type: "error", message: t().eventListenerUnavailable(e) });
    return () => {};
  }
}

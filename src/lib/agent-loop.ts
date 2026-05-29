/**
 * Agent Loop — orchestrates LLM calls + tool execution.
 * Modeled after Claude Code's QueryEngine: stream → tool_use → execute → feed back → repeat.
 */

import { invoke } from "./api";
import { useStore } from "./store";
import type { Message } from "./store";
import type { Entry } from "./types";
import { estimateTokens } from "./context-window";
import type { ContextBreakdown } from "./context-window";
import { compressMessages, RECENT_TURNS_TO_KEEP } from "./context-compression";
import { getT } from "./i18n";
import { rewriteSessionMessages, messagesToSessionLines } from "./session-writer";

function t() {
  return getT(useStore.getState().language).agent;
}

// ── Helpers ──

/** Build a map of event_id → readable name from edges/results that carry event IDs. */
async function resolveEventNames(worldPath: string, items: Array<{start_event_id?: string | null; end_event_id?: string | null}>): Promise<Record<string, string>> {
  const eventIds = new Set<string>();
  for (const item of items) {
    if (item.start_event_id) eventIds.add(item.start_event_id);
    if (item.end_event_id) eventIds.add(item.end_event_id);
  }
  if (eventIds.size === 0) return {};
  const map: Record<string, string> = {};
  try {
    const timelines = await invoke<Array<{id: string}>>("list_timelines", { worldPath });
    for (const tl of timelines) {
      try {
        const events = await invoke<Array<{id: string; name?: string; summary?: string}>>("list_events", { worldPath, timelineId: tl.id });
        for (const ev of events) {
          if (eventIds.has(ev.id)) {
            map[ev.id] = ev.name || ev.summary || ev.id.slice(0, 8);
          }
        }
      } catch {}
    }
  } catch {}
  return map;
}

function eventScopeSuffix(startId: string | null | undefined, endId: string | null | undefined, names: Record<string, string>): string {
  const parts: string[] = [];
  if (startId) parts.push(`since: ${names[startId] || startId.slice(0, 8)}`);
  if (endId) parts.push(`until: ${names[endId] || endId.slice(0, 8)}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
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
    name: "EntryRead",
    description: "Read a full setting entry by ID. Returns the complete frontmatter and body content.",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "Entry ID from EntrySearch results (UUID or legacy slug)." },
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
        query: { type: "string", description: "Search keyword for name/type/tag lookup. Leave empty to list all entries. NOTE: when 'pattern' is set, 'query' and 'entry_type' are ignored — pattern triggers full-text grep instead." },
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
        constraints: { type: "array", items: { type: "object", properties: { rule: { type: "string", description: "The constraint rule text" }, severity: { type: "string", enum: ["hard", "soft"], description: "hard = must pass (blocks write), soft = reminder only" }, timeline_id: { type: "string", description: "Optional timeline ID to scope this constraint" } }, required: ["rule", "severity"] }, description: "Optional list of consistency constraints for this entry. Omit to keep existing (on update) or leave empty (on create). Pass [] to clear existing constraints." },
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
    description: "Read the story outline. Pass chapter_id to read a specific chapter's full content; omit to list all chapters with id, order, title, status, summary, and word count.",
    input_schema: {
      type: "object",
      properties: {
        chapter_id: { type: "string", description: "Optional: chapter UUID from OutlineRead list. Omit to list all chapters." },
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
        chapter_id: { type: "string", description: "Existing chapter UUID. Required for update/delete. Omit to create a new chapter." },
        order: { type: "number", description: "Chapter order number (1, 2, 3...). Required for new chapters; optional when updating/reordering." },
        title: { type: "string", description: "Chapter title. Required for new chapters; optional when updating/renaming." },
        delete: { type: "boolean", description: "Set to true to DELETE this chapter. Requires chapter_id. Irreversible." },
        status: { type: "string", description: "Chapter status: 'outline', 'drafting', or 'done'" },
        summary: { type: "string", description: "Brief summary of this chapter" },
        body: { type: "string", description: "The actual chapter text / draft content" },
        linked_events: { type: "string", description: "JSON array of {timeline_id, event_id} objects to link this chapter to timeline events. Example: [{\"timeline_id\":\"tl-uuid\",\"event_id\":\"evt-uuid\"}]" },
      },
      required: [],
    },
  },
  {
    name: "FileRead",
    description: "List directory or read a file from the world directory. Omit 'path' to list root directory. Pass a directory path (ending with /) to list that subdirectory. Pass a file path to read its contents. Supports PDF files (auto-extracts text). For long uploaded files, pass offset and limit to read in pages.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory path relative to world directory. Omit to list root. End with / for dir listing. Otherwise reads file content." },
        offset: { type: "number", description: "Optional character offset for paged reading. Use 0 for the first page." },
        limit: { type: "number", description: "Optional max characters to read. Recommended 20000-30000 for long files." },
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
    description: "Explore the unified relation graph. Returns all relations connected to an entity, including both static relations (from Relation tool) and event-driven relations (from EventWrite.relationship_changes). Each result includes start_event_id/end_event_id when applicable. Use this as the primary tool to understand entity connections.",
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
    description: "Create, update, or remove a static relation between entities. Use for cross-timeline facts. For event-driven changes use EventWrite.relationship_changes. Provide reverse_description for asymmetric relations. Multiple edges between the same pair are allowed with different descriptions.",
    input_schema: {
      type: "object",
      properties: {
        relation_id: { type: "string", description: ta.relationId },
        from_type: { type: "string", description: ta.relationSourceType },
        from_id: { type: "string", description: "Source entity ID or exact entry name. For entries, you can pass the display name instead of UUID — the backend resolves it automatically." },
        to_type: { type: "string", description: ta.relationTargetType },
        to_id: { type: "string", description: "Target entity ID or exact entry name. For entries, you can pass the display name instead of UUID — the backend resolves it automatically." },
        description: { type: "string", description: ta.relationDesc },
        reverse_description: { type: "string", description: "反向关系描述。例如正向'父亲'→反向'子女'、正向'位于'→反向'容纳'。对称关系（如'战友'）可不填。" },
        timeline_id: { type: "string", description: ta.relationTimeline },
        delete: { type: "boolean", description: "Set to true to REMOVE this relation. Requires relation_id." },
      },
      required: [],
    },
  },
  {
    name: "ConsistencyCheck",
    description: "Check a passage of text against constraints from relevant entries. Auto-loads constraints via graph traversal from a starting entity, then runs keyword matching. Returns violations with level (hard/soft), rule, passage excerpt, and suggestion. Use when writing/editing content to ensure world consistency.",
    input_schema: {
      type: "object",
      properties: {
        passage: { type: "string", description: "The text passage to check for consistency violations." },
        entity_type: { type: "string", description: ta.consistencyEntityType },
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
    description: "List all timelines in the current world. Returns {id, name, description, is_default, time_format}. time_format.units lists time unit names and digit counts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "TimelineWrite",
    description: ta.timelineWriteDesc,
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Existing timeline ID. Omit to create new. Required for update/delete." },
        delete: { type: "boolean", description: "Set to true to DELETE this timeline and all its events (requires timeline_id). World must have ≥2 timelines." },
        name: { type: "string", description: ta.timelineName },
        description: { type: "string", description: "Optional description" },
        time_format_json: { type: "string", description: `Optional JSON TimeFormat string. For new timelines: sets initial format. For update: modifies existing format (unit count must stay the same — only change names, max values, or digits). Schema: {"units":[{"key":"era","name":"纪元","max":null,"display_order":0,"digits":1},...]}. Default: era(1digit,max9), year(6digit,∞), month(2digit,max12), day(2digit,max30), hour(2digit,max24), minute(2digit,max60), second(2digit,max60).` },
        is_default: { type: "boolean", description: "Set as the default timeline (update only)" },
      },
      required: [],
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
    description: ta.eventWriteDesc,
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID (required)" },
        event_id: { type: "string", description: ta.eventId },
        name: { type: "string", description: ta.eventName },
        delete: { type: "boolean", description: "Set to true to DELETE this event (requires event_id). Irreversible." },
        time_point: { type: "string", description: ta.eventTimePoint },
        summary: { type: "string", description: "Event description (2-3 sentences). Required for new events; can also be updated." },
        precision: { type: "number", description: ta.eventPrecision },
        linked_entries: { type: "string", description: "JSON array of {entry_id, perspective_summary}. perspective_summary ≤400 chars each. Example: [{\"entry_id\":\"uuid\",\"perspective_summary\":\"简述\"}]" },
        linked_chapters: { type: "string", description: "JSON array of {story_id, chapter_order} objects. Example: [{\"story_id\":\"uuid\",\"chapter_order\":1}]" },
        relationship_changes: { type: "string", description: "JSON array of {entry_a, entry_b, change_type, relation, description} objects. These are automatically synced to the relation graph (ExploreGraph). Example: [{\"entry_a\":\"uuid\",\"entry_b\":\"uuid2\",\"change_type\":\"add\",\"relation\":\"战友\",\"description\":\"共同抵御虚空入侵\"}]" },
      },
      required: ["timeline_id"],
    },
  },
  {
    name: "MoveEvent",
    description: "Move an event to a new time point on the timeline. This repositions the event and re-sorts the timeline. Use when you need to adjust when an event happened without rewriting all its details.",
    input_schema: {
      type: "object",
      properties: {
        timeline_id: { type: "string", description: "Timeline ID (required)" },
        event_id: { type: "string", description: "Event ID to move (required)" },
        new_time_point: { type: "string", description: "New time point string (same format as EventWrite.time_point)." },
      },
      required: ["timeline_id", "event_id", "new_time_point"],
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
  "EventWrite", "TimelineWrite", "MoveEvent",
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
        Relation: t().toolRelation(!!input.delete, ((input.relation_id || input.description) as string) || ""),
        EntryWrite: t().toolEntryWriteDelete((input.entry_id as string) || ""),
        EventWrite: t().toolEventWriteDelete((input.event_id as string) || ""),
        TimelineWrite: t().toolTimelineDelete((input.timeline_id as string) || ""),
      };
      const genericId = (input.event_id || input.entry_id || input.timeline_id || "") as string;
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
      OutlineWrite: input.chapter_id ? `Chapter ${input.chapter_id}` : `Ch${input.order} ${input.title || ""}`,
      EventWrite: t().toolEventLabel((input.event_id as string) || "", (input.summary as string) || ""),
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
    const seen = new Set<string>();
    if (entityType === "entry") seen.add(entityId);
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
        if (input.constraints !== undefined) updateParams.constraints = input.constraints;
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
        if (input.constraints) createParams.constraints = input.constraints;
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
      params.language = useStore.getState().language;
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
      const chapterId = input.chapter_id as string | undefined;
      // Read specific chapter
      if (chapterId) {
        return await invoke<string>("read_chapter", { worldPath, storyId, chapterId });
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
      const chapterId = input.chapter_id as string | undefined;
      // Delete path
      if (input.delete === true) {
        if (!chapterId) return t().chapterDeleteNeedsId;
        await invoke("delete_chapter", { worldPath, storyId, chapterId });
        return t().chapterDeleted(chapterId);
      }
      // Consistency check before write: traverse from story via outline entity type
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (chBody.trim().length >= 10 && chapterId) {
        ccResult = await runConsistencyCheck(worldPath, chBody, "outline", chapterId);
        if (ccResult && ccResult.hard.length > 0) {
          return t().hardConstraintBlock(ccResult.hard.join("\n\n"));
        }
      }
      const params: Record<string, unknown> = {
        worldPath, storyId,
      };
      if (chapterId) params.chapterId = chapterId;
      if (input.order !== undefined) params.order = input.order as number;
      if (input.title !== undefined) params.title = input.title as string;
      if (input.status !== undefined) params.status = input.status as string;
      if (input.summary !== undefined) params.summary = input.summary as string;
      if (input.body !== undefined) params.body = input.body as string;
      if (input.linked_events !== undefined) params.linkedEvents = typeof input.linked_events === "string" ? input.linked_events : JSON.stringify(input.linked_events);
      const chapter = await invoke<{ id: string; order: number }>("write_outline", params);
      let msg = t().chapterSaved(chapter.id, chapter.order);
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
      const params: Record<string, unknown> = {
        worldPath,
        filePath: fp,
      };
      if (input.offset !== undefined) params.offset = input.offset as number;
      if (input.limit !== undefined) params.limit = input.limit as number;
      return await invoke<string>("read_file", params);
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
        // Resolve event names for start/end_event_id
        const evNames = await resolveEventNames(worldPath, results);
        return results.map((r) => {
          const en = r.entity.name || r.entity.id.slice(0, 8);
          const vn = r.via_entity.name || r.via_entity.id.slice(0, 8);
          let line = t().graphTraversalNode(r.entity.type, en, r.distance, r.via_entity.type, vn, r.via_description);
          line += eventScopeSuffix(r.start_event_id, r.end_event_id, evNames);
          return line;
        }).join("\n");
      }
      const edges = await invoke<any[]>("query_relations", {
        worldPath,
        entityType: input.entity_type as string,
        entityId: input.entity_id as string,
        timelineId: input.timeline_id,
      });
      if (edges.length === 0) return t().graphNoRelations;
      const evNames = await resolveEventNames(worldPath, edges);
      return edges.map((e) => {
        const fn = e.from.name || e.from.id.slice(0, 8);
        const tn = e.to.name || e.to.id.slice(0, 8);
        let line = `[${e.from.type}]${fn} --[${e.description}]--> [${e.to.type}]${tn}`;
        line += eventScopeSuffix(e.start_event_id, e.end_event_id, evNames);
        return line;
      }).join("\n");
    }
    case "Relation": {
      const relationId = input.relation_id as string | undefined;
      // Remove path
      if (input.delete === true) {
        if (!relationId) return t().relationDeleteNeedsId;
        await invoke("remove_relation", {
          worldPath,
          relationId,
        });
        return t().relationRemoved(relationId);
      }
      if (relationId) {
        const params: Record<string, unknown> = {
          worldPath,
          relationId,
        };
        if (input.from_type) params.fromType = input.from_type;
        if (input.from_id) params.fromId = input.from_id;
        if (input.to_type) params.toType = input.to_type;
        if (input.to_id) params.toId = input.to_id;
        if (input.description) params.description = input.description;
        if (input.reverse_description !== undefined) params.reverseDescription = input.reverse_description;
        if (input.timeline_id !== undefined) params.timelineId = input.timeline_id;
        await invoke("update_relation", params);
        return t().relationUpdated(relationId);
      }
      // Add path
      await invoke("add_relation", {
        worldPath,
        fromType: input.from_type as string,
        fromId: input.from_id as string,
        toType: input.to_type as string,
        toId: input.to_id as string,
        description: input.description as string,
        reverseDescription: input.reverse_description,
        timelineId: input.timeline_id,
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
        if (input.time_format_json) params.timeFormatJson = typeof input.time_format_json === "string" ? input.time_format_json : JSON.stringify(input.time_format_json);
        const timeline = await invoke<any>("update_timeline", params);
        return t().timelineUpdatedResult(timeline.name || tlId);
      } else {
        // Create new timeline
        const params: Record<string, unknown> = { worldPath, name: input.name as string };
        if (input.description) params.description = input.description;
        if (input.time_format_json) params.timeFormatJson = typeof input.time_format_json === "string" ? input.time_format_json : JSON.stringify(input.time_format_json);
        const timeline = await invoke<any>("create_timeline", params);
        return t().timelineCreatedResult(timeline.name || (input.name as string));
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
      const evId = input.event_id as string | undefined;
      const evSummary = (input.summary as string) || "";
      const hasRef = !!evId;
      // Delete path
      if (input.delete === true) {
        if (!evId) return t().eventDeleteNeedsId;
        await invoke("delete_event", {
          worldPath,
          timelineId: evTlId,
          eventId: evId,
        });
        return t().eventDeleted(evId);
      }
      // Consistency check
      let ccResult: { hard: string[]; soft: string[] } | null = null;
      if (evSummary.trim().length >= 10) {
        const ccEntityType = hasRef ? "event" : "timeline";
        const ccEntityId = evId || evTlId;
        ccResult = await runConsistencyCheck(worldPath, evSummary, ccEntityType, ccEntityId, evTlId);
        if (ccResult && ccResult.hard.length > 0) {
          return t().hardConstraintBlock(ccResult.hard.join("\n\n"));
        }
      }
      if (hasRef) {
        // Update existing event
        const params: Record<string, unknown> = {
          worldPath,
          timelineId: evTlId,
        };
        if (evId) params.eventId = evId;
        if (input.time_point) params.timePoint = input.time_point;
        if (input.summary) params.summary = input.summary;
        if (input.name) params.nameUpdate = input.name;
        if (input.precision != null) params.precision = input.precision as number;
        if (input.linked_entries) params.linkedEntries = typeof input.linked_entries === "string" ? input.linked_entries : JSON.stringify(input.linked_entries);
        if (input.linked_chapters) params.linkedChapters = typeof input.linked_chapters === "string" ? input.linked_chapters : JSON.stringify(input.linked_chapters);
        if (input.relationship_changes) params.relationshipChanges = typeof input.relationship_changes === "string" ? input.relationship_changes : JSON.stringify(input.relationship_changes);
        const event = await invoke<any>("update_event", params);
        let msg = t().eventUpdatedResult(event.name || evId);
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
        if (input.name) params.name = input.name;
        if (input.precision != null) params.precision = input.precision as number;
        if (input.linked_entries) params.linkedEntries = typeof input.linked_entries === "string" ? input.linked_entries : JSON.stringify(input.linked_entries);
        if (input.linked_chapters) params.linkedChapters = typeof input.linked_chapters === "string" ? input.linked_chapters : JSON.stringify(input.linked_chapters);
        if (input.relationship_changes) params.relationshipChanges = typeof input.relationship_changes === "string" ? input.relationship_changes : JSON.stringify(input.relationship_changes);
        const event = await invoke<any>("create_event", params);
        let msg = t().eventCreatedResult(event.name || (input.name as string) || evTlId);
        if (ccResult && ccResult.soft.length > 0) {
          msg += `\n\n${t().softConstraintReminder(ccResult.soft.join("\n"))}`;
        }
        return msg;
      }
    }
    case "MoveEvent": {
      const evTlId = input.timeline_id as string;
      const evId = input.event_id as string;
      const newTp = input.new_time_point as string;
      if (!evTlId || !evId || !newTp) return t().moveEventMissingParams;
      const event = await invoke<any>("move_event", {
        worldPath,
        timelineId: evTlId,
        eventId: evId,
        newTimePoint: newTp,
      });
      return t().eventUpdatedResult(event.name || evId);
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
  thinkingStyle?: string,
  baseUrl?: string,
) {
  const MAX_RECOVERY = 3;
  let turns = 0;
  let recoveryCount = 0;
  let totalToolUses = 0;
  let fullText = "";
  let lastUsageTotal = 0;
  let lastUsageMsgCount = 0;
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

      // ── Step 1: Set up event listener BEFORE sending API request ──
      // setupStreamListener does dynamic import + Tauri listen, both async.
      // We MUST await it to ensure the listener is registered before stream_chat
      // sends events. Otherwise events arrive before the listener exists → lost.
      let streamDone = false;
      let lastStopReason = "";
      let streamResolve: () => void;
      const streamPromise = new Promise<void>((resolve) => { streamResolve = resolve; });

      const unlisten = await setupStreamListener(convId || "", (event) => {
        if (abortRef?.current) return;
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
            // Track billed tokens for cost estimation
            useStore.getState().addTokens(event.input_tokens ?? 0, event.output_tokens ?? 0, convId);
            // Hybrid context count: anchor API's real token count, add rough
            // estimate for messages added since (clamped so total never drops).
            {
              const apiTokens = event.input_tokens ?? 0;
              if (apiTokens > 0) {
                const deltaMsgs = messages.slice(lastUsageMsgCount);
                const deltaEst = estimateTokens(deltaMsgs.map((m) => `[${m.role}] ${m.content}`).join("\n"));
                const hybridTotal = Math.max(apiTokens, lastUsageTotal + deltaEst);
                lastUsageTotal = hybridTotal;
                lastUsageMsgCount = messages.length;

                const skillsIdx = systemPrompt.lastIndexOf("# Skills");
                const corePrompt = skillsIdx > 0 ? systemPrompt.slice(0, skillsIdx) : systemPrompt;
                const skillsText = skillsIdx > 0 ? systemPrompt.slice(skillsIdx) : "";
                const msgsText = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
                const toolsText = JSON.stringify(getTools());
                const totalChars = msgsText.length + corePrompt.length + skillsText.length + toolsText.length;
                const totalEst = estimateTokens(msgsText) + estimateTokens(corePrompt) + estimateTokens(skillsText) + estimateTokens(toolsText);
                const scale = totalEst > 0 ? hybridTotal / totalEst : 0;
                const breakdown: ContextBreakdown = {
                  messages: Math.round(estimateTokens(msgsText) * scale),
                  systemTools: Math.round(estimateTokens(toolsText) * scale),
                  mcpTools: 0,
                  systemPrompt: Math.round(estimateTokens(corePrompt) * scale),
                  skills: Math.round(estimateTokens(skillsText) * scale),
                  total: hybridTotal,
                };
                useStore.getState().updateContextUsage(hybridTotal, breakdown, convId);
              }
            }
            break;
          case "stream_end":
            streamDone = true;
            lastStopReason = event.stop_reason || "";
            console.log("[agent-loop] stream_end stop_reason=", lastStopReason);
            streamResolve();
            break;
          case "error":
            streamDone = true;
            callbacks.onError(event.message || t().unknownError);
            streamResolve();
            break;
        }
      });

      // ── Context compression: check before sending API request ──
      const storeState = useStore.getState();
      const storeWindowSize = storeState.contextWindowSize;
      const compressionThreshold = storeState.compressionThreshold;
      const forceCompress = storeState.forceCompress;
      // Estimate context usage from messages + system prompt + tools
      const estimatedUsed =
        estimateTokens(messages.map((m) => m.content).join("\n")) +
        estimateTokens(systemPrompt) +
        estimateTokens(JSON.stringify(getTools()));
      const shouldCompress = forceCompress || (
        storeWindowSize > 0 && estimatedUsed / storeWindowSize > compressionThreshold
      );
      if (shouldCompress) {
        if (forceCompress) useStore.getState().setForceCompress(false);
        // Show compressing indicator in UI
        useStore.getState().setCompressing(true);
        try {
          const result = await compressMessages(
            messages,
            storeWindowSize,
            estimatedUsed,
            { threshold: compressionThreshold, keepTurns: RECENT_TURNS_TO_KEEP },
            provider,
            model,
          );
          if (result.compressed) {
            // Replace messages array in-place (agent loop's working copy — LLM sees summary)
            messages.length = 0;
            messages.push(...result.messages);
            // Sync compressed messages back to store, preserving metadata for kept zone
            if (convId) {
              const now = Date.now();
              const SEP = "之前的对话已被压缩";
              const conv = useStore.getState().worlds
                .find((w) => w.id === useStore.getState().activeWorldId)
                ?.stories.flatMap((s) => s.conversations)
                .find((c) => c.id === convId);
              const snapshot = conv?.messages ?? [];
              const keepStart = result.originalRange?.[1] ?? 0;

              // Compressed zone: keep message text, strip thinking/toolCalls, remove old separators
              const compressedZone: Message[] = snapshot.slice(0, keepStart)
                .filter((m) => m.content !== SEP)
                .map((m) => ({ ...m, thinking: undefined, toolCalls: undefined }));
              // Separator between compressed zone and kept zone
              const separator: Message = {
                id: `compressed-sep-${now}`,
                role: "user",
                content: SEP,
                timestamp: now,
              };
              // Kept zone: preserve full metadata, remove any old separators
              const keptMsgs: Message[] = snapshot.slice(keepStart)
                .filter((m) => m.content !== SEP)
                .map((m, i) => ({ ...m, id: `kept-${now}-${i}` }));

              useStore.getState().replaceMessages(convId, [...compressedZone, separator, ...keptMsgs]);
              rewriteSessionMessages(
                worldPath,
                convId,
                [...messagesToSessionLines(compressedZone), ...messagesToSessionLines([separator]), ...messagesToSessionLines(keptMsgs)],
              ).catch(() => {});
              useStore.getState().markCompressed(
                convId,
                result.summary,
                result.tokenSavings,
              );
              // Reset anchor: messages array changed, start fresh from compression result
              lastUsageTotal = estimateTokens(result.messages.map((m) => m.content).join("\n"));
              lastUsageMsgCount = result.messages.length;
              // Immediately update context usage display
              const used = lastUsageTotal + estimateTokens(systemPrompt) + estimateTokens(JSON.stringify(getTools()));
              useStore.getState().updateContextUsage(used, {
                messages: lastUsageTotal,
                systemTools: estimateTokens(JSON.stringify(getTools())),
                mcpTools: 0,
                systemPrompt: estimateTokens(systemPrompt),
                skills: 0,
                total: used,
              }, convId);
            }
            // Notify UI
            window.dispatchEvent(
              new CustomEvent("worldforge-compressed", {
                detail: {
                  summary: result.summary,
                  tokenSavings: result.tokenSavings,
                },
              }),
            );
          }
          useStore.getState().setCompressing(false);
        } catch {
          // Compression failure → continue without, don't block the user
          console.error("[compression] Failed to compress context");
          useStore.getState().setCompressing(false);
        }
      }

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
          thinkingStyle: thinkingStyle || null,
          baseUrl: baseUrl || null,
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

      fullText += turnText;

      // Add assistant message to history (may be partial if truncated)
      messages.push({ role: "assistant", content: turnText });

      // Execute all tool calls that arrived — no artificial per-turn cap

      totalToolUses += pendingToolUses.length;
      for (const tool of pendingToolUses) {
        console.log("[agent-loop] executing tool:", tool.name, JSON.stringify(tool.input).slice(0, 200));
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
          console.log("[agent-loop] tool done:", tool.name, "resultLen=", result.length);
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
        console.log("[agent-loop] max_tokens recovery attempt", recoveryCount + 1, "/", MAX_RECOVERY);
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
        console.log("[agent-loop] done");
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

/**
 * Tool Output Pruning — trim old tool results to a minimal reminder
 * before the next user turn starts, so the LLM context window is freed
 * from verbose output it has already processed.
 *
 * Two zones:
 *   - Keep zone (recent N turns): tool results kept intact.
 *     Only EntryRead is deduped by id (same id → latest keeps body summary,
 *     earlier occurrences become name-only).
 *   - Prune zone (older): all tool results → [已裁减: keyInfo],
 *     with optional summary excerpt.
 *
 * Current turn (the one being sent now) is always left intact.
 */

import type { AgentMessage } from "./agent-loop";

// ── Defaults ──

const DEFAULT_KEEP_TURNS = 3;

// ── Per-tool truncation limits ──

const LIMITS: Record<string, number> = {
  EntryRead: 200,
  FileRead: 300,
  WebFetch: 200,
  OutlineRead: 300,
};

// ── Prune a single tool result body by tool name ──

function pruneByTool(toolName: string, body: string): string {
  switch (toolName) {
    case "EntryRead":
      return pruneEntryRead(body);
    case "EntrySearch":
      return pruneEntrySearch(body);
    case "FileRead":
      return pruneFileRead(body);
    case "WebFetch":
      return pruneWebFetch(body);
    case "WebSearch":
      return pruneWebSearch(body);
    case "OutlineRead":
      return pruneOutlineRead(body);
    case "ExploreGraph":
      return pruneExploreGraph(body);
    case "ListEvents":
      return pruneListEvents(body);
    case "ListTimelines":
      return pruneListTimelines(body);
    case "ConsistencyCheck":
      return pruneConsistencyCheck(body);
    case "Memory":
      return pruneMemory(body);
    case "SceneAnalyze":
      return body; // already concise stats
    // Write tools — short confirmation messages, keep intact
    case "EntryWrite":
    case "EventWrite":
    case "OutlineWrite":
    case "TimelineWrite":
    case "Relation":
    case "MoveEvent":
      return body;
    default:
      return body;
  }
}

/** Format output: [已裁减: label]\n\nsummary */
function censor(label: string, summary: string): string {
  return `[已裁减: ${label}]\n\n${summary}`;
}

/** Try to extract entry ID from body JSON. Returns null if not parseable. */
function entryIdFromBody(body: string): string | null {
  try {
    const data = JSON.parse(body);
    return data.id || null;
  } catch {
    return null;
  }
}

// ── Per-tool pruners ──

function pruneEntryRead(body: string): string {
  // JSON: {id, name, type, body, ...}
  try {
    const data = JSON.parse(body);
    const name = data.name || "?";
    const type = data.type || "?";
    const entryBody = data.body || "";

    // Small entry (no body or body very short): keep intact
    if (!entryBody || entryBody.length <= LIMITS.EntryRead) {
      return body;
    }

    const summary = entryBody.slice(0, LIMITS.EntryRead) + "...";
    return censor(`${name} (${type})`, summary);
  } catch {
    // Not JSON — possibly an error response; keep truncated
    return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
  }
}

/** Get the name-only label for an EntryRead (for dedup). Includes [工具结果:] prefix. */
function pruneEntryReadNameOnly(fullContent: string): string {
  // fullContent has the [工具结果: EntryRead] prefix already
  const body = fullContent.replace(/^\[工具结果:\s*\S+\]\n?/, "");
  try {
    const data = JSON.parse(body);
    return `[工具结果: EntryRead]\n[已裁减: ${data.name || "?"} (${data.type || "?"})]`;
  } catch {
    return "[工具结果: EntryRead]\n[已裁减: ?]";
  }
}

function pruneEntrySearch(body: string): string {
  if (body === "[]") return "[已裁减: no results]";

  // Auto-fallback grep text
  if (body.startsWith("名称搜索")) {
    return "[已裁减: name search fell back to grep]";
  }

  // Overflow message: "共 N 条" or "找到 N 条"
  const overflowMatch = body.match(/^共\s*(\d+)\s*条|^找到\s*(\d+)\s*条/);
  if (overflowMatch) {
    const count = overflowMatch[1] || overflowMatch[2];
    return `[已裁减: ${count} results (overflow)]`;
  }

  // JSON array
  try {
    const results = JSON.parse(body);
    if (!Array.isArray(results)) return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
    if (results.length === 0) return "[已裁减: no results]";

    // Grep results: {path, matches}
    const isGrep = results[0]?.matches !== undefined;
    if (isGrep) {
      const totalMatches = results.reduce((sum: number, r: any) => sum + (r.matches?.length || 0), 0);
      return `[已裁减: grep — ${results.length} files, ${totalMatches} matches]`;
    }

    // Name/type/tag search: [{id, name, type}]
    const query = (body.match(/"query"\s*:\s*"([^"]+)"/)?.[1]) || "";
    const names = results.slice(0, 10).map((r: any) => r.name || "?").join(", ");
    const label = query ? `"${query}" — ${results.length} results` : `${results.length} results`;
    const suffix = results.length > 10 ? `\n... and ${results.length - 10} more` : "";
    return censor(label, names + suffix);
  } catch {
    return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
  }
}

function pruneFileRead(body: string): string {
  // Directory listing
  const lines = body.split("\n").filter(Boolean);
  if (body.startsWith("(") && lines.length <= 3) return body; // short status msg
  if (body.startsWith("(") || lines.length > 3) {
    return `[已裁减: directory listing — ${lines.length} entries]`;
  }

  // Single file content
  if (body.length <= LIMITS.FileRead) return body;
  const titleMatch = body.match(/^#\s*(.+)$/m);
  const name = titleMatch ? titleMatch[1].trim() : `file`;
  const summary = body.slice(0, LIMITS.FileRead) + "...";
  return censor(`${name} (${body.length} chars)`, summary);
}

function pruneWebFetch(body: string): string {
  if (body.length <= LIMITS.WebFetch) return body;
  const firstLine = body.split("\n")[0].trim();
  const label = firstLine.length > 0 && firstLine.length < 100 ? firstLine : `content (${body.length} chars)`;
  const summary = body.slice(0, LIMITS.WebFetch) + "...";
  return censor(label, summary);
}

function pruneWebSearch(body: string): string {
  if (!body) return "[已裁减: no results]";
  const resultCount = body.split("\n\n").length;
  const titles = body.split("\n\n").slice(0, 3).map((r) => {
    const m = r.match(/^- (.+)/);
    return m ? m[1].trim() : "?";
  }).join(", ");
  const suffix = resultCount > 3 ? `\n... and ${resultCount - 3} more` : "";
  return censor(`${resultCount} results`, titles + suffix);
}

function pruneOutlineRead(body: string): string {
  if (body.startsWith("暂无") || body.startsWith("No")) return "[已裁减: empty]";

  // Chapter list: "✓ Ch1 标题 [2300字] id=uuid\n✎ Ch2..."
  if (body.includes("\n") && (body.includes("Ch") || body.includes("Ch"))) {
    const chapters = body.split("\n").filter(Boolean);
    return `[已裁减: ${chapters.length} chapters]`;
  }

  // Single chapter content
  if (body.length <= LIMITS.OutlineRead) return body;
  const titleMatch = body.match(/^#\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `chapter`;
  const summary = body.slice(0, LIMITS.OutlineRead) + "...";
  return censor(`${title} (${body.length} chars)`, summary);
}

function pruneExploreGraph(body: string): string {
  if (body.startsWith("该实体") || body.startsWith("No")) return `[已裁减: ${body}]`;

  const lines = body.split("\n").filter(Boolean);
  if (lines.length === 0) return "[已裁减: empty]";
  if (lines.length <= 20) return body; // short enough, keep

  // First line usually has the entity name
  const first = lines[0];
  const entityMatch = first.match(/^\[entry\](.+?) --/);
  const entity = entityMatch ? entityMatch[1] : "";
  const label = entity ? `${entity} — ${lines.length} relations` : `${lines.length} relations`;

  const kept = lines.slice(0, 10).join("\n");
  return censor(label, kept + `\n... and ${lines.length - 10} more`);
}

function pruneListEvents(body: string): string {
  if (body === "[]") return "[已裁减: no events]";

  try {
    const events = JSON.parse(body);
    if (!Array.isArray(events)) return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
    if (events.length === 0) return "[已裁减: no events]";

    const first5 = events.slice(0, 5)
      .map((e: any) => `${e.name || "?"}(${e.time_point || ""})`)
      .join(", ");
    const suffix = events.length > 5 ? `\n... and ${events.length - 5} more` : "";
    return censor(`${events.length} events`, first5 + suffix);
  } catch {
    return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
  }
}

function pruneListTimelines(body: string): string {
  if (body === "[]") return "[已裁减: none]";
  try {
    const timelines = JSON.parse(body);
    if (!Array.isArray(timelines)) return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
    if (timelines.length === 0) return "[已裁减: none]";
    const names = timelines.map((t: any) => t.name || "?").join(", ");
    return censor(`${timelines.length} timeline(s)`, names);
  } catch {
    return body.length > 200 ? censor("?", body.slice(0, 200) + "...") : body;
  }
}

function pruneConsistencyCheck(body: string): string {
  // Short messages: keep intact
  if (body.length <= 500) return body;

  // "发现 N 处违反:\n\n[1] [硬约束] rule..."
  // Drop "判定理由" details if keeping them would make it too long
  const lines = body.split("\n");
  const kept: string[] = [];
  let reasonCount = 0;
  for (const line of lines) {
    if (line.startsWith("    判定理由")) {
      reasonCount++;
      if (reasonCount > 5) continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function pruneMemory(body: string): string {
  // Confirmation messages
  if (body.length <= 60) return body;

  // "- name — description\n" list
  if (body.startsWith("- ") && body.includes(" — ")) {
    const lines = body.split("\n").filter(Boolean);
    return `[已裁减: ${lines.length} files]`;
  }

  // Reading a memory file
  if (body.length <= 500) return body;
  const titleMatch = body.match(/^#\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "memory";
  return censor(title, body.slice(0, 300) + "...");
}

// ── Main entry point ──

/**
 * Tool-result detection. Two shapes appear in the AgentMessage stream:
 *
 *   - In-memory (during one agent run): role:"user" + tool_call_id + content
 *     prefixed with "[工具结果: Name]\n".
 *   - Persisted & rebuilt (between turns, by buildModelMessages):
 *     role:"tool" + tool_call_id + raw content (no prefix).
 *
 * Both are pruned identically below; we key off `tool_call_id` being set, and
 * look the tool name up from the prior assistant turn's `tool_calls` array
 * when no `[工具结果: ...]` prefix is available.
 */
function isToolResult(msg: AgentMessage): boolean {
  if (msg.tool_call_id) return true;
  if (msg.role === "tool") return true;
  if (msg.role === "user" && msg.content.startsWith("[工具结果:")) return true;
  return false;
}

/** Look up the tool name for a tool result message. Falls back to "tool". */
function toolNameOf(
  msg: AgentMessage,
  toolNameByCallId: Map<string, string>,
): string {
  if (msg.tool_call_id) {
    const fromMap = toolNameByCallId.get(msg.tool_call_id);
    if (fromMap) return fromMap;
  }
  // Legacy prefix path (in-memory messages during one agent run).
  const m = msg.content.match(/^\[工具结果:\s*(\S+)\]\n?/);
  if (m) return m[1];
  return "tool";
}

/**
 * Prune tool results from turns BEFORE the current user turn.
 *
 * @param messages - Full message array for the conversation
 * @param keepTurns - Number of recent complete turns to keep intact (default 3).
 *                    Only applies when pruning is enabled.
 *                    EntryRead dedup (same id → name-only) applies everywhere.
 */
export function pruneToolOutputs(messages: AgentMessage[], keepTurns = DEFAULT_KEEP_TURNS): AgentMessage[] {
  // 0. Build a lookup from tool_call_id → tool_name using every assistant turn
  //    in scope. Lets us recognise role:"tool" messages that don't carry the
  //    legacy [工具结果: Name] prefix.
  const toolNameByCallId = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls) continue;
    for (const tc of m.tool_calls) toolNameByCallId.set(tc.id, tc.function.name);
  }

  // 1. Find the start of the current turn: the last user/tool message that is NOT a tool result.
  //    "Current turn" in agent-loop terms = the user message the user just sent,
  //    which is always a plain user message (no tool_call_id, no [工具结果:] prefix).
  let currentTurnStart = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !isToolResult(m)) {
      currentTurnStart = i;
      break;
    }
  }
  if (currentTurnStart <= 0) return messages;

  // 2. Find the "keep zone" boundary: N complete turns before current
  let keepZoneStart = currentTurnStart;
  let turnsFound = 0;
  for (let i = currentTurnStart - 1; i >= 0 && turnsFound < keepTurns; i--) {
    const m = messages[i];
    if (m.role === "user" && !isToolResult(m)) {
      turnsFound++;
      keepZoneStart = i;
    }
  }
  // keepZoneStart = index of the oldest user message in the keep zone
  // Everything before keepZoneStart is the prune zone

  // 3. Pass 1 (EntryRead dedup): scan all messages before current turn
  //    to find duplicate entry ids in the KEEP zone.
  //    (In the prune zone they all get name-only anyway.)
  const latestEntryReadIdx = new Map<string, number>();
  for (let i = keepZoneStart; i < currentTurnStart; i++) {
    const msg = messages[i];
    if (!isToolResult(msg)) continue;
    if (toolNameOf(msg, toolNameByCallId) !== "EntryRead") continue;
    const id = entryIdFromToolResult(msg);
    if (id) latestEntryReadIdx.set(id, i);
  }

  // 4. Pass 2: apply pruning
  return messages.map((msg, i) => {
    if (i >= currentTurnStart) return msg;          // current turn: intact
    if (msg.role === "assistant") return msg;       // assistant messages: intact
    if (!isToolResult(msg)) return msg;             // plain user/system: intact

    const toolName = toolNameOf(msg, toolNameByCallId);

    // ── Keep zone: intact except EntryRead dedup ──
    if (i >= keepZoneStart) {
      if (toolName === "EntryRead") {
        const id = entryIdFromToolResult(msg);
        if (id && latestEntryReadIdx.get(id) !== i) {
          return { ...msg, content: pruneEntryReadNameOnlyFromRaw(msg.content) };
        }
      }
      return msg; // other tools: intact
    }

    // ── Prune zone: all tool results → censored ──
    return pruneToolResultByName(msg, toolName);
  });
}

/** Extract the entry id from a tool result body, regardless of prefix shape. */
function entryIdFromToolResult(msg: AgentMessage): string | null {
  const raw = msg.content.startsWith("[工具结果:")
    ? msg.content.replace(/^\[工具结果:\s*\S+\]\n?/, "")
    : msg.content;
  return entryIdFromBody(raw);
}

/**
 * Drop a tool result to a name-only "[已裁减: <name> (<type>)]" line, with no
 * body. Works on the raw content (no prefix) — used for keep-zone dedup.
 */
function pruneEntryReadNameOnlyFromRaw(content: string): string {
  try {
    const data = JSON.parse(content);
    return `[已裁减: ${data.name || "?"} (${data.type || "?"})]`;
  } catch {
    return "[已裁减: ?]";
  }
}

/**
 * Drop a tool result to a censored form. Dispatches on the tool name so
 * pruners that need a tool name (EntryRead, FileRead, etc.) work whether
 * or not the message carries the legacy prefix.
 */
function pruneToolResultByName(msg: AgentMessage, toolName: string): AgentMessage {
  // Normalise to the legacy "[工具结果: Name]\n<body>" shape the per-tool
  // pruners were originally written for. Cheap, local — never sent to the LLM.
  const body = msg.content.startsWith("[工具结果:")
    ? msg.content.replace(/^\[工具结果:\s*\S+\]\n?/, "")
    : msg.content;
  const synthesised = `[工具结果: ${toolName}]\n${body}`;
  const pruned = pruneByTool(toolName, synthesised);
  // The synthesised prefix never made it to the wire; for tool messages
  // rebuilt by buildModelMessages, the LLM expects the raw body, not a
  // `[工具结果: ...]` envelope. Strip it back off.
  if (!msg.content.startsWith("[工具结果:")) {
    const stripped = pruned.replace(/^\[工具结果:\s*\S+\]\n?/, "");
    return { ...msg, content: stripped };
  }
  return { ...msg, content: pruned };
}

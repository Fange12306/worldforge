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

// ── Prune a single tool result message ──

function pruneToolResult(msg: AgentMessage): AgentMessage {
  if (!msg.content.startsWith("[工具结果:")) return msg;

  const headerMatch = msg.content.match(/^\[工具结果:\s*(\S+)\]\n?/);
  if (!headerMatch) return msg;
  const toolName = headerMatch[1];
  const body = msg.content.slice(headerMatch[0].length);

  if (!body) return msg;

  const pruned = pruneByTool(toolName, body);
  return { ...msg, content: pruned };
}

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
 * Prune tool results from turns BEFORE the current user turn.
 *
 * @param messages - Full message array for the conversation
 * @param keepTurns - Number of recent complete turns to keep intact (default 3).
 *                    Only applies when pruning is enabled.
 *                    EntryRead dedup (same id → name-only) applies everywhere.
 */
export function pruneToolOutputs(messages: AgentMessage[], keepTurns = DEFAULT_KEEP_TURNS): AgentMessage[] {
  // 1. Find the start of the current turn: the last user message that is NOT a tool result
  let currentTurnStart = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !m.content.startsWith("[工具结果:")) {
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
    if (m.role === "user" && !m.content.startsWith("[工具结果:")) {
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
    if (msg.role !== "user") continue;
    if (!msg.content.startsWith("[工具结果:")) continue;
    const headerMatch = msg.content.match(/^\[工具结果:\s*(\S+)\]\n?/);
    if (!headerMatch) continue;
    if (headerMatch[1] !== "EntryRead") continue;
    const id = entryIdFromBody(msg.content.slice(headerMatch[0].length));
    if (id) latestEntryReadIdx.set(id, i);
  }

  // 4. Pass 2: apply pruning
  return messages.map((msg, i) => {
    if (i >= currentTurnStart) return msg;          // current turn: intact
    if (msg.role !== "user") return msg;              // assistant messages: intact
    if (!msg.content.startsWith("[工具结果:")) return msg;

    // ── Keep zone: intact except EntryRead dedup ──
    if (i >= keepZoneStart) {
      const headerMatch = msg.content.match(/^\[工具结果:\s*(\S+)\]\n?/);
      if (headerMatch && headerMatch[1] === "EntryRead") {
        const id = entryIdFromBody(msg.content.slice(headerMatch[0].length));
        if (id && latestEntryReadIdx.get(id) !== i) {
          return { ...msg, content: pruneEntryReadNameOnly(msg.content) };
        }
      }
      return msg; // other tools: intact
    }

    // ── Prune zone: all tool results → censored ──
    return pruneToolResult(msg);
  });
}

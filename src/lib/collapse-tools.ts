import type { Message } from "./store";

// Tools classified as search/read (informational, non-mutating)
const SEARCH_READ_TOOLS = new Set([
  "EntrySearch",
  "EntryRead",
  "OutlineRead",
  "FileRead",
  "WebSearch",
  "WebFetch",
  "ExploreGraph",      // Phase 4/5 — read-only graph exploration (direct + BFS)
  "TraverseGraph",     // Phase 4 — legacy, kept for collapsed display in old convos
  "ConsistencyCheck",  // Phase 4 — read-only constraint matching
  "UseSkill",          // Phase 4 — informational skill lookup (no side effects)
  "ListTimelines",     // Phase 5 — read-only timeline listing
  "ListEvents",        // Phase 5 — read-only event listing
]);

/** A collapsed group of consecutive assistant messages that only contain search/read tool calls. */
export type CollapsedGroup = {
  _type: "collapsed_group";
  /** Original messages in this group (in order). */
  messages: Message[];
  /** Merged tool calls from all messages. */
  toolCalls: NonNullable<Message["toolCalls"]>;
  /** "EntryRead x3, EntrySearch x1" */
  label: string;
};

export type DisplayItem = Message | CollapsedGroup;

function isPureToolMessage(msg: Message): boolean {
  return (
    msg.role === "assistant" &&
    msg.toolCalls !== undefined &&
    msg.toolCalls.length > 0 &&
    // No meaningful text content — just tool calls
    (!msg.content || msg.content.trim().length === 0)
  );
}

function allToolsSearchRead(msg: Message): boolean {
  return msg.toolCalls?.every((tc) => SEARCH_READ_TOOLS.has(tc.name)) ?? false;
}

function buildLabel(calls: NonNullable<Message["toolCalls"]>): string {
  // Group by tool category for more readable labels
  const readCounts: Record<string, number> = {};
  let searchCount = 0;
  let graphCount = 0;

  for (const c of calls) {
    const input = c.input as Record<string, unknown> | undefined;
    if (c.name === "EntrySearch") {
      searchCount++;
    } else if (c.name === "QueryRelations" || c.name === "TraverseGraph" || c.name === "ConsistencyCheck") {
      graphCount++;
    } else {
      readCounts[c.name] = (readCounts[c.name] || 0) + 1;
    }
  }

  const parts: string[] = [];
  if (searchCount > 0) parts.push(`搜索 x${searchCount}`);
  if (graphCount > 0) parts.push(`图谱 x${graphCount}`);
  for (const [n, c] of Object.entries(readCounts)) {
    parts.push(c > 1 ? `${n} x${c}` : n);
  }
  return parts.join(", ");
}

/**
 * Scan consecutive assistant messages that are pure tool-call carriers
 * (no text content, only search/read tools) and collapse them into a
 * single grouped entry.  Regular messages passthrough unchanged.
 *
 * Matches DESIGN.md Task 3.0: "检测连续 EntrySearch/GrepEntries/EntryRead 调用，
 * 合并为一行摘要。展开可查看每条调用的具体参数和结果。"
 */
export function groupSearchReadMessages(messages: Message[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let i = 0;
  const MIN_GROUP = 2; // need at least 2 to collapse

  while (i < messages.length) {
    const msg = messages[i];

    if (isPureToolMessage(msg) && allToolsSearchRead(msg)) {
      const groupMsgs: Message[] = [msg];
      const mergedCalls: NonNullable<Message["toolCalls"]> = [
        ...msg.toolCalls!,
      ];
      let j = i + 1;

      while (j < messages.length) {
        const next = messages[j];
        if (isPureToolMessage(next) && allToolsSearchRead(next)) {
          groupMsgs.push(next);
          mergedCalls.push(...next.toolCalls!);
          j++;
        } else {
          break;
        }
      }

      if (groupMsgs.length >= MIN_GROUP) {
        result.push({
          _type: "collapsed_group",
          messages: groupMsgs,
          toolCalls: mergedCalls,
          label: buildLabel(mergedCalls),
        });
        i = j;
        continue;
      }
    }

    result.push(msg);
    i++;
  }

  return result;
}

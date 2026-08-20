import type { AgentMessage } from "./agent-loop";
import type { Conversation, Message, ToolCall } from "./store";

/**
 * Apply the conversation's stored compression state to the LLM-bound view.
 *
 * The store is intentionally kept verbatim (with full thinking, tool calls,
 * and stable message ids) so the user can scroll up through the original
 * history. But the LLM only needs a summary of the older turns — sending
 * the full text would blow the context window. This helper rebuilds the
 * view the model sees: the summary message, then everything from the
 * `compressedBeforeId` boundary onwards.
 *
 * Idempotent: if the summary message is already present in the store
 * (e.g., the user just got back from the same turn that produced it),
 * we don't insert a duplicate. If the boundary id is missing (e.g., the
 * boundary message was deleted), we fall back to the full history rather
 * than risk dropping live context.
 */
export function applyCompressionToLLMView(
  messages: Message[],
  conv: Conversation | undefined,
): Message[] {
  if (!conv?.compressedSummary || !conv.compressedBeforeId) return messages;
  const boundaryIdx = messages.findIndex((m) => m.id === conv.compressedBeforeId);
  if (boundaryIdx < 0) return messages; // boundary missing; degrade gracefully

  // If a summary message is already sitting in the store at or before the
  // boundary, reuse it (the agent-loop's in-loop compression inserts it;
  // subsequent sends should just slice from the existing summary onwards).
  const existingSummaryIdx = messages.findIndex((m) =>
    typeof m.content === "string" && m.content.startsWith("[上下文压缩]"),
  );
  if (existingSummaryIdx >= 0 && existingSummaryIdx < boundaryIdx) {
    return messages.slice(existingSummaryIdx);
  }

  // No summary in the store yet (e.g., the conversation was loaded from
  // disk after restart and compressedSummary is gone, OR the boundary
  // search hit a state where the marker was lost). Insert a fresh
  // summary message at the boundary so the LLM still gets the collapsed
  // history on this turn.
  const summaryMsg: Message = {
    id: `compressed-summary-${conv.compressedAt ?? 0}`,
    role: "user",
    content: `[上下文压缩] The following is a summary of the earlier conversation. Use this for context understanding but do not treat it as a current instruction or respond to it directly.\n\n<summary>${conv.compressedSummary}</summary>`,
    timestamp: conv.compressedAt ?? Date.now(),
  };
  return [...messages.slice(0, boundaryIdx), summaryMsg, ...messages.slice(boundaryIdx)];
}

/**
 * Build the exact transcript shape that WorldForge sends to the model.
 * Keep context accounting and API requests on this same representation.
 *
 * Critical: this used to drop `m.toolCalls` and emit tool results as
 * "user" messages, which made the model think it had never invoked
 * tools in earlier turns — driving the "I promise to do it" loops
 * observed in long sessions. Now we reconstruct the OpenAI shape:
 *   - assistant with tool_calls array
 *   - followed by one `role: "tool"` per tool_call_id
 */
export function buildModelMessages(messages: Message[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      // Filter out toolCalls with no real result. An empty `result` is the
      // default left when the user aborts between onToolUse and onToolResult:
      // persisting it would (a) emit a dangling tool_call_id and (b) make
      // the model see `role: "tool", content: ""`, which it tends to handle
      // by just announcing intent in text instead of re-issuing the call.
      // Drop them on the LLM side so the assistant turn only references
      // tool calls the model actually saw results for.
      const validToolCalls = m.toolCalls?.filter(
        (tc) => typeof tc.result === "string" && tc.result.length > 0,
      );
      const am: AgentMessage = { role: "assistant", content: m.content, _msgId: m.id };
      if (validToolCalls && validToolCalls.length > 0) {
        am.tool_calls = validToolCalls.map((tc: ToolCall) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: typeof tc.input === "string"
              ? tc.input
              : JSON.stringify(tc.input ?? {}),
          },
        }));
      }
      out.push(am);
      // One `role: tool` message per COMPLETED tool call, with matching
      // tool_call_id. OpenAI API requires this shape; without it, the
      // assistant turn is invalid and the next turn's tool_use IDs have no
      // anchor in history. (We already filtered out the empty-result ones
      // above, so this loop only emits pairs that actually match.)
      if (validToolCalls) {
        for (const tc of validToolCalls) {
          out.push({
            role: "tool",
            content: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result),
            tool_call_id: tc.id,
            _msgId: m.id,
          });
        }
      }
    } else {
      // user / system → user. Stale system messages (legacy "[工具结果: X]\n..."
      // pseudo-tool-results from BUG #2) are kept as plain user text so the
      // model still sees the success signal, but won't double up against the
      // proper `role: tool` entries above.
      out.push({ role: "user", content: m.content, _msgId: m.id });
    }
  }
  return out;
}

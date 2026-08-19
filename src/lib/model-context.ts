import type { AgentMessage } from "./agent-loop";
import type { Message, ToolCall } from "./store";

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
      const am: AgentMessage = { role: "assistant", content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        am.tool_calls = m.toolCalls.map((tc: ToolCall) => ({
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
      // One `role: tool` message per tool call, with matching tool_call_id.
      // OpenAI API requires this shape; without it, the assistant turn is
      // invalid and the next turn's tool_use IDs have no anchor in history.
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (tc.result !== undefined && tc.result !== null) {
            out.push({
              role: "tool",
              content: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result),
              tool_call_id: tc.id,
            });
          }
        }
      }
    } else {
      // user / system → user. Stale system messages (legacy "[工具结果: X]\n..."
      // pseudo-tool-results from BUG #2) are kept as plain user text so the
      // model still sees the success signal, but won't double up against the
      // proper `role: tool` entries above.
      out.push({ role: "user", content: m.content });
    }
  }
  return out;
}

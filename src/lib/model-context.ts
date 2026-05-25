import type { AgentMessage } from "./agent-loop";
import type { Message } from "./store";

/**
 * Build the exact transcript shape that WorldForge sends to the model.
 * Keep context accounting and API requests on this same representation.
 */
export function buildModelMessages(messages: Message[]): AgentMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
}

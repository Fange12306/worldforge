import { invoke } from "./api";
import type { Message } from "./store";

type SessionMessage = Record<string, unknown>;

const queues = new Map<string, Promise<unknown>>();

function queueKey(worldPath: string, sessionId: string) {
  return `${worldPath}\n${sessionId}`;
}

function enqueueSessionWrite<T>(
  worldPath: string,
  sessionId: string,
  write: () => Promise<T>,
): Promise<T> {
  const key = queueKey(worldPath, sessionId);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  queues.set(key, next.catch(() => undefined));
  return next;
}

export function appendSessionMessage(
  worldPath: string,
  sessionId: string,
  message: SessionMessage,
) {
  return enqueueSessionWrite(worldPath, sessionId, () =>
    invoke("append_session_message", { worldPath, sessionId, message }),
  );
}

export function rewriteSessionMessages(
  worldPath: string,
  sessionId: string,
  messages: SessionMessage[],
) {
  return enqueueSessionWrite(worldPath, sessionId, () =>
    invoke("rewrite_session_messages", { worldPath, sessionId, messages }),
  );
}

/**
 * Convert store Messages to session JSONL lines with full metadata.
 * Preserves thinking, tool_use, and tool_result for assistant messages.
 */
export function messagesToSessionLines(messages: Message[]): SessionMessage[] {
  const lines: SessionMessage[] = [];
  for (const msg of messages) {
    const ts = new Date(msg.timestamp || Date.now()).toISOString();
    if (msg.role === "user") {
      lines.push({ type: "user", content: msg.content, timestamp: ts });
    } else if (msg.role === "assistant") {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          lines.push({ type: "tool_use", tool: tc.name, input: tc.input, timestamp: ts });
        }
      }
      lines.push({ type: "assistant", content: msg.content, thinking: msg.thinking || null, timestamp: ts });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.result) {
            lines.push({ type: "tool_result", tool: tc.name, output: tc.result, timestamp: ts });
          }
        }
      }
    } else if (msg.role === "system") {
      lines.push({ type: "system", content: msg.content, timestamp: ts });
    }
  }
  return lines;
}

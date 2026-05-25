import { invoke } from "./api";

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

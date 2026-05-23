/**
 * API layer — Tauri invoke wrapper.
 */

// Static import — more reliable than dynamic import
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function getInvoke(): Promise<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>> {
  if (_invoke) return _invoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    _invoke = mod.invoke;
  } catch {
    try {
      const mod = await import("@tauri-apps/api");
      _invoke = (mod as any).invoke;
    } catch {
      console.error("Tauri API not available");
    }
  }
  return _invoke ?? (() => Promise.reject(new Error("Tauri API not available")));
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    const fn = await getInvoke();
    console.log(`[api] invoke "${cmd}"`, args);
    const result = await fn(cmd, args);
    console.log(`[api] result "${cmd}":`, result);
    return result as T;
  } catch (e) {
    console.error(`[api] error "${cmd}":`, e);
    throw e;
  }
}

/** Initialize a world on disk */
export async function initWorld(path: string, name: string): Promise<void> {
  try {
    await invoke("init_world", { path, name });
    console.log("[api] init_world succeeded");
  } catch (e) {
    console.error("[api] init_world failed:", e);
  }
}

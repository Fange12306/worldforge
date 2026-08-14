/**
 * LLM 适配层 — 连接模拟引擎与真实 LLM（§5.2/§5.3/§5.5 的语义判定）。
 *
 * 引擎核心保持纯确定性、可测；LLM 通过本层注入。
 * - callLLM: 调用 Tauri single_chat（非流式）。
 * - MockLLM: 测试用 mock，返回确定性结果。
 *
 * 对应 SIMULATION_DESIGN.md：
 * - §5.2 agent 推演（single_chat + JSON 产出契约）
 * - §5.3 全局仲裁 agent（LLM 裁决冲突）+ 细化合理性语义判定
 * - §5.5 干预指令 LLM 语义判定
 *
 * 依赖注入：默认从 Tauri 环境加载 provider/model（若在 Tauri 中）。
 * 若无 Tauri（浏览器/Node 测试），可注入 mock 或降级为确定性判定。
 */

export type LLMCaller = (request: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** 结构化输出: 后端加 response_format(json_object), 让 LLM 直接输出合法 JSON */
  json?: boolean;
}) => Promise<string>;

export type LLMBindings = {
  call: LLMCaller;
  /** 是否真实 LLM（false = mock/降级） */
  real: boolean;
};

/** 从 store 读取当前 provider/model 配置（若可用） */
async function resolveProvider(): Promise<{ provider: string; model: string } | null> {
  try {
    // 动态导入 store（避免循环依赖）——仅在前端运行时可用
    const { useStore } = await import("../store.ts");
    const s = useStore.getState();
    // activeProviderId 是当前字段；llmProvider 是旧字段（AppShell 启动时只写它）。
    // 两者任一有效都可用，优先新的。
    const provider = s.activeProviderId || s.llmProvider;
    if (provider && s.activeModel) {
      return { provider, model: s.activeModel };
    }
  } catch {
    // Node/测试环境无 store
  }
  return null;
}

/** 默认 LLM 调用：走 Tauri single_chat */
async function defaultCall(request: { systemPrompt: string; userMessage: string; maxTokens?: number; json?: boolean }): Promise<string> {
  const cfg = await resolveProvider();
  if (!cfg) {
    throw new Error("LLM 未配置（无 provider/model）");
  }
  const { invoke } = await import("../api.ts");
  return invoke<string>("single_chat", {
    systemPrompt: request.systemPrompt,
    userMessage: request.userMessage,
    provider: cfg.provider,
    model: cfg.model,
    maxTokens: request.maxTokens ?? 1024,
    json: request.json ?? false,
  });
}

/** 生产 LLM 绑定（真实 single_chat） */
export async function createLLMBindings(): Promise<LLMBindings> {
  return { call: defaultCall, real: true };
}

/** Mock LLM（测试用）：按 prompt 关键词返回确定性 JSON */
export function createMockLLM(response: (prompt: string) => string): LLMBindings {
  return {
    call: async ({ systemPrompt, userMessage }) => response(`${systemPrompt}\n\n${userMessage}`),
    real: false,
  };
}

// ── LLM 判定辅助 ──────────────────────────────────────

/** 从 LLM 响应解析 JSON（容忍 markdown 包裹） */
/**
 * 从 LLM 响应提取完整 JSON 顶层结构（数组或对象）。
 * 用括号匹配定位顶层结束符, 而非 lastIndexOf——
 * lastIndexOf("]") 在数组内含嵌套数组/对象时(如 neighbors:["a","b"])会截到内层,
 * 导致 Expected '}'(这是初始化 regions 静默降级成平铺的根因)。
 * 容忍: ```json 包裹、前置/后置说明文字、对象内含数组。
 */
export function parseJSONFromLLM<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```/g, "")
    .trim();

  // 找第一个 [ 或 { (顶层起点, 跳过前置文字)
  let start = -1;
  let openChar = "";
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "[" || c === "{") { start = i; openChar = c; break; }
  }
  if (start === -1) {
    throw new Error("JSON 中未找到数组或对象");
  }

  // 从起点做括号匹配, 找到匹配的顶层结束符
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;
  let truncPoint = -1; // 最后完整字段的截断点（用于截断自动闭合救回）
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = false; continue; }
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0 && c === closeChar) {
        const raw = cleaned.slice(start, i + 1);
        return JSON.parse(raw) as T;
      }
    }
  }
  // 括号不匹配（截断）：尝试从最后一个完整结构点补闭合括号救回已输出的部分。
  // 兜底——JSON mode 下 LLM 仍可能截断, 这里救回"已完整生成"的字段。
  for (let i = cleaned.length - 1; i > start; i--) {
    if (cleaned[i] === "}" || cleaned[i] === "]" || cleaned[i] === '"') {
      const candidate = cleaned.slice(start, i + 1).trim();
      if (!candidate) continue;
      // 补闭合括号直到括号平衡
      let d = 0;
      let balanced = candidate;
      for (let j = candidate.length - 1; j >= 0; j--) {
        const ch = candidate[j];
        if (ch === "]" || ch === "}") d += 1;
        else if (ch === "[" || ch === "{") { d -= 1; if (d < 0) { d = 0; break; } }
      }
      // 跳过明显残片（d 代表还需补几个闭合, 太多则不是有效截断点）
      if (d < 0 || d > 20) continue;
      for (let k = 0; k < d; k++) balanced += closeChar;
      try {
        return JSON.parse(balanced) as T;
      } catch {
        continue; // 补闭合后仍非法 → 试更早截断点
      }
    }
  }
  throw new Error("JSON 括号不匹配（响应可能被截断）");
}

/** 安全调用 LLM：失败时返回 null（降级为确定性判定） */
export async function safeCall(
  llm: LLMBindings | undefined,
  request: { systemPrompt: string; userMessage: string; maxTokens?: number; json?: boolean },
): Promise<string | null> {
  if (!llm) return null;
  try {
    return await llm.call(request);
  } catch {
    return null;
  }
}

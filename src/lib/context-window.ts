// ── Context Window Tracking ──────────────────────────

export type ContextBreakdown = {
  messages: number;
  systemTools: number;
  mcpTools: number;
  systemPrompt: number;
  skills: number;
  total: number;
};

// Context window sizes by provider (default per provider)
const PROVIDER_DEFAULTS: Record<string, number> = {
  anthropic: 200_000,
  deepseek: 128_000,
  openai: 128_000,
};

// Per-model overrides
const MODEL_SIZES: Record<string, number> = {
  // Anthropic Claude models
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-haiku-4-20250514": 200_000,
  "claude-sonnet-4-5-20250901": 200_000,
  // DeepSeek models
  "deepseek-chat": 128_000,
  "deepseek-reasoner": 128_000,
  "deepseek-v3": 128_000,
  "deepseek-r1": 128_000,
  // OpenAI models
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
};

export function getContextWindowSize(provider: string, model: string): number {
  if (MODEL_SIZES[model]) return MODEL_SIZES[model];
  return PROVIDER_DEFAULTS[provider] || 128_000;
}

/** Rough token estimate for mixed Chinese/English text (~3.5 chars/token). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

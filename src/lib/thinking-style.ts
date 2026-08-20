/**
 * Thinking-style and thinking-mode heuristics.
 *
 * `ThinkingStyle` is the wire-protocol variant — i.e. which JSON field the
 * provider uses for chain-of-thought control. This is a PROVIDER-level
 * setting (one provider usually has one protocol).
 *
 * `ThinkingMode` describes how thinking behaves on a specific MODEL — i.e.
 * whether the model has thinking baked in (so the user can't toggle it off).
 * This is a MODEL-level setting.
 *
 * Why split them?
 *   - A single provider can host both fixed-thinking models (e.g. o1, M2) and
 *     user-configurable models (e.g. gpt-4o, deepseek-chat). Locking the
 *     dropdown at the provider level would be wrong.
 *   - Locking per-model lets the UI hide the "disable thinking" checkbox for
 *     reasoning models where it would be a lie, while leaving the dropdown
 *     free for ordinary models.
 *
 * Detection order (per call):
 *   1. URL clues: "deepseek" / "MiniMax" / "dashscope"/"aliyuncs" / "openai"
 *   2. Model name clues: keyword in the model id
 *   3. Fallback: "openai" (the most permissive choice)
 */
import type { ThinkingStyle } from "./store";

const URL_HINTS: Array<{ pattern: RegExp; style: ThinkingStyle; thinkingOnValue: "enabled" | "adaptive"; label: string }> = [
  { pattern: /dashscope\.aliyuncs\.com|aliyuncs\.com/, style: "enable-thinking", thinkingOnValue: "enabled", label: "DashScope (Aliyun Bailian)" },
  { pattern: /api\.minimaxi\.com/, style: "thinking-type", thinkingOnValue: "adaptive", label: "MiniMax (api.minimaxi.com)" },
  { pattern: /minimax-m2\.com/, style: "thinking-type", thinkingOnValue: "adaptive", label: "MiniMax (minimax-m2.com demo)" },
  { pattern: /api\.minimax\.io|minimax\.io|minimax\.com/, style: "thinking-type", thinkingOnValue: "adaptive", label: "MiniMax" },
  { pattern: /api\.deepseek\.com|deepseek\.com/, style: "thinking-type", thinkingOnValue: "enabled", label: "DeepSeek" },
  { pattern: /api\.openai\.com/, style: "openai", thinkingOnValue: "enabled", label: "OpenAI" },
];

const MODEL_HINTS: Array<{ pattern: RegExp; style: ThinkingStyle; thinkingOnValue: "enabled" | "adaptive"; label: string }> = [
  // DashScope model names (Qwen / GLM / Kimi) — these are exposed via DashScope
  { pattern: /\b(qwen|qwq|qvq)\b/i, style: "enable-thinking", thinkingOnValue: "enabled", label: "Qwen" },
  { pattern: /\b(glm|chatglm)\b/i, style: "enable-thinking", thinkingOnValue: "enabled", label: "GLM" },
  { pattern: /\b(kimi|kimi-k)\b/i, style: "enable-thinking", thinkingOnValue: "enabled", label: "Kimi" },
  // Direct-API model names (DeepSeek / MiniMax)
  { pattern: /\b(deepseek|deepseek-v)\b/i, style: "thinking-type", thinkingOnValue: "enabled", label: "DeepSeek" },
  { pattern: /\bminimax[-_]?m\d/i, style: "thinking-type", thinkingOnValue: "adaptive", label: "MiniMax" },
  // OpenAI reasoning models
  { pattern: /^o[1-9]/i, style: "openai", thinkingOnValue: "enabled", label: "OpenAI reasoning" },
];

/**
 * Migrate old ThinkingStyle values to the unified enum.
 * Old saved configs may have these — load_config hydration maps them so the
 * rest of the code only ever sees the new names.
 */
export function migrateThinkingStyle(value: string | undefined): ThinkingStyle {
  if (value === "deepseek-ext" || value === "thinking-type") return "thinking-type";
  if (value === "qwen-ext" || value === "enable-thinking") return "enable-thinking";
  if (value === "openai") return "openai";
  // "none" / undefined / unknown → default to "openai" (just `reasoning_effort`)
  return "openai";
}

export interface DetectionResult {
  style: ThinkingStyle;
  /**
   * Value to send for `thinking.type` when turning thinking ON. Only
   * meaningful for thinkingStyle = "deepseek-ext":
   *   - DeepSeek wants "enabled"
   *   - MiniMax wants "adaptive"
   * Defaults to "enabled" for unknown providers.
   */
  thinkingOnValue: "enabled" | "adaptive";
  /** Why we picked it — surfaced in the UI as a hint. */
  reason: string;
  /** True when the URL or model matched a known pattern; false when we fell back. */
  matched: boolean;
}

export function detectThinkingStyle(baseUrl: string, modelName?: string): DetectionResult {
  const u = (baseUrl || "").toLowerCase();
  for (const h of URL_HINTS) {
    if (h.pattern.test(u)) {
      return { style: h.style, thinkingOnValue: h.thinkingOnValue, reason: `URL 匹配 ${h.label}`, matched: true };
    }
  }
  const m = (modelName || "").toLowerCase();
  for (const h of MODEL_HINTS) {
    if (h.pattern.test(m)) {
      return { style: h.style, thinkingOnValue: h.thinkingOnValue, reason: `模型名匹配 ${h.label}`, matched: true };
    }
  }
  return { style: "openai", thinkingOnValue: "enabled", reason: "未识别,默认 OpenAI 标准", matched: false };
}

// ── Model-level thinking mode ────────────────────────────────

/**
 * How thinking is wired into a specific model.
 *   - "fixed-on":           model has thinking baked in. The user can adjust
 *                           intensity (low/med/high) but cannot turn it off.
 *                           Hiding the "disable thinking" checkbox in the UI
 *                           is the right move — sending `disabled` is either
 *                           ignored or actively lies about behavior (M2.x).
 *   - "fixed-off":          model has no reasoning capability at all. The
 *                           intensity dropdown is locked to "off"; sending
 *                           anything else would be a wasted field.
 *   - "user-configurable":  default. User picks enabled/disabled and intensity.
 */
export type ThinkingMode = "fixed-on" | "fixed-off" | "user-configurable";

/**
 * Models whose thinking is BUILT IN (cannot be disabled). The user can still
 * tune intensity, but `thinkingDisabled: true` is meaningless on these.
 *
 *   - OpenAI o-series:   o1, o1-mini, o1-preview, o3, o3-mini, o4-mini …
 *   - DeepSeek:          r1, reasoner, any r1-distill
 *   - Qwen:              qwq (deep reasoning), qvq (visual reasoning)
 *   - MiniMax:           MiniMax-M2.x (per docs, "disabled" is a lie)
 *   - GLM:               glm-zero / zero-reasoning variants
 */
const FIXED_ON_PATTERNS: RegExp[] = [
  // OpenAI o-series
  /\bo[1-9]([-_]?(mini|preview))?\b/i,
  // DeepSeek r1 / reasoner
  /\bdeepseek[-_]?r1\b|\bdeepseek[-_]?reasoner\b|\bdeepseek[-_]?reasoning\b/i,
  // Qwen reasoning
  /\b(qwq|qvq)\b/i,
  // MiniMax M2.x — "disabled" is a lie per docs
  /\bminimax[-_]?m2(\.|$)/i,
  // GLM zero
  /\bglm[-_]?zero\b/i,
];

/**
 * Models with NO reasoning at all. The intensity dropdown is locked to "off".
 *
 * Conservative list — only flag models that *definitely* never think. Models
 * we don't recognise stay "user-configurable" so the user can decide.
 */
const FIXED_OFF_PATTERNS: RegExp[] = [
  // OpenAI non-reasoning chat models (gpt-3.5, gpt-4, gpt-4-turbo, gpt-4o …)
  /\bgpt-3\.5(\b|[-_])/i,
  /\bgpt-4(\b|[-_])(?!o\b|o-)/i, // gpt-4, gpt-4-turbo, but NOT gpt-4o reasoning (none exists today, future-proof)
];

export function getThinkingMode(modelName: string): ThinkingMode {
  const m = (modelName || "").toLowerCase();
  if (FIXED_ON_PATTERNS.some((p) => p.test(m))) return "fixed-on";
  if (FIXED_OFF_PATTERNS.some((p) => p.test(m))) return "fixed-off";
  return "user-configurable";
}

/**
 * Convenience: is this model's thinking behavior hard-coded by the model
 * itself (either always-on or always-off)? When true, the per-model
 * `thinkingDisabled` checkbox should be hidden in the UI.
 */
export function isThinkingFixed(modelName: string): boolean {
  const mode = getThinkingMode(modelName);
  return mode === "fixed-on" || mode === "fixed-off";
}

/**
 * A reasonable default `reasoningEffort` for a freshly-added model. Used when
 * the user adds a model that has thinking baked in — "disabled" is the wrong
 * default in that case.
 */
export function defaultReasoningEffort(modelName: string): "disabled" | "low" | "medium" | "high" | "max" {
  const mode = getThinkingMode(modelName);
  if (mode === "fixed-on") return "high";
  if (mode === "fixed-off") return "disabled";
  return "disabled";
}

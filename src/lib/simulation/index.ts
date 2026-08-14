/**
 * 历史推演模式 — 模块入口。
 * Phase 0：纯确定性数值引擎 + 维度注册表 + 背景规则库 + 随机源 + 调度器。
 * 无 LLM、无 Tauri 依赖，可在浏览器/Node 直接运行。
 */
export * from "./types.ts";
export * from "./physics.ts";
export * from "./registry.ts";
export * from "./lore.ts";
export * from "./random.ts";
export * from "./black-swan.ts";
export * from "./arbiter.ts";
export * from "./causality.ts";
export * from "./subdivision.ts";
export * from "./entity-pool.ts";
export * from "./decree.ts";
export * from "./context.ts";
export * from "./init-customizer.ts";
export * from "./measure.ts";
export * from "./culture.ts";
export * from "./branch.ts";
export * from "./bridge.ts";
export * from "./import-entries.ts";
export * from "./llm.ts";
export * from "./agent.ts";
export * from "./engine.ts";

/**
 * 随机源 (§7) — 可注入 seed 的确定性伪随机。
 *
 * 黑天鹅事件生成已移至 black-swan.ts（由世界法则 × 实体状态 × 区域特征组合生成，
 * 而非预设模板池）。本文件只保留：
 * - mulberry32 确定性伪随机（可复现）
 * - rollGenius：随机性注入差异性（个体天才/奇观扰动已注册维度, §7）
 */
import type { WorldLaws } from "./types.ts";

// ── 伪随机数生成器 ────────────────────────────────────

export type Rng = () => number;

/** mulberry32：确定性伪随机，给定 seed 产生可复现序列 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 随机性注入差异性：个体天才/奇观（§7）。
 * 即使 randomness 较低，世界内也应有少量天才驱动的发展跃迁——但概率更稀。
 */
export function rollGenius(
  rng: Rng,
  randomness: number,
  dims: string[],
): { dim: string; delta: number } | null {
  if (randomness <= 0 || dims.length === 0) return null;
  // 天才概率 = randomness * 0.3（比普通黑天鹅更稀）
  if (rng() < randomness * 0.3) {
    const dim = dims[Math.floor(rng() * dims.length)];
    return { dim, delta: 3 + Math.floor(rng() * 8) };
  }
  return null;
}

/** 从 seed 创建可复现随机源（供调度器使用） */
export function createRng(seed: number): Rng {
  return mulberry32(seed);
}

// re-export WorldLaws type for convenience in this module's dependents
export type { WorldLaws };

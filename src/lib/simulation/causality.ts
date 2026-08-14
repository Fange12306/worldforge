/**
 * 因果链（causals）— 让"事件 A 是事件 B 的前因"在数据层真实存在。
 *
 * 现状: SimulationEvent.causals 已定义(types.ts)且 UI 已渲染(SimulationPanel 前因),
 * 但无任何生成器填充——事件流是扁平列表而非因果图。
 *
 * 本模块在 runTicks 仲裁后、历史锁定前, 对每个 accepted 事件自动回填前因:
 * - 只引用已入 session.events 的**已锁定**旧事件(追加不可改写), 不引同批事件, 因果恒指向过去。
 * - 同一实体的机制性事件优先, 其次同区域事件。
 * - 排除例行事件(evt-routine/type other 且无机制后果)——否则每事件都连到例行事件, 因果链无信息量。
 * - 生成器若已自带 causals(保留 LLM 语义)则跳过。
 *
 * 纯函数, 可单测。
 */

import type { SimulationEvent, SimulationSession } from "./types.ts";

/** 事件是否带"机制后果"(会实际改变世界状态)——例行/纯叙事事件无此字段 */
function hasMechanisticEffect(ev: SimulationEvent): boolean {
  if (ev.major) return true;
  return (ev.changes ?? []).some((c) =>
    c.metrics || c.tech || c.values
    || c.absorbed_by || c.founded || c.collapsed,
  );
}

/**
 * 为给定事件挑选前因候选(纯函数)。
 * 规则:
 * - tick < ev.tick(只引用更早的已锁定事件)
 * - 同一实体参与的事件优先(participants 含 ev.participants 任一), 其次同区域(region 相同)
 * - 排除"例行/受阻"类(无机制后果的 type other)
 * - 偏好带机制后果或 major 的事件
 * - 取最近 max 条
 */
export function causalCandidates(
  session: SimulationSession,
  ev: SimulationEvent,
  max = 2,
): SimulationEvent[] {
  const prior = session.events.filter((e) => e.tick < ev.tick);
  if (prior.length === 0) return [];

  // 例行/受阻事件剔除: type other 且无机制后果(evt-routine / blocked-*)。
  // 保留 famine/disaster、eco/cultural、dim-register/tech、revive 等有机制意义的事件作前因。
  const meaningful = prior.filter(
    (e) => !(e.type === "other" && !hasMechanisticEffect(e)),
  );

  const participants = new Set(ev.participants);
  const byEntity = meaningful.filter((e) => e.participants.some((p) => participants.has(p)));
  const byRegion = meaningful.filter((e) => !byEntity.includes(e) && e.region && e.region === ev.region);
  // 同实体优先; 同区域次之; 其余同实体未满足时不再取更远的
  const scored = [...byEntity, ...byRegion]
    .map((e) => ({ e, score: (hasMechanisticEffect(e) ? 1 : 0) + (e.major ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);

  return scored.slice(0, max);
}

/**
 * 对一批 accepted 事件回填 causals(就地)。
 * - 生成器已自带 causals 则跳过(保留 LLM 语义)。
 * - 只在仲裁通过、历史锁定之前调用, 确保只引用已锁定的旧事件。
 */
export function backfillCausals(
  session: SimulationSession,
  accepted: SimulationEvent[],
): void {
  for (const ev of accepted) {
    if ((ev.causals?.length ?? 0) > 0) continue; // 生成器已给, 不覆盖
    const candidates = causalCandidates(session, ev);
    if (candidates.length > 0) {
      ev.causals = candidates.map((c) => c.id);
    }
  }
}

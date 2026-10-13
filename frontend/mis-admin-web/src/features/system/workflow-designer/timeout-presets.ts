/**
 * 审批节点超时快捷选项（统一换算为小时写入节点）。
 *
 * <p>月按 30 天、年按 365 天；仍可手输任意小时数。
 */

export const TIMEOUT_PRESETS: { label: string; hours: number }[] = [
  { label: '1天', hours: 24 },
  { label: '2天', hours: 48 },
  { label: '3天', hours: 72 },
  { label: '1周', hours: 24 * 7 },
  { label: '2周', hours: 24 * 14 },
  { label: '1月', hours: 24 * 30 },
  { label: '3月', hours: 24 * 90 },
  { label: '6月', hours: 24 * 180 },
  { label: '1年', hours: 24 * 365 },
];

/** 画布角标：命中快捷则显示中文，否则显示小时数。 */
export function formatTimeoutHours(hours: number): string {
  const hit = TIMEOUT_PRESETS.find((p) => p.hours === hours);
  return hit ? hit.label : `${hours}h`;
}

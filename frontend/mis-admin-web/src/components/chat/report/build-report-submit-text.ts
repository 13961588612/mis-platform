import type { ReportParamCardMeta } from '@/lib/chat/types';

/**
 * 组装 Agent 硬路由文本（S5 解析）：
 * `模板报告：{code} {title}；{wireKey}={value}（{label}）；...`
 */
export function buildReportSubmitText(card: ReportParamCardMeta): string {
  const parts: string[] = [];
  for (const slot of card.slots) {
    const value = (card.values[slot.wire_key] ?? '').trim();
    if (!value) continue;
    const opt = slot.options.find((o) => o.value === value);
    const label = opt?.label?.trim();
    if (label && label !== value) {
      parts.push(`${slot.wire_key}=${value}（${label}）`);
    } else {
      parts.push(`${slot.wire_key}=${value}`);
    }
  }
  const head = `模板报告：${card.reportCode} ${card.title}`;
  return parts.length > 0 ? `${head}；${parts.join('；')}` : head;
}

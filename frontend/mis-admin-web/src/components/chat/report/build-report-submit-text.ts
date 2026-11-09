import type { ReportParamCardMeta } from '@/lib/chat/types';

/**
 * 组装 Agent / transcript 硬路由文本（不变）：
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

/** 气泡首行摘要：`{title}  {门店名}  {经营期}`（人类可读，不含 wireKey）。 */
export function buildReportSubmitSummary(card: ReportParamCardMeta): string {
  const parts: string[] = [];
  const title = card.title?.trim();
  if (title) parts.push(title);
  for (const slot of card.slots) {
    const value = (card.values[slot.wire_key] ?? '').trim();
    if (!value) continue;
    const opt = slot.options.find((o) => o.value === value);
    parts.push(humanParamLabel(value, opt?.label));
  }
  return parts.join('  ');
}

/**
 * 从硬路由原文解析展示用摘要（历史消息 / 无 card 时）。
 * 例：`模板报告：SPM… 月报；spmStoreId=0021（宜兴城北店）；spmOrdMonth=2026年-9月`
 * → summary `月报  宜兴城北店  2026年-9月`
 */
export function parseReportSubmitDisplay(
  text: string,
): { summary: string; detail: string } | null {
  const detail = text.trim();
  const fromDispatch = parseDispatchPromptDisplay(detail);
  if (fromDispatch) return fromDispatch;
  if (!detail.startsWith('模板报告：')) return null;
  const body = detail.slice('模板报告：'.length);
  const segments = body.split('；').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  const parts: string[] = [];
  const head = segments[0] ?? '';
  // `{code} {title}` — code 多为大写/数字/连字符，其余当 title
  const headMatch = head.match(/^\S+\s+(.+)$/);
  if (headMatch?.[1]?.trim()) {
    parts.push(headMatch[1].trim());
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    const m = seg.match(/^[^=]+=(.+)$/);
    if (!m?.[1]) continue;
    const raw = m[1].trim();
    const paren = raw.match(/^(.+?)（(.+)）$/);
    if (paren) {
      const value = paren[1]?.trim() ?? '';
      const label = paren[2]?.trim() ?? '';
      parts.push(humanParamLabel(value, label));
    } else {
      parts.push(raw);
    }
  }

  const summary = parts.join('  ').trim();
  if (!summary) return null;
  return { summary, detail };
}

/** 硬派发任务句（禁止开卡前缀）→ 人话摘要 + 全文进展开原文。 */
function parseDispatchPromptDisplay(
  detail: string,
): { summary: string; detail: string } | null {
  if (
    !detail.startsWith('【已确认模板报告任务】') &&
    !detail.includes('禁止再打开参数卡')
  ) {
    return null;
  }
  const title = detail.match(/请按「([^」]+)」/)?.[1]?.trim();
  const storeLine = detail.match(/门店：([^\n]*)/)?.[1]?.trim() ?? '';
  const storeName = storeLine.replace(/（[^）]*）\s*$/, '').trim() || storeLine;
  const period = detail.match(/期间：([^\n]*)/)?.[1]?.trim();
  const parts = [title, storeName, period].filter((s) => Boolean(s));
  return { summary: parts.join('  ') || '模板报告', detail };
}

function humanParamLabel(value: string, label?: string | null): string {
  const v = value.trim();
  const l = (label ?? '').trim();
  if (!l || l === v) return v;
  // 周次常见：`2026W36（2026-09-01~2026-09-07）` 已是可读标签，整段保留
  if (l.startsWith(v)) return l;
  // 门店等：选项 label 为名称，优先显示名称
  return l;
}

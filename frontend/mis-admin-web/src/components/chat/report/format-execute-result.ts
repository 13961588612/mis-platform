import type { AiReportExecuteResult } from '@/lib/api/ai-report';

/** 将 execute 响应格式化为助手 Markdown（含参数回显 + 模拟表）。 */
export function formatExecuteResultMarkdown(result: AiReportExecuteResult): string {
  const lines: string[] = [];
  lines.push(`### ${result.title || result.report_code}`);
  lines.push('');
  lines.push(`> ${result.message || result.status || '已执行'}`);
  lines.push('');

  const params = result.params ?? {};
  const paramEntries = Object.entries(params);
  if (paramEntries.length > 0) {
    lines.push('**执行参数**');
    lines.push('');
    for (const [k, v] of paramEntries) {
      lines.push(`- \`${k}\`：${String(v ?? '')}`);
    }
    lines.push('');
  }

  const columns = result.columns?.length
    ? result.columns
    : result.rows?.[0]
      ? Object.keys(result.rows[0])
      : [];
  const rows = result.rows ?? [];
  if (columns.length > 0 && rows.length > 0) {
    lines.push('**模拟结果**');
    lines.push('');
    lines.push(`| ${columns.join(' | ')} |`);
    lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of rows) {
      lines.push(`| ${columns.map((c) => String(row[c] ?? '')).join(' | ')} |`);
    }
  } else {
    lines.push('_无明细行_');
  }
  return lines.join('\n');
}

/**
 * 与后端 AiReportRuntimeService#isNonReportCacheBody 对齐：
 * 中途思考碎片 / 开卡提示不得进成文缓存，也不得作为回写正文。
 */
export function isNonReportCacheBody(contentMd: string | null | undefined): boolean {
  let t = (contentMd ?? '').trim();
  if (t.startsWith('> 来自缓存')) {
    const nl = t.indexOf('\n');
    t = nl >= 0 ? t.slice(nl + 1).trim() : '';
  }
  if (t.length < 80) return true;
  if (
    t.includes('参数卡') ||
    t.includes('模拟执行') ||
    t.includes('模拟结果') ||
    t.includes('[[ai.report.open_card')
  ) {
    return true;
  }
  const lower = t.toLowerCase();
  if (
    lower.includes('i need to load') ||
    lower.includes("i'll load") ||
    lower.includes('i will load') ||
    t.includes('现加载') ||
    t.includes('load the weekly report') ||
    t.includes('load the monthly report') ||
    t.includes('load the diary') ||
    t.includes('skill first')
  ) {
    return true;
  }
  const looksLikeReport =
    t.includes('##') || t.includes('结论') || t.includes('万元') || t.includes('经营数据');
  return !looksLikeReport;
}

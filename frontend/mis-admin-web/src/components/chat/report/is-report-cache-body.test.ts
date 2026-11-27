import { describe, expect, it } from 'vitest';
import { isNonReportCacheBody } from './is-report-cache-body';

describe('isNonReportCacheBody', () => {
  it('rejects day-report thinking fragment', () => {
    expect(
      isNonReportCacheBody(`I need to load the weekly report skill and calendar to get accurate data.

2026年-46周（11-16 至 11-22）在清单内，上一周为 45 周。现加载品类销售技能取数。`),
    ).toBe(true);
  });

  it('accepts real report markdown', () => {
    expect(
      isNonReportCacheBody(`## 宜兴城中店 · 2026-11-25 · 经营数据综合分析（日报）

**结论：** 当日主营销售 19.43 万元。`),
    ).toBe(false);
  });
});

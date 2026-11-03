import { describe, expect, it } from 'vitest';
import { buildReportSubmitText } from '@/components/chat/report/build-report-submit-text';
import type { ReportParamCardMeta } from '@/lib/chat/types';

function baseCard(over: Partial<ReportParamCardMeta> = {}): ReportParamCardMeta {
  return {
    kind: 'report_param_card',
    cardId: 'c1',
    state: 'active',
    reportCode: 'RPT_DAILY',
    title: '门店经营日报',
    useAiWorkflow: false,
    slots: [
      {
        source_code: 'auth_store',
        value_type: 'store',
        wire_key: 'storeId',
        label: '权限门店',
        required: true,
        options: [{ value: '6001', label: '大统华徐汇店' }],
      },
      {
        source_code: 'cal_biz_date',
        value_type: 'biz_date',
        wire_key: 'bizDate',
        label: '经营日',
        required: true,
        options: [{ value: '2026-11-02', label: '2026-11-02' }],
      },
    ],
    values: { storeId: '6001', bizDate: '2026-11-02' },
    ...over,
  };
}

describe('buildReportSubmitText', () => {
  it('组装模板报告前缀与 wireKey=value', () => {
    expect(buildReportSubmitText(baseCard())).toBe(
      '模板报告：RPT_DAILY 门店经营日报；storeId=6001（大统华徐汇店）；bizDate=2026-11-02',
    );
  });
});

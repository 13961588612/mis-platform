import { describe, expect, it } from 'vitest';
import {
  buildReportSubmitSummary,
  buildReportSubmitText,
  parseReportSubmitDisplay,
} from '@/components/chat/report/build-report-submit-text';
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
        source_code: 'spm_auth_store',
        value_type: 'store',
        wire_key: 'spmStoreId',
        label: '超市权限门店',
        required: true,
        options: [{ value: '6001', label: '大统华徐汇店' }],
      },
      {
        source_code: 'spm_cal_biz_date',
        value_type: 'biz_date',
        wire_key: 'spmBizDate',
        label: '超市经营日',
        required: true,
        options: [{ value: '2026-11-02', label: '2026-11-02' }],
      },
    ],
    values: { spmStoreId: '6001', spmBizDate: '2026-11-02' },
    ...over,
  };
}

describe('buildReportSubmitText', () => {
  it('组装模板报告前缀与 wireKey=value', () => {
    expect(buildReportSubmitText(baseCard())).toBe(
      '模板报告：RPT_DAILY 门店经营日报；spmStoreId=6001（大统华徐汇店）；spmBizDate=2026-11-02',
    );
  });
});

describe('buildReportSubmitSummary', () => {
  it('首行摘要：标题 + 人类可读参数', () => {
    expect(buildReportSubmitSummary(baseCard())).toBe(
      '门店经营日报  大统华徐汇店  2026-11-02',
    );
  });

  it('月报：标题 + 店名 + 经营月', () => {
    expect(
      buildReportSubmitSummary(
        baseCard({
          reportCode: 'SPM-STORE-MONTH-REPORT',
          title: '月报',
          slots: [
            {
              source_code: 'spm_auth_store',
              value_type: 'store',
              wire_key: 'spmStoreId',
              label: '超市权限门店',
              required: true,
              options: [{ value: '0021', label: '宜兴城北店' }],
            },
            {
              source_code: 'spm_cal_ord_month',
              value_type: 'ord_month',
              wire_key: 'spmOrdMonth',
              label: '超市经营月',
              required: true,
              options: [{ value: '2026年-9月', label: '2026年-9月' }],
            },
          ],
          values: { spmStoreId: '0021', spmOrdMonth: '2026年-9月' },
        }),
      ),
    ).toBe('月报  宜兴城北店  2026年-9月');
  });
});

describe('parseReportSubmitDisplay', () => {
  it('从硬路由原文解析摘要', () => {
    const raw =
      '模板报告：SPM-STORE-MONTH-REPORT 月报；spmStoreId=0021（宜兴城北店）；spmOrdMonth=2026年-9月';
    expect(parseReportSubmitDisplay(raw)).toEqual({
      summary: '月报  宜兴城北店  2026年-9月',
      detail: raw,
    });
  });

  it('非模板报告返回 null', () => {
    expect(parseReportSubmitDisplay('普通提问')).toBeNull();
  });
});

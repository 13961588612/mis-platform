import { client } from './client';
import type { SummaryRow } from '@/types/api';

/** 对账汇总（对账汇总 R15，v1.3 整体累计口径）：每 check 一行，支持场景 / 状态过滤（runId 界面不暴露）。 */
export const summaryApi = {
  list: (params: { scenarioCode?: string; status?: string }) =>
    client.get<SummaryRow[]>('/summary', { params }),
};

import { client } from './client';
import type {
  AlertLogRow,
  BalanceResp,
  DatasourceHealthRow,
  DiffAgingRow,
  PageParams,
  PageResult,
  PullRunRow,
  ReconReporterConfig,
  ReconRunDetailRow,
  ReconRunRow,
  ReconTrendRow,
  ReportDetailResp,
  ReportRunRow,
  ReportTriggerResp,
  ReporterSaveReq,
} from '@/types/api';

/** 报告渠道配置 CRUD（T07 §7） */
export const reportersApi = {
  list: (params: { scenarioCode?: string } & PageParams) =>
    client.get<PageResult<ReconReporterConfig>>('/reporters', { params }),

  create: (body: ReporterSaveReq) => client.post<ReconReporterConfig>('/reporters', body),

  update: (id: number, body: ReporterSaveReq) => client.put<ReconReporterConfig>(`/reporters/${id}`, body),

  remove: (id: number) => client.delete<void>(`/reporters/${id}`),
};

/** 运行/告警只读查询 + 手动触发 + 监控统计 */
export const runsApi = {
  reportRuns: (params: { scenarioCode?: string; reportType?: string; sendStatus?: string; dateFrom?: string; dateTo?: string } & PageParams) =>
    client.get<PageResult<ReportRunRow>>('/report-runs', { params }),

  /** 报告详情：运行记录 + 该次发送的报告正文 + 按检查分组差异汇总 */
  reportDetail: (id: number) => client.get<ReportDetailResp>(`/report-runs/${id}/detail`),

  alertLogs: (params: { scenarioCode?: string; severity?: string; channel?: string } & PageParams) =>
    client.get<PageResult<AlertLogRow>>('/alert-logs', { params }),

  reconRuns: (params: { scenarioCode?: string; status?: string; dateFrom?: string; dateTo?: string } & PageParams) =>
    client.get<PageResult<ReconRunRow>>('/recon-runs', { params }),

  pullRuns: (params: { dsCode?: string; status?: string; healthStatus?: string; dateFrom?: string; dateTo?: string } & PageParams) =>
    client.get<PageResult<PullRunRow>>('/pull-runs', { params }),

  /** 手动触发报告（同步） */
  report: (scenarioCode: string) => client.post<ReportTriggerResp>(`/ops/report/${scenarioCode}`),

  /** 重发报告：同一 run 重新扫描（reported_at 防重） */
  resendReport: (scenarioCode: string) => client.post<ReportTriggerResp>(`/ops/report/${scenarioCode}/resend`),

  /** 手动拉取（body 可选窗口覆盖） */
  manualPull: (dsCode: string, body?: { start?: string; end?: string }) =>
    client.post<{ run_id: number }>(`/ops/pull/${dsCode}`, body ?? {}),

  /** 手动触发对账（body 可选窗口覆盖） */
  manualRecon: (scenarioCode: string, body?: { start?: string; end?: string }) =>
    client.post<{ run_id: number }>(`/ops/recon/${scenarioCode}`, body ?? {}),

  /** 数据源健康总览 */
  healthOverview: () => client.get<DatasourceHealthRow[]>('/health-overview'),

  /** 对账成功率趋势：近 days 天 */
  reconTrend: (days = 7) => client.get<ReconTrendRow[]>('/recon-trend', { params: { days } }),

  /** 差异池账龄分布 */
  diffAging: () => client.get<DiffAgingRow[]>('/diff-aging'),

  /** 对账运行详情（含 consumed_seq_json 消费进度） */
  reconRunDetail: (id: number) => client.get<ReconRunDetailRow>(`/recon-runs/${id}/detail`),

  /** 平衡表（零差异证明） */
  balance: (scenarioCode: string, days = 1) =>
    client.get<BalanceResp>('/balance', { params: { scenarioCode, days } }),
};
import { client } from './client';
import type {
  DiffDetailResp,
  DiffFetchOneReq,
  DiffHandleReq,
  DiffQueryParams,
  DiffRevertReq,
  DiffStatsResp,
  FetchOneResult,
  PageResult,
  ReconDetail,
  StatusHistoryRow,
} from '@/types/api';

export const diffsApi = {
  list: (params: DiffQueryParams) => client.get<PageResult<ReconDetail>>('/diffs', { params }),

  stats: (scenarioCode?: string) =>
    client.get<DiffStatsResp>('/diffs/stats', { params: scenarioCode ? { scenarioCode } : undefined }),

  /** 人工处理一条差异（T07 §6） */
  handle: (id: number, body: DiffHandleReq) => client.post<{ id: number }>(`/diffs/${id}/handle`, body),

  /** 差异详情（V4：含锚表/历史/规则元信息） */
  detail: (id: number) => client.get<DiffDetailResp>(`/diffs/${id}`),

  /** 状态历史（V4：时间线独立 tab 用） */
  statusHistory: (id: number) => client.get<StatusHistoryRow[]>(`/diffs/${id}/status-history`),

  /** 回退为未处理（V4） */
  revert: (id: number, body: DiffRevertReq) => client.post<{ id: number }>(`/diffs/${id}/revert`, body),

  /** 单条重拉（V4：按锚表行逐条调） */
  fetchOne: (id: number, body: DiffFetchOneReq = {}) =>
    client.post<FetchOneResult[]>(`/diffs/${id}/fetch-one`, body),
};

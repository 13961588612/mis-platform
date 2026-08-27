import { client } from './client';
import type { FetchOneReq, FetchOneResp, ProbeResp, PullReq, PullResultResp, RebuildResp, SqlTestReq, SqlTestResp } from '@/types/api';

export const opsApi = {
  /** 手动拉取（body 可选窗口覆盖） */
  pull: (dsCode: string, body?: PullReq) => client.post<PullResultResp>(`/ops/pull/${dsCode}`, body ?? {}),

  /** 数据源重建（破坏性）：清空台账/水位 + 引用 check 的游标/索引/差异，再全量重拉 */
  rebuild: (dsCode: string, body?: PullReq) => client.post<RebuildResp>(`/ops/datasource/${dsCode}/rebuild`, body ?? {}),

  /** 手动触发对账 */
  recon: (scenarioCode: string, body?: PullReq) => client.post<PullResultResp>(`/ops/recon/${scenarioCode}`, body ?? {}),

  /** 单条重拉 */
  fetchOne: (dsCode: string, body: FetchOneReq) => client.post<FetchOneResp>(`/ops/fetch-one/${dsCode}`, body),

  /** 试拉 */
  probe: (dsCode: string) => client.post<ProbeResp>(`/ops/probe/${dsCode}`),

  /** 取数 SQL 检测（表单未保存 SQL，不入库） */
  sqlTest: (body: SqlTestReq) => client.post<SqlTestResp>('/ops/sql-test', body),
};

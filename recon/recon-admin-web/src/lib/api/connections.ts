import { client } from './client';
import type { PageParams, PageResult, ReconConnection } from '@/types/api';

export const connectionsApi = {
  list: (params: PageParams) => client.get<PageResult<ReconConnection>>('/connections', { params }),

  detail: (code: string) => client.get<ReconConnection>(`/connections/${code}`),

  create: (body: ReconConnection) => client.post<ReconConnection>('/connections', body),

  update: (code: string, body: ReconConnection) => client.put<ReconConnection>(`/connections/${code}`, body),

  remove: (code: string) => client.delete<void>(`/connections/${code}`),

  /** 测试连通（真实库反馈；成功即 code=0，失败走 BizError） */
  test: (code: string) => client.post<void>(`/connections/${code}/test`),
};

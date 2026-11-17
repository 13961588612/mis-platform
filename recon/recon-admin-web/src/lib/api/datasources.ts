import { client } from './client';
import type { PageParams, PageResult, ReconDatasource } from '@/types/api';

export const datasourcesApi = {
  list: (params: PageParams) => client.get<PageResult<ReconDatasource>>('/datasources', { params }),

  detail: (code: string) => client.get<ReconDatasource>(`/datasources/${code}`),

  create: (body: ReconDatasource) => client.post<ReconDatasource>('/datasources', body),

  update: (code: string, body: ReconDatasource) => client.put<ReconDatasource>(`/datasources/${code}`, body),

  remove: (code: string) => client.delete<void>(`/datasources/${code}`),

  /** 连接层测试（成功即 code=0；取数探针用 ops/probe） */
  test: (code: string) => client.post<void>(`/datasources/${code}/test`),
};

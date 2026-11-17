import { client } from './client';
import type { PageParams, PageResult, ReconScenario } from '@/types/api';

export const scenariosApi = {
  list: (params: PageParams) => client.get<PageResult<ReconScenario>>('/scenarios', { params }),

  detail: (code: string) => client.get<ReconScenario>(`/scenarios/${code}`),

  create: (body: ReconScenario) => client.post<ReconScenario>('/scenarios', body),

  update: (code: string, body: ReconScenario) => client.put<ReconScenario>(`/scenarios/${code}`, body),

  remove: (code: string) => client.delete<void>(`/scenarios/${code}`),
};

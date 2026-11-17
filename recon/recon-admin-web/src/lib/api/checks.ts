import { client } from './client';
import type { PageParams, PageResult, ReconCheck, CheckDetail } from '@/types/api';

export interface CheckListParams extends PageParams {
  scenarioCode?: string;
}

export const checksApi = {
  /** 检查列表（可按场景过滤） */
  list: (params: CheckListParams) => client.get<PageResult<ReconCheck>>('/checks', { params }),

  detail: (scenarioCode: string, checkName: string) =>
    client.get<CheckDetail>(`/checks/${scenarioCode}/${checkName}`),

  create: (body: ReconCheck) => client.post<ReconCheck>('/checks', body),

  update: (scenarioCode: string, checkName: string, body: ReconCheck) =>
    client.put<ReconCheck>(`/checks/${scenarioCode}/${checkName}`, body),

  remove: (scenarioCode: string, checkName: string) =>
    client.delete<void>(`/checks/${scenarioCode}/${checkName}`),

  /** 自定义类名实时校验（§3.4.1）：类可加载 + 实现对应接口；checkType: custom / custom_check / custom_compare */
  validateCustomClass: (
    className: string,
    checkType: 'custom' | 'custom_check' | 'custom_compare',
  ) => client.post<{ ok: boolean; className: string }>('/checks/validate-custom-class', { class_name: className, check_type: checkType }),
};

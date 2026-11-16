import { client } from './client';

export const permissionsApi = {
  /**
   * 当前登录用户的权限码（平台 BFF 权威下发）。
   *
   * <p>路径不在本应用的 `/api/v1/recon` 前缀下，用 baseURL 覆盖回 `/api/v1`；
   * 该端点登记为 authOnly（登录即可），无需额外权限码。
   */
  mine: () => client.get<string[]>('/menus/permissions', { baseURL: '/api/v1' }),
};

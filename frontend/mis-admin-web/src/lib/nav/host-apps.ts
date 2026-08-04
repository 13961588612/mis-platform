/**
 * 宿主（runtime='host'）子系统的落地路由解析。
 *
 * <p>门户九宫格与顶部应用切换器共用：不同宿主子系统的首页不同，
 * 不能一律跳 `/dashboard`（那是「系统管理」的首页）。
 */

/** app.code → 落地路由。未登记的宿主应用回退 basePath，再回退 /dashboard。 */
const HOST_APP_LANDING: Record<string, string> = {
  system: '/dashboard',
  kb: '/kb/overview',
};

/**
 * 解析宿主子系统的落地路由。
 *
 * @param code     应用编码（sys_app.code）
 * @param basePath 应用基础路径（sys_app.base_path），如 `/kb`
 */
export function resolveHostLanding(code: string | null | undefined, basePath?: string | null): string {
  if (code && HOST_APP_LANDING[code]) return HOST_APP_LANDING[code];
  if (basePath && basePath.startsWith('/')) return basePath;
  return '/dashboard';
}

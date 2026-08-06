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
  // T01：智能体运营控制台。sys_app.base_path 是 '/agent'（V19），但 '/agent' 本身
  // 没有页面（PAGE_MAP 无此键），不显式登记就会落到「页面不存在」。
  agent: '/agent/overview',
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

/**
 * 按当前路由解析「正在使用的」宿主 / iframe 应用 code。
 *
 * <p>登录态里的 {@code auth.app} 是登录时选中的 App（多为 system），跨子系统只
 * {@code navigate} 不会改它。顶栏切换器与侧栏品牌区必须以路由为准，否则一直显示「系统管理」。
 */
export function resolveActiveHostAppCode(
  pathname: string,
  loginAppCode?: string | null,
): string {
  if (pathname === '/kb' || pathname.startsWith('/kb/')) return 'kb';
  if (pathname === '/agent' || pathname.startsWith('/agent/')) return 'agent';
  if (pathname.startsWith('/iframe/')) {
    const code = pathname.slice('/iframe/'.length).split('/')[0];
    if (code) return code;
  }
  if (loginAppCode) return loginAppCode;
  return 'system';
}

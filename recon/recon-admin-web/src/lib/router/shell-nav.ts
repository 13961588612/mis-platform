/**
 * iframe 模式（被壳子 micro-app 承载）下跳转并同步壳子侧栏选中态。
 *
 * <p>子应用内部 react-router navigate 只改 iframe 内路由，壳子 URL 不变；
 * 壳子侧栏按壳子 pathname 判活 → 从对账汇总下钻差异处理后菜单仍停留在对账汇总。
 * 这里经 microApp.router 通知壳子跳完整路径（含 baseroute），壳子 URL 变化后
 * 由壳子 KeepAliveOutlet 的 microApp.router.replace 同步驱动子应用路由。
 * 独立运行模式（无壳子）返回 false，调用方回退 react-router navigate。</p>
 *
 * @param to 子应用内部路径（如 /diffs?scenarioCode=x）
 * @returns 是否已由壳子接管跳转（true=iframe 模式已同步，调用方无需再 navigate）
 */
export function syncShellRoute(to: string): boolean {
  if (!window.__MICRO_APP_ENVIRONMENT__ || !window.microApp?.router) return false;
  const base = window.__MICRO_APP_BASE_ROUTE__ ?? '/remote/recon';
  const full = to.startsWith(base) ? to : `${base}${to}`;
  // micro-app router.push 需要 { name, path } 对象（name = 壳子注册的子应用 code）
  window.microApp.router.push({ name: window.microApp.appName ?? 'recon', path: full }).catch(() => undefined);
  return true;
}

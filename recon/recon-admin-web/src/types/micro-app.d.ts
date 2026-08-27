/**
 * micro-app（@micro-zeta/micro-app）子应用侧注入的全局变量与 API。
 *
 * <p>仅当被壳子以 <micro-app> 方式加载时存在（window.__MICRO_APP_ENVIRONMENT__ = true）；
 * 独立运行（pnpm dev 直接访问）时全部为 undefined，代码需按此分支处理。
 */
interface MicroAppWindowApi {
  /** 订阅壳子下发数据（壳子经 microApp.setData 推送） */
  addDataListener: (listener: (data: Record<string, unknown>) => void) => void;
  /** 启动时拉取壳子已下发的最新数据 */
  getData: () => Record<string, unknown> | undefined;
  /** 子应用控制壳子路由（如退出登录跳 /login），仅壳内存在 */
  router?: { push: (path: string) => void };
}

interface Window {
  __MICRO_APP_ENVIRONMENT__?: boolean;
  __MICRO_APP_BASE_ROUTE__?: string;
  microApp?: MicroAppWindowApi;
}

import microApp from '@micro-zoe/micro-app';

/**
 * 卸掉全部 micro-app 实例并清空 keep-alive。
 * 登录页 / 登出后必须调用，否则子应用 iframe 里仍缓存过期 JWT，重登后点击无效。
 */
export function destroyRemoteMicroApps() {
  try {
    void microApp.unmountAllApps?.({ destroy: true, clearAliveState: true });
  } catch {
    /* 尚未 start 或当前没有子应用 */
  }
}

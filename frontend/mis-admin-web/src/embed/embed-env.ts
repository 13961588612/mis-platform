/**
 * embed 环境工具 — 父域白名单解析（T07'）。
 *
 * <p>01-architecture.md §5.3：`VITE_PARENT_ORIGINS` 环境变量声明父域白名单；
 * `EmbedAuthBridge` 与事件桥对非白名单 origin 的 postMessage 一律拒绝（fail-closed）。
 * 白名单为空 → 不信任任何父域（拒绝所有鉴权/事件消息）。
 */

/** 解析 VITE_PARENT_ORIGINS（逗号分隔，去空白，忽略空项）。 */
export function parseParentOrigins(): string[] {
  const raw = (import.meta.env.VITE_PARENT_ORIGINS as string | undefined) ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 是否在白名单内（空白名单 = 全部拒绝）。 */
export function isAllowedParentOrigin(origin: string): boolean {
  const allowed = parseParentOrigins();
  return allowed.length > 0 && allowed.includes(origin);
}

/** 当前页面是否运行在 iframe 内（跨域访问 top 抛错时按嵌入处理）。 */
export function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

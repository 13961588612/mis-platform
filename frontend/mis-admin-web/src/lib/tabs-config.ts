/**
 * 顶部 Tab 栏「按 APP 隔离」开关（配置项，默认开启）。
 *
 * <p>开启时：切换子系统（顶部切换器 / 路由）后，Tab 栏只显示当前 APP 已打开的页面；
 * 关闭时：回退旧行为，Tab 栏展示全部 APP 打开过的页面。
 *
 * <p>读取顺序（与既有 VITE_* 配置惯例一致，见 lib/ai-h5.ts）：
 * <ol>
 *   <li>{@code localStorage['mis.tabs.byApp']} 有值 → '0' / 'false' / 'off'（忽略大小写与首尾空白）
 *       视为关闭，其余非空字符串视为开启；</li>
 *   <li>否则回退 {@code import.meta.env.VITE_TABS_BY_APP !== 'false'}
 *       （env 未配置或为 'true' 时默认开启）。</li>
 * </ol>
 */
const TAB_ISOLATION_STORAGE_KEY = 'mis.tabs.byApp';

/** 无 appCode 的 tab（历史遗留 / 初始 pinned 仪表盘）归属的 APP */
export const DEFAULT_TAB_APP_CODE = 'system';

export function isTabIsolationEnabled(): boolean {
  const stored = localStorage.getItem(TAB_ISOLATION_STORAGE_KEY);
  if (stored !== null && stored.trim() !== '') {
    const v = stored.trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'off';
  }
  return import.meta.env.VITE_TABS_BY_APP !== 'false';
}

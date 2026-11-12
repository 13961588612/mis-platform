/**
 * 全局搜索索引聚合器 —— 「门户三入口」+「各 APP 菜单（不含工作台）」。
 *
 * <p><b>本轮口径</b>：命令面板（⌘K）同时提供
 * ①**门户三入口**（门户首页 / 待办事项 / 消息中心，`portalTab` 定位，`path` 均为 `/portal`）；
 * ②**各业务 APP 菜单**（system / agent / kb / iqd / finance 五份 `*_NAV` 展平，逐份注入
 * `appCode` / `appName`）。
 *
 * <p><b>刻意排除</b>：
 * <ul>
 *   <li>**工作台（`task` 的 `TASK_NAV`）**：工作台是「个人事务中心」，不属于业务菜单集合，
 *       用户明确不要；故 {@link NAV_SOURCES} 不含 `task`。</li>
 *   <li>**APP 列表（`type: 'app'`）**：用户明确不需要「一个一个应用」的入口，只放菜单。</li>
 * </ul>
 *
 * <p><b>门户三 Tab 不进 URL</b>（见 `stores/portal-tab-store.ts`）。三条门户项的 `path` 同为
 * `/portal`，真正的 Tab 定位靠 {@link SearchItem.portalTab}；点击动作由 `command-palette.tsx`
 * 完成：先 `usePortalTabStore.getState().setActiveTab(tab)`，再 `navigate('/portal')`。
 *
 * <p><b>零后端改动</b>：本模块纯静态清单，不触网；只依赖 `@/lib/nav/*`，不 import 任何
 * `features/*`（沿用 nav 层与 feature 层不反向耦合的既有约束）。
 */
import { SYSTEM_NAV, flattenNavLeaves, type SystemNavNode } from '@/lib/nav/system-nav';
import { AGENT_NAV } from '@/lib/nav/agent-nav';
import { KB_NAV } from '@/lib/nav/kb-nav';
import { IQD_NAV } from '@/lib/nav/iqd-nav';
import { FINANCE_NAV } from '@/lib/nav/finance-nav';
import type { SearchItem } from './types';

/** 平台级分组标签（`appCode === null` 且非门户）。 */
export const PLATFORM_GROUP_LABEL = '平台级';

/** appCode → 展示名（静态兜底）。保留 `task` 供其它视图复用；本模块不产工作台菜单。 */
export const APP_NAME: Record<string, string> = {
  system: '系统管理',
  agent: '智能体运营',
  kb: '知识库',
  iqd: '问数',
  finance: '财务辅助',
  task: '工作台',
};

/** 门户三入口（顺序即展示顺序）。 */
export const PORTAL_ENTRIES: ReadonlyArray<SearchItem> = [
  {
    id: 'portal:home',
    type: 'menu',
    title: '门户首页',
    path: '/portal',
    icon: 'Home',
    appCode: null,
    appName: null,
    portalTab: 'home',
  },
  {
    id: 'portal:todo',
    type: 'menu',
    title: '待办事项',
    path: '/portal',
    icon: 'ClipboardList',
    appCode: null,
    appName: null,
    portalTab: 'todo',
  },
  {
    id: 'portal:message',
    type: 'menu',
    title: '消息中心',
    path: '/portal',
    icon: 'MessagesSquare',
    appCode: null,
    appName: null,
    portalTab: 'message',
  },
];

/**
 * `*_NAV` 静态清单 → 其归属 app_code 的对照表。
 *
 * <p>顺序即「其他 APP」分组内的展示顺序。**不含 `task`**（工作台菜单刻意排除）。
 */
const NAV_SOURCES: ReadonlyArray<{ appCode: string; nav: SystemNavNode[] }> = [
  { appCode: 'system', nav: SYSTEM_NAV },
  { appCode: 'agent', nav: AGENT_NAV },
  { appCode: 'kb', nav: KB_NAV },
  { appCode: 'iqd', nav: IQD_NAV },
  { appCode: 'finance', nav: FINANCE_NAV },
];

/** 稳定唯一键规则（设计 §5.4）：`\`${appCode ?? '_'}:${path ?? title}\``。 */
function itemId(appCode: string | null, path: string | null, title: string): string {
  return `${appCode ?? '_'}:${path ?? title}`;
}

/**
 * 构建搜索索引：门户三入口（带 `portalTab`）+ 各 APP 菜单（带 `appCode` / `appName`）。
 *
 * @returns 未排序的 {@link SearchItem}[]（门户三入口在前，其后按 {@link NAV_SOURCES} 顺序）
 */
export function buildSearchIndex(): SearchItem[] {
  const items: SearchItem[] = [];

  // 1) 门户三入口（带 portalTab）。
  for (const entry of PORTAL_ENTRIES) {
    items.push({ ...entry });
  }

  // 2) 各业务 APP 菜单（逐份注入 appCode / appName）。
  for (const { appCode, nav } of NAV_SOURCES) {
    const appName = APP_NAME[appCode] ?? appCode;
    for (const leaf of flattenNavLeaves(nav)) {
      items.push({
        id: itemId(appCode, leaf.path, leaf.title),
        type: 'menu',
        title: leaf.title,
        path: leaf.path,
        icon: leaf.icon,
        appCode,
        appName,
      });
    }
  }

  return items;
}

/** 分组的展示标签：有 appName 用之，否则「平台级」。 */
export function groupLabel(appCode: string | null, appName: string | null): string {
  if (appCode === null) return PLATFORM_GROUP_LABEL;
  return appName ?? APP_NAME[appCode] ?? appCode;
}

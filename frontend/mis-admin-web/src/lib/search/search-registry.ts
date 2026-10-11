/**
 * 全局搜索索引聚合器（P0）——「静态清单兜底」的统一构建入口。
 *
 * <p><b>背景</b>：命令面板原先只搜硬编码的 `SYSTEM_NAV`（设计事实 F7），
 * kb / agent / iqd / finance / task 的页面**完全搜不到**。本模块把已存在的 6 份
 * `*_NAV` 静态清单（事实 F9）统一展平，逐份注入其 `app_code`，并并入 `AppItem[]`
 * （让用户可直接「跳去某 APP」），产出带 `appCode` / `appName` 的 {@link SearchItem}[]。
 *
 * <p><b>零后端改动</b>：只消费既有 `*_NAV` 与既有 `GET /apps`（`fetchApps`），不新增端点。
 *
 * <p><b>零副作用</b>：本模块**只依赖** `@/lib/nav/*` 与 `@/types/api`，不 import 任何
 * `features/*`，避免 nav 层与 feature 层反向耦合（沿用 agent-nav / iqd-nav 的既有约束）。
 */
import { SYSTEM_NAV, flattenNavLeaves, type SystemNavNode } from '@/lib/nav/system-nav';
import { AGENT_NAV } from '@/lib/nav/agent-nav';
import { KB_NAV } from '@/lib/nav/kb-nav';
import { IQD_NAV } from '@/lib/nav/iqd-nav';
import { FINANCE_NAV } from '@/lib/nav/finance-nav';
import { TASK_NAV } from '@/lib/nav/task-nav';
import type { AppItem } from '@/types/api';
import type { SearchItem } from './types';

/** 平台级分组标签（`appCode === null`）。 */
export const PLATFORM_GROUP_LABEL = '平台级';

/** appCode → 展示名（静态兜底；`fetchApps()` 可用时以其 `name` 优先）。 */
export const APP_NAME: Record<string, string> = {
  system: '系统管理',
  agent: '智能体运营',
  kb: '知识库',
  iqd: '问数',
  finance: '财务辅助',
  task: '工作台',
};

/**
 * `*_NAV` 静态清单 → 其归属 app_code 的对照表。
 *
 * <p>顺序即「其他 APP」分组内的展示顺序（当前 APP 由命令面板另行置顶）。
 */
const NAV_SOURCES: ReadonlyArray<{ appCode: string; nav: SystemNavNode[] }> = [
  { appCode: 'system', nav: SYSTEM_NAV },
  { appCode: 'agent', nav: AGENT_NAV },
  { appCode: 'kb', nav: KB_NAV },
  { appCode: 'iqd', nav: IQD_NAV },
  { appCode: 'finance', nav: FINANCE_NAV },
  { appCode: 'task', nav: TASK_NAV },
];

/** 稳定唯一键规则（设计 §5.4）：`\`${appCode ?? '_'}:${path ?? title}\``。 */
function itemId(appCode: string | null, path: string | null, title: string): string {
  return `${appCode ?? '_'}:${path ?? title}`;
}

/**
 * 构建完整搜索索引。
 *
 * @param apps 可选的应用列表（来自既有 `GET /apps`）。传入时并入 `type: 'app'` 项；
 *             拉取失败/未传时降级为「纯 `*_NAV`」——`*_NAV` 部分始终可用。
 * @returns 未排序的 {@link SearchItem}[]（排序/分组由命令面板按「当前 APP 优先」决定）
 */
export function buildSearchIndex(apps?: AppItem[]): SearchItem[] {
  const items: SearchItem[] = [];

  // 1) 遍历全部 *_NAV，逐份注入 appCode。
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

  // 2) 保留「返回门户」快捷项（平台级：所有 APP 通用）。
  items.push({
    id: itemId(null, '/portal', '返回门户'),
    type: 'menu',
    title: '返回门户',
    path: '/portal',
    icon: 'Home',
    appCode: null,
    appName: null,
  });

  // 3) 并入 APP 列表（type='app'，供「跳到某 APP」）。
  for (const app of apps ?? []) {
    const appName = app.name || APP_NAME[app.code] || app.code;
    const path = app.basePath ?? null;
    items.push({
      id: itemId(app.code, path, app.name),
      type: 'app',
      title: app.name,
      path,
      icon: app.icon ?? null,
      appCode: app.code,
      appName,
    });
  }

  return items;
}

/** 分组的展示标签：有 appName 用之，否则「平台级」。 */
export function groupLabel(appCode: string | null, appName: string | null): string {
  if (appCode === null) return PLATFORM_GROUP_LABEL;
  return appName ?? APP_NAME[appCode] ?? appCode;
}

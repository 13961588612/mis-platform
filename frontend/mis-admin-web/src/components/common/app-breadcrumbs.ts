import type { BreadcrumbItem } from '@/components/common/page-header';

export const APP_LABEL = {
  system: '系统管理',
  kb: '知识库',
  agent: '智能体运营',
} as const;

export type HostAppKey = keyof typeof APP_LABEL;

/**
 * 统一宿主页面包屑：门户 → App 名 →（可选分组）→ 当前标题。
 * App 段默认不可点；需要回 App 首页时传 appTo。
 */
export function buildAppBreadcrumbs(opts: {
  app: HostAppKey;
  title: string;
  group?: string;
  appTo?: string;
}): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { label: '门户', to: '/portal' },
    { label: APP_LABEL[opts.app], ...(opts.appTo ? { to: opts.appTo } : {}) },
  ];
  if (opts.group) items.push({ label: opts.group });
  items.push({ label: opts.title });
  return items;
}

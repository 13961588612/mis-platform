import { type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTabStore } from '@/stores/tab-store';
import { getIframeApp, useIframeRegistryVersion } from '@/lib/nav/iframe-apps';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import {
  AppManagePage,
  ConfigPage,
  EmployeePage,
  ModulePage,
  PostPage,
} from '@/features/system/admin-list-page';
import { UserListPage } from '@/features/system/user/user-list-page';
import { OrgListPage } from '@/features/system/org/org-list-page';
import { DeptTreePage } from '@/features/system/dept/dept-tree-page';
import { RoleListPage } from '@/features/system/role/role-list-page';
import { MenuManagePage } from '@/features/system/menu/menu-manage-page';
import { DictManagePage } from '@/features/system/dict/dict-manage-page';
import { LoginLogListPage, OperLogListPage } from '@/features/monitor/log-pages';
import { KbOverviewPage } from '@/features/kb/kb-overview-page';
import { KbCategoryPage } from '@/features/kb/category/kb-category-page';
import { KbLibraryPage } from '@/features/kb/library/kb-library-page';
import { KbLibraryDetailPage } from '@/features/kb/library/kb-library-detail-page';
import { KbDocumentPage } from '@/features/kb/document/kb-document-page';
import { KbPermissionPage } from '@/features/kb/permission/kb-permission-page';
import { KbQaPage } from '@/features/kb/qa/kb-qa-page';
import { KbHitTestPage } from '@/features/kb/hittest/kb-hit-test-page';
import { KbSynonymPage } from '@/features/kb/synonym/kb-synonym-page';
import { KbOperationsPage } from '@/features/kb/operations/kb-operations-page';
import { KbEnginePage } from '@/features/kb/engine/kb-engine-page';
import { flattenSystemNavLeaves } from '@/lib/nav/system-nav';
import { flattenKbNavLeaves } from '@/lib/nav/kb-nav';

export { registerIframeApps } from '@/lib/nav/iframe-apps';

function ForbiddenPage() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="rounded-lg border bg-card p-8 text-center shadow-card">
        <h1 className="text-xl font-semibold">403 无权限</h1>
        <p className="mt-2 text-sm text-muted-foreground">你没有访问该页面的权限。</p>
      </div>
    </div>
  );
}

/** 远程页面：iframe 嵌入 */
function IframePage({ basePath, title }: { basePath: string; title: string }) {
  return (
    <iframe
      src={basePath}
      className="h-full w-full border-0"
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}

const PAGE_MAP: Record<string, ComponentType> = {
  '/dashboard': DashboardPage,
  '/403': ForbiddenPage,
  '/system/user': UserListPage,
  '/system/org': OrgListPage,
  '/system/dept': DeptTreePage,
  '/system/employee': EmployeePage,
  '/system/post': PostPage,
  '/system/app': AppManagePage,
  '/system/module': ModulePage,
  '/system/role': RoleListPage,
  '/system/menu': MenuManagePage,
  '/system/dict': DictManagePage,
  '/system/config': ConfigPage,
  '/monitor/login-log': LoginLogListPage,
  '/monitor/oper-log': OperLogListPage,
  // 知识库子系统（路径与 V13__kb_seed.sql / V17__kb_hittest_perms.sql 的 sys_menu.path 一一对应）
  '/kb/overview': KbOverviewPage,
  '/kb/categories': KbCategoryPage,
  '/kb/libraries': KbLibraryPage,
  '/kb/documents': KbDocumentPage,
  '/kb/permissions': KbPermissionPage,
  '/kb/qa': KbQaPage,
  '/kb/hit-test': KbHitTestPage,
  '/kb/synonyms': KbSynonymPage,
  '/kb/operations': KbOperationsPage,
  '/kb/engine': KbEnginePage,
};

export const KEEP_ALIVE_META: Record<string, { title: string; icon?: string }> = Object.fromEntries(
  [...flattenSystemNavLeaves(), ...flattenKbNavLeaves()].map((i) => [
    i.path,
    { title: i.title, icon: i.icon },
  ]),
);

/**
 * 动态明细路由规则（L-06 起引入）。
 *
 * <p>`PAGE_MAP` 是**精确路径**匹配，`/kb/libraries/12` 这类带 ID 的明细页命不中。
 * 这里补一层前缀匹配：`prefix` 之后必须恰好剩一段（不含 `/`），
 * 避免 `/kb/libraries/12/documents` 这种更深的路径被误吞。
 *
 * <p>明细页不进侧栏（不写入 KB_NAV），但需要独立的 Tab 标题——否则详情 Tab
 * 会沿用列表页的「知识库」标题，同时开多个详情时完全无法区分。
 */
interface DynamicPageRule {
  prefix: string;
  component: ComponentType;
  title: string;
  icon: string;
}

const DYNAMIC_PAGES: DynamicPageRule[] = [
  {
    prefix: '/kb/libraries/',
    component: KbLibraryDetailPage,
    title: '知识库详情',
    icon: 'Database',
  },
];

/** 命中动态明细规则则返回该规则，否则 null。 */
function matchDynamicPage(path: string): DynamicPageRule | null {
  for (const rule of DYNAMIC_PAGES) {
    if (!path.startsWith(rule.prefix)) continue;
    const rest = path.slice(rule.prefix.length);
    if (rest === '' || rest.includes('/')) continue;
    return rule;
  }
  return null;
}

/** 解析路径对应的页面组件：先精确后动态，都没有则 null（渲染「页面不存在」）。 */
export function resolvePageComponent(path: string): ComponentType | null {
  return PAGE_MAP[path] ?? matchDynamicPage(path)?.component ?? null;
}

/**
 * 解析动态明细页的 Tab 元信息；非明细路径返回 null。
 *
 * <p>供 AppLayout 在 `navItem`（按前缀匹配到列表页）**之前**取用，
 * 保证详情 Tab 的标题是「知识库详情」而不是列表页的「知识库」。
 */
export function resolveDynamicPageMeta(path: string): { title: string; icon: string } | null {
  const rule = matchDynamicPage(path);
  return rule ? { title: rule.title, icon: rule.icon } : null;
}

/** 按已打开 Tab 缓存页面实例；切 Tab 仅显隐，关闭 Tab 才卸载。host/iframe 统一在此渲染。 */
export function KeepAliveOutlet() {
  const location = useLocation();
  const tabs = useTabStore((s) => s.tabs);
  // 订阅注册表，避免 registerIframeApps 后不重渲染
  useIframeRegistryVersion();

  const paths = new Set(tabs.map((t) => t.path));
  paths.add(location.pathname);
  const active = location.pathname;

  const activeIframeCode = active.startsWith('/iframe/') ? active.slice('/iframe/'.length) : null;
  const activeIframe = activeIframeCode ? getIframeApp(activeIframeCode) : null;
  const activeHostMissing = !activeIframeCode && !resolvePageComponent(active);
  const activeIframeMissing = Boolean(activeIframeCode) && !activeIframe;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {[...paths].map((path) => {
        const isActive = path === active;
        const iframeCode = path.startsWith('/iframe/') ? path.slice('/iframe/'.length) : null;
        const iframeMeta = iframeCode ? getIframeApp(iframeCode) : null;

        if (iframeCode) {
          if (!iframeMeta) return null;
          return (
            <div
              key={path}
              className={cn(
                'flex min-h-0 flex-1 flex-col',
                isActive ? 'relative' : 'pointer-events-none absolute inset-0 invisible',
              )}
              aria-hidden={!isActive}
            >
              <IframePage basePath={iframeMeta.basePath} title={iframeMeta.title} />
            </div>
          );
        }

        const Comp = resolvePageComponent(path);
        if (!Comp) return null;
        return (
          <div
            key={path}
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-auto',
              isActive ? 'relative' : 'pointer-events-none absolute inset-0 invisible',
            )}
            aria-hidden={!isActive}
          >
            <Comp />
          </div>
        );
      })}

      {activeIframeMissing ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          正在加载远程应用…
        </div>
      ) : null}
      {activeHostMissing ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          页面不存在
        </div>
      ) : null}
    </div>
  );
}

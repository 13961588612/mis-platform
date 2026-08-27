import { useEffect, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import microApp from '@micro-zoe/micro-app';
import { cn } from '@/lib/utils';
import { useTabStore } from '@/stores/tab-store';
import { useAuthStore } from '@/stores/auth-store';
import { getIframeApp, useIframeRegistryVersion } from '@/lib/nav/iframe-apps';
import {
  getRemoteApp,
  normalizeRemotePath,
  remoteCodeFromPath,
  useRemoteRegistryVersion,
} from '@/lib/nav/remote-apps';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import {
  AppManagePage,
  ConfigPage,
  EmployeePage,
  ModulePage,
} from '@/features/system/admin-list-page';
import { PostManagePage } from '@/features/system/post/post-manage-page';
import { UserListPage } from '@/features/system/user/user-list-page';
import { OrgListPage } from '@/features/system/org/org-list-page';
import { DeptManagePage } from '@/features/system/dept/dept-manage-page';
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
import {
  AgentAgentDetailPage,
  AgentAgentsPage,
  AgentApprovalsPage,
  AgentCatalogPage,
  AgentChatPage,
  AgentDispatchPage,
  AgentFeedbackPage,
  AgentMcpPage,
  AgentMonitorPage,
  AgentOverviewPage,
  AgentSessionsPage,
  AgentSkillsPage,
  AgentSkillsPermissionsPage,
  AgentWecomPage,
} from '@/features/agent/pages';
import { flattenSystemNavLeaves } from '@/lib/nav/system-nav';
import { flattenKbNavLeaves } from '@/lib/nav/kb-nav';
import { flattenAgentNavLeaves } from '@/lib/nav/agent-nav';

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
      className="flex-1 min-h-0 w-full border-0"
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}

/**
 * micro-app 远程子应用：壳内融合渲染（独立运行时，与 React 组件不同生命周期）。
 * baseroute 下发为子应用 __MICRO_APP_BASE_ROUTE__；keep-alive 由 micro-app 内置保活。
 * 令牌：子应用启动经 getData/addDataListener 接收 setData 下发的 AUTH_TOKEN。
 */
function RemotePage({ code }: { code: string }) {
  const meta = getRemoteApp(code);
  const token = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  useEffect(() => {
    if (token) {
      // 会话数据整体下发：token + 用户信息 + 权限码（阶段 2：子应用免调 /auth/me 即可展示身份/判权限）
      microApp.setData(code, { type: 'AUTH_TOKEN', token, user, permissions });
    }
  }, [code, token, user, permissions]);
  if (!meta) return null;
  return (
    <micro-app
      name={code}
      url={meta.entry}
      baseroute={`/remote/${code}`}
      router-mode="native"
      keep-alive
      iframe
      className="flex-1 min-h-0 block w-full"
    />
  );
}

const PAGE_MAP: Record<string, ComponentType> = {
  '/dashboard': DashboardPage,
  '/403': ForbiddenPage,
  '/system/user': UserListPage,
  '/system/org': OrgListPage,
  '/system/dept': DeptManagePage,
  '/system/employee': EmployeePage,
  '/system/post': PostManagePage,
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
  // 智能体运营控制台（路径与 V19__agent_ops_seed.sql 的 sys_menu.path 一一对应）
  '/agent/overview': AgentOverviewPage,
  '/agent/chat': AgentChatPage,
  '/agent/sessions': AgentSessionsPage,
  '/agent/feedback': AgentFeedbackPage,
  '/agent/agents': AgentAgentsPage,
  '/agent/catalog': AgentCatalogPage,
  '/agent/dispatch': AgentDispatchPage,
  '/agent/skills': AgentSkillsPage,
  '/agent/skills/permissions': AgentSkillsPermissionsPage,
  '/agent/mcp': AgentMcpPage,
  '/agent/channels/wecom': AgentWecomPage,
  '/agent/monitor': AgentMonitorPage,
  '/agent/approvals': AgentApprovalsPage,
};

export const KEEP_ALIVE_META: Record<string, { title: string; icon?: string }> = Object.fromEntries(
  [...flattenSystemNavLeaves(), ...flattenKbNavLeaves(), ...flattenAgentNavLeaves()].map((i) => [
    i.path,
    { title: i.title, icon: i.icon },
  ]),
);

/**
 * 动态明细路由规则（L-06 起引入）。
 *
 * <p>`PAGE_MAP` 是**精确路径**匹配，`/kb/libraries/12` 这类带 ID 的明细页命不中。
 * 这里补一层前缀匹配：`prefix` 之后剩余的段数不得超过 `maxSegments`（默认 1），
 * 避免 `/kb/libraries/12/documents` 这种更深的路径被误吞。
 *
 * <p>`maxSegments` 用于带二级 Tab 的明细页：智能体的
 * `/agent/agents/:id/skills|config|coordination` 剩两段，必须显式放宽到 2，
 * 否则会落到「页面不存在」。
 *
 * <p>明细页不进侧栏（不写入 KB_NAV / AGENT_NAV），但需要独立的 Tab 标题——否则详情 Tab
 * 会沿用列表页的「知识库」标题，同时开多个详情时完全无法区分。
 */
interface DynamicPageRule {
  prefix: string;
  component: ComponentType;
  title: string;
  icon: string;
  /** 前缀之后允许的最大路径段数，缺省 1（即只允许 `/prefix/{id}`）。 */
  maxSegments?: number;
}

const DYNAMIC_PAGES: DynamicPageRule[] = [
  {
    prefix: '/kb/libraries/',
    component: KbLibraryDetailPage,
    title: '知识库详情',
    icon: 'Database',
  },
  // 智能体运营控制台：Agent 详情子路由（V19: type=2 + visible=0，不进侧栏）。
  // 覆盖 `/agent/agents/:id` 与 `/agent/agents/:id/{skills|config|coordination}`，
  // 故 maxSegments = 2；更深的路径仍不误吞。
  {
    prefix: '/agent/agents/',
    component: AgentAgentDetailPage,
    title: 'Agent 详情',
    icon: 'Bot',
    maxSegments: 2,
  },
];

/** 命中动态明细规则则返回该规则，否则 null。 */
function matchDynamicPage(path: string): DynamicPageRule | null {
  for (const rule of DYNAMIC_PAGES) {
    if (!path.startsWith(rule.prefix)) continue;
    const rest = path.slice(rule.prefix.length);
    if (rest === '') continue;
    const segments = rest.split('/');
    // 尾部空段（`/agent/agents/7/`）视为无效，避免多出一个重复 Tab
    if (segments.some((s) => s === '')) continue;
    if (segments.length > (rule.maxSegments ?? 1)) continue;
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

/** 按已打开 Tab 缓存页面实例；切 Tab 仅显隐，关闭 Tab 才卸载。host/iframe/remote 统一在此渲染。 */
export function KeepAliveOutlet() {
  const location = useLocation();
  const tabs = useTabStore((s) => s.tabs);
  // 订阅注册表，避免 register 后不重渲染
  useIframeRegistryVersion();
  useRemoteRegistryVersion();

  /**
   * 壳子侧栏 remote 菜单导航同步。
   *
   * <p>micro-app native 模式下，壳子用 react-router pushState 改 URL 不触发 popstate，
   * micro-app 感知不到 URL 变化 → iframe 内子应用不跳转（菜单点过去内容不变）。
   * 这里在 remote 子路径变化时主动调用 microApp.router.replace 驱动子应用路由。
   *
   * <p>path 必须传包含 baseroute 的完整路径（如 /remote/recon/datasources）：
   * micro-app 以 proxyWindow.location.href 为 base 解析，传相对子路径会丢掉 baseroute 前缀。
   */
  useEffect(() => {
    const code = remoteCodeFromPath(location.pathname);
    if (!code) return;
    microApp.router
      .replace({ name: code, path: location.pathname })
      .catch(() => {
        /* 子应用尚未渲染完成（首次挂载/资源加载中）时 replace 会 reject，忽略即可 */
      });
  }, [location.pathname]);

  // remote 子路径归一为应用根路径：一个 remote 应用 = 一个 Tab = 一个 <micro-app> 实例
  const active = normalizeRemotePath(location.pathname);
  const paths = new Set(tabs.map((t) => normalizeRemotePath(t.path)));
  paths.add(active);

  const activeIframeCode = active.startsWith('/iframe/') ? active.slice('/iframe/'.length) : null;
  const activeIframe = activeIframeCode ? getIframeApp(activeIframeCode) : null;
  const activeRemoteCode = remoteCodeFromPath(active);
  const activeRemote = activeRemoteCode ? getRemoteApp(activeRemoteCode) : null;
  const activeHostMissing = !activeIframeCode && !activeRemoteCode && !resolvePageComponent(active);
  const activeIframeMissing = Boolean(activeIframeCode) && !activeIframe;
  const activeRemoteMissing = Boolean(activeRemoteCode) && !activeRemote;

  return (
    <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden">
      {[...paths].map((path) => {
        const isActive = path === active;
        const iframeCode = path.startsWith('/iframe/') ? path.slice('/iframe/'.length) : null;
        const iframeMeta = iframeCode ? getIframeApp(iframeCode) : null;
        const remoteCode = remoteCodeFromPath(path);

        if (iframeCode) {
          if (!iframeMeta) return null;
          return (
            <div
              key={path}
              className={cn(
                'absolute inset-0 flex flex-col',
                isActive ? 'z-10' : 'pointer-events-none invisible z-0',
              )}
              aria-hidden={!isActive}
            >
              <IframePage basePath={iframeMeta.basePath} title={iframeMeta.title} />
            </div>
          );
        }

        if (remoteCode) {
          if (!getRemoteApp(remoteCode)) return null;
          return (
            <div
              key={path}
              className={cn(
                'absolute inset-0 flex flex-col',
                isActive ? 'z-10' : 'pointer-events-none invisible z-0',
              )}
              aria-hidden={!isActive}
            >
              <RemotePage code={remoteCode} />
            </div>
          );
        }

        const Comp = resolvePageComponent(path);
        if (!Comp) return null;
        return (
          <div
            key={path}
            className={cn(
              // 铺满主区；overflow-auto 作为无内部滚动区页面的兜底（有内部 overflow-auto 时优先滚内层）
              'absolute inset-0 flex min-h-0 flex-col overflow-auto',
              isActive ? 'z-10' : 'pointer-events-none invisible z-0',
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
      {activeRemoteMissing ? (
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

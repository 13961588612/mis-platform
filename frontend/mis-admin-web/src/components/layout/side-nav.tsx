import { NavLink } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { resolveNavIcon } from '@/lib/nav/icons';
import {
  branchContainsPath,
  flattenNavLeaves,
  isNavPathActive,
  type SystemNavNode,
} from '@/lib/nav/system-nav';

interface SideNavProps {
  nodes: SystemNavNode[];
  pathname: string;
  collapsed?: boolean;
  expanded: Record<string, boolean>;
  onToggleBranch: (title: string) => void;
  /** 折叠态下点击分支：展开侧栏并打开该分支（避免折叠时分支点击无反应） */
  onExpandBranch?: (title: string) => void;
  onNavigate?: () => void;
  /** 侧栏分组标题（按当前 APP 动态传入，如「管理与治理 / 知识管理 / 智能体运营」） */
  sectionLabel?: string;
}

/** 门户 C9：多级侧栏（父级展开/收起 + 子项左边线），非扁平分组、非抽屉内容 */
export function SideNav({
  nodes,
  pathname,
  collapsed = false,
  expanded,
  onToggleBranch,
  onExpandBranch,
  onNavigate,
  sectionLabel,
}: SideNavProps) {
  // 折叠态悬浮飞出子菜单：用 fixed 定位（视口坐标），避免被侧栏 overflow 裁切
  const [flyout, setFlyout] = useState<{ title: string; top: number; left: number } | null>(null);
  const closeTimer = useRef<number | null>(null);

  const showFlyout = (el: HTMLElement, title: string) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const r = el.getBoundingClientRect();
    setFlyout({ title, top: r.top, left: r.right + 6 });
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), 140);
  };
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const hideFlyout = () => setFlyout(null);

  const flyoutNode = flyout
    ? (nodes.find(
        (n) => n.kind === 'branch' && n.title === flyout.title,
      ) as Extract<SystemNavNode, { kind: 'branch' }> | undefined)
    : null;

  // 同树内所有叶子路径参与「最长命中」竞争，避免短前缀与兄弟长路径双高亮
  const competingPaths = flattenNavLeaves(nodes).map((l) => l.path);

  return (
    <nav className="sidebar-scroll h-0 min-h-0 min-w-0 flex-1 flex flex-col gap-0.5 overflow-x-hidden overflow-y-auto p-2">
      {sectionLabel ? (
        <div className={cn('px-3 pb-2 pt-5 text-[0.7rem] font-normal uppercase tracking-[0.05em] text-sidebar-muted', collapsed && 'sr-only')}>
          {sectionLabel}
        </div>
      ) : null}
      {nodes.map((node) => {
        if (node.kind === 'leaf') {
          const Icon = resolveNavIcon(node.icon);
          const active = isNavPathActive(pathname, node.path, competingPaths);
          return (
            <NavLink
              key={node.path}
              to={node.path}
              title={node.title}
              onClick={onNavigate}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                collapsed && 'justify-center px-2',
                active
                  ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-primary-foreground' : 'text-sidebar-muted',
                )}
              />
              {!collapsed ? <span className="truncate">{node.title}</span> : null}
            </NavLink>
          );
        }

        const Icon = resolveNavIcon(node.icon);
        const activeIn = branchContainsPath(node, pathname);
        const open = collapsed ? false : (expanded[node.title] ?? activeIn);

        return (
          <div key={node.title} className="space-y-0.5">
            <button
              type="button"
              title={node.title}
              onMouseEnter={(e) => {
                if (collapsed) showFlyout(e.currentTarget, node.title);
              }}
              onMouseLeave={() => {
                if (collapsed) scheduleClose();
              }}
              onClick={() => {
                if (collapsed) {
                  // 折叠态点击：兜底展开整条侧栏并打开该分支（键盘/点击可达）
                  onExpandBranch?.(node.title);
                  return;
                }
                onToggleBranch(node.title);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                collapsed && 'justify-center px-2',
                open || activeIn
                  ? 'bg-sidebar-accent/60 font-medium text-sidebar-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent',
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-sidebar-muted" />
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-left">{node.title}</span>
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-sidebar-muted opacity-70 transition-transform',
                      open && 'rotate-90',
                    )}
                  />
                </>
              ) : null}
            </button>
            {open && !collapsed ? (
              <div className="ml-3.5 flex flex-col gap-0.5 border-l border-sidebar-border py-0.5 pl-1.5">
                {node.children.map((child) => {
                  const ChildIcon = resolveNavIcon(child.icon);
                  const active = isNavPathActive(pathname, child.path, competingPaths);
                  return (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      title={child.title}
                      onClick={onNavigate}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.85rem] transition',
                        active
                          ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent',
                      )}
                    >
                      <ChildIcon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          active ? 'text-primary-foreground' : 'opacity-80',
                        )}
                      />
                      <span className="truncate">{child.title}</span>
                    </NavLink>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      {collapsed && flyout && flyoutNode ? (
        <div
          className="fixed z-[60] w-52 rounded-md border border-sidebar-border bg-popover p-1.5 shadow-card"
          style={{ top: flyout.top, left: flyout.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {flyoutNode.title}
          </div>
          <div className="flex flex-col gap-0.5">
            {flyoutNode.children.map((child) => {
              const ChildIcon = resolveNavIcon(child.icon);
              const active = isNavPathActive(pathname, child.path, competingPaths);
              return (
                <NavLink
                  key={child.path}
                  to={child.path}
                  title={child.title}
                  onClick={() => {
                    cancelClose();
                    hideFlyout();
                    onNavigate?.();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition',
                    active
                      ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                      : 'text-foreground hover:bg-accent',
                  )}
                >
                  <ChildIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      active ? 'text-primary-foreground' : 'opacity-80',
                    )}
                  />
                  <span className="truncate">{child.title}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

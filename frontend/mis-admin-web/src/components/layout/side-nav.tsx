import { NavLink } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveNavIcon } from '@/lib/nav/icons';
import {
  branchContainsPath,
  type SystemNavNode,
} from '@/lib/nav/system-nav';

interface SideNavProps {
  nodes: SystemNavNode[];
  pathname: string;
  collapsed?: boolean;
  expanded: Record<string, boolean>;
  onToggleBranch: (title: string) => void;
  onNavigate?: () => void;
}

/** 门户 C9：多级侧栏（父级展开/收起 + 子项左边线），非扁平分组、非抽屉内容 */
export function SideNav({
  nodes,
  pathname,
  collapsed = false,
  expanded,
  onToggleBranch,
  onNavigate,
}: SideNavProps) {
  return (
    <nav className="sidebar-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-x-hidden p-2">
      <div className={cn('px-3 pb-2 pt-5 text-[0.7rem] font-normal uppercase tracking-[0.05em] text-sidebar-muted', collapsed && 'sr-only')}>
        管理与治理
      </div>
      {nodes.map((node) => {
        if (node.kind === 'leaf') {
          const Icon = resolveNavIcon(node.icon);
          const active = pathname === node.path || pathname.startsWith(`${node.path}/`);
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
              onClick={() => {
                if (collapsed) return;
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
                  const active =
                    pathname === child.path || pathname.startsWith(`${child.path}/`);
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
    </nav>
  );
}

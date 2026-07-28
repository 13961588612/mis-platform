import type { RouterNode } from '@/types/api';
import type { SystemNavLeaf, SystemNavNode } from '@/lib/nav/system-nav';

function flattenLeaves(nodes: SystemNavNode[]): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of nodes) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}

function joinPath(parent: string, segment: string | null | undefined): string {
  if (!segment || !segment.trim()) return parent || '/';
  const seg = segment.trim();
  if (seg.startsWith('/')) return seg;
  const base = (parent || '/').replace(/\/$/, '');
  if (!base || base === '/') return `/${seg}`;
  return `${base}/${seg}`.replace(/\/+/g, '/');
}

function collectLeaves(node: RouterNode, parentPath: string): SystemNavLeaf[] {
  const full = joinPath(parentPath, node.path);
  const children = (node.children ?? []).filter(Boolean);
  if (children.length === 0) {
    return [
      {
        path: full.startsWith('/') ? full : `/${full}`,
        title: node.meta?.title || node.name,
        icon: node.meta?.icon || 'Circle',
      },
    ];
  }
  return children.flatMap((c) => collectLeaves(c, full));
}

/** 将 /menus/router 转为侧栏多级结构；无数据时返回 null（调用方回退静态 SYSTEM_NAV）。 */
export function routerMenusToSystemNav(menus: RouterNode[] | null | undefined): SystemNavNode[] | null {
  if (!menus || menus.length === 0) return null;

  return menus.map((node) => {
    const children = node.children ?? [];
    const title = node.meta?.title || node.name;
    const icon = node.meta?.icon || 'Folder';
    const full = joinPath('/', node.path);

    if (children.length === 0) {
      return {
        kind: 'leaf' as const,
        path: full.startsWith('/') ? full : `/${full}`,
        title,
        icon,
      };
    }

    return {
      kind: 'branch' as const,
      title,
      icon,
      children: children.flatMap((c) => collectLeaves(c, full)),
    };
  });
}

/**
 * 以 fallback（SYSTEM_NAV，完整的规范结构）为骨架，用动态菜单(dyn)中「同路径」的叶节点
 * 做标题/图标增强；fallback 中的叶始终保留。
 *
 * 用途：后端 /menus/router 来自 seed + 角色权限，偶发缺漏（如迁移未执行、权限未授予）
 * 时，不应让侧栏结构出现空洞。fallback 是产品的权威路由清单，动态数据仅作增量增强，
 * 而非整体替换——否则部分返回会覆盖完整静态导航（这正是「菜单不全」的根因）。
 */
export function mergeNavWithFallback(
  fallback: SystemNavNode[],
  dyn: SystemNavNode[] | null | undefined,
): SystemNavNode[] {
  const dynLeaves = new Map<string, SystemNavLeaf>();
  if (dyn) {
    for (const leaf of flattenLeaves(dyn)) dynLeaves.set(leaf.path, leaf);
  }
  return fallback.map((node) => {
    if (node.kind === 'leaf') {
      const d = dynLeaves.get(node.path);
      return d ? { ...node, title: d.title ?? node.title, icon: d.icon ?? node.icon } : node;
    }
    return {
      ...node,
      children: node.children.map((c) => {
        const d = dynLeaves.get(c.path);
        return d ? { ...c, title: d.title ?? c.title, icon: d.icon ?? c.icon } : c;
      }),
    };
  });
}

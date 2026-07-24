import type { RouterNode } from '@/types/api';

export interface NavLeaf {
  kind: 'leaf';
  id: string;
  path: string;
  title: string;
  icon?: string | null;
}

export interface NavGroup {
  kind: 'group';
  id: string;
  title: string;
  icon?: string | null;
  children: NavLeaf[];
}

export type NavEntry = NavLeaf | NavGroup;

function joinPath(parent: string, segment: string): string {
  const raw = segment.startsWith('/')
    ? segment
    : `${parent}/${segment}`.replace(/\/+/g, '/');
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** 将 BFF router 树转为侧栏可用的分组/叶子结构（保留一层目录）。 */
export function buildNavTree(nodes: RouterNode[], parentPath = ''): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const node of nodes) {
    const full = joinPath(parentPath, node.path || '');
    const title = node.meta?.title ?? node.name;
    const isLayout = !node.component || node.component === 'Layout';
    const kids = node.children?.filter(Boolean) ?? [];

    if (isLayout && kids.length > 0) {
      const leaves: NavLeaf[] = [];
      for (const child of kids) {
        const childPath = joinPath(full === '/' ? '' : full, child.path || '');
        if (child.component && child.component !== 'Layout') {
          leaves.push({
            kind: 'leaf',
            id: child.id,
            path: childPath,
            title: child.meta?.title ?? child.name,
            icon: child.meta?.icon,
          });
        } else if (child.children?.length) {
          // 再深一层：展平到当前组
          for (const nested of buildNavTree([child], full === '/' ? '' : full)) {
            if (nested.kind === 'leaf') leaves.push(nested);
            else leaves.push(...nested.children);
          }
        }
      }
      if (leaves.length > 0) {
        entries.push({
          kind: 'group',
          id: node.id,
          title,
          icon: node.meta?.icon,
          children: leaves,
        });
      }
      continue;
    }

    if (node.component && node.component !== 'Layout') {
      entries.push({
        kind: 'leaf',
        id: node.id,
        path: full,
        title,
        icon: node.meta?.icon,
      });
    }
  }
  return entries;
}

export function findNavTitle(entries: NavEntry[], pathname: string): string | undefined {
  return findNavLeaf(entries, pathname)?.title;
}

export function findNavIcon(entries: NavEntry[], pathname: string): string | null | undefined {
  return findNavLeaf(entries, pathname)?.icon;
}

function findNavLeaf(entries: NavEntry[], pathname: string): NavLeaf | undefined {
  for (const entry of entries) {
    if (entry.kind === 'leaf' && (pathname === entry.path || pathname.startsWith(`${entry.path}/`))) {
      return entry;
    }
    if (entry.kind === 'group') {
      for (const child of entry.children) {
        if (pathname === child.path || pathname.startsWith(`${child.path}/`)) {
          return child;
        }
      }
    }
  }
  return undefined;
}

export function groupIsActive(group: NavGroup, pathname: string): boolean {
  return group.children.some(
    (c) => pathname === c.path || pathname.startsWith(`${c.path}/`),
  );
}

import type { DeptNode } from '@/types/api';

/** 子树（含自身）是否存在被选中的节点。 */
export function hasSelectedDescendant(node: DeptNode, selected: Set<string>): boolean {
  if (node.children?.some((c) => selected.has(c.id))) return true;
  return node.children?.some((c) => hasSelectedDescendant(c, selected)) ?? false;
}

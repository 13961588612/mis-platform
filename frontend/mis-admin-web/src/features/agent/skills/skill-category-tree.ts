/** 技能分类树（平台表 ai_skill_category），与 Skill.category 字符串无关。 */

export type SkillCatNode = {
  id: number;
  parent_id: number;
  name: string;
  sort_order: number;
  children: SkillCatNode[];
};

export type SkillCatFlat = {
  id: number;
  name: string;
  path: string;
  depth: number;
};

export function flattenSkillCategories(
  tree: SkillCatNode[],
  depth = 0,
  prefix = '',
): SkillCatFlat[] {
  const out: SkillCatFlat[] = [];
  for (const n of tree) {
    const path = prefix ? `${prefix}/${n.name}` : n.name;
    out.push({ id: n.id, name: n.name, path, depth });
    if (n.children?.length) {
      out.push(...flattenSkillCategories(n.children, depth + 1, path));
    }
  }
  return out;
}

export function skillCatPathById(tree: SkillCatNode[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of flattenSkillCategories(tree)) {
    map.set(row.id, row.path);
  }
  return map;
}

/** 选中节点及其全部子孙 id。 */
export function skillCatDescendantIds(tree: SkillCatNode[], id: number): Set<number> {
  const set = new Set<number>();
  const walk = (nodes: SkillCatNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) {
        collect(n, set);
        return true;
      }
      if (walk(n.children ?? [])) return true;
    }
    return false;
  };
  walk(tree);
  return set;
}

function collect(n: SkillCatNode, set: Set<number>): void {
  set.add(n.id);
  for (const c of n.children ?? []) collect(c, set);
}

export function findSkillCatNode(tree: SkillCatNode[], id: number): SkillCatNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const hit = findSkillCatNode(n.children ?? [], id);
    if (hit) return hit;
  }
  return null;
}

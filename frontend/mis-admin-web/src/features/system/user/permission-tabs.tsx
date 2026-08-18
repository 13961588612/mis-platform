import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchDeptTree } from '@/lib/api/depts';
import type { DeptNode, OrgItem, RoleItem } from '@/types/api';
import { hasSelectedDescendant } from './permission-dept-tree-utils';

/** 权限选择结果：组织 / 部门 / 角色 三组 id（均为字符串数组） */
export interface PermSelection {
  orgIds: string[];
  deptIds: string[];
  roleIds: string[];
}

interface PermissionTabsProps {
  orgs: OrgItem[];
  roles: RoleItem[];
  value: PermSelection;
  onChange: (next: PermSelection) => void;
}

/** 每个组织一棵部门树（森林）；组织与部门互不联动，各自独立勾选。 */
interface DeptForest {
  orgId: string;
  orgName: string;
  roots: DeptNode[];
}

/**
 * 递归渲染部门树。
 *
 * <p>三态 checkbox：本节点自身选中=勾选；本节点未选但子树存在被选中节点=半选
 * （即使所有下级都选中也显示半选，提示「存在下级已被选中」，不随下级全选而变勾选）；
 * 否则不选。点击 checkbox 仅切换本节点自身，不级联子孙；展开/收起不联动选中态。</p>
 */
function renderDeptNodes(
  nodes: DeptNode[],
  depth: number,
  expanded: Set<string>,
  selected: Set<string>,
  onToggleExpand: (id: string) => void,
  onToggle: (id: string) => void,
): ReactNode {
  return nodes.map((n) => {
    const hasChildren = !!n.children?.length;
    const isExpanded = expanded.has(n.id);
    const selfChecked = selected.has(n.id);
    const semi = !selfChecked && hasSelectedDescendant(n, selected);
    return (
      <div key={n.id}>
        <div
          className="flex items-center gap-1 py-0.5 text-sm"
          style={{ paddingLeft: depth * 18 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleExpand(n.id)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
              aria-label={isExpanded ? '折叠' : '展开'}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="inline-block h-5 w-5 shrink-0" />
          )}
          <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={selfChecked}
              ref={(el) => {
                if (el) el.indeterminate = semi;
              }}
              onChange={() => onToggle(n.id)}
            />
            <span className="truncate">{n.name}</span>
          </label>
        </div>
        {hasChildren && isExpanded
          ? renderDeptNodes(n.children as DeptNode[], depth + 1, expanded, selected, onToggleExpand, onToggle)
          : null}
      </div>
    );
  });
}

/**
 * 用户权限：组织 / 部门 / 角色 三个独立 TAB（无联动）。
 *
 * <ul>
 *   <li>组织与部门互不联动：组织 TAB 按当前权限列组织；部门 TAB 按当前权限取各组织部门树，
 *       树形展示、默认全收缩、三态 checkbox（半选=存在下级被选中），点击仅切换本节点；</li>
 *   <li>角色 TAB 为唯一角色分配入口，保存时由父组件调用 {@code assignUserRoles}。</li>
 * </ul>
 */
export function PermissionTabs({ orgs, roles, value, onChange }: PermissionTabsProps) {
  const [tab, setTab] = useState('org');
  const [forest, setForest] = useState<DeptForest[]>([]);
  // 默认空集合 = 全部收缩；仅当 expanded 含某节点 id 时才渲染其 children
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 按组织并行取部门树（各组织一棵树）；组织与部门互不联动，独立勾选
  useEffect(() => {
    let alive = true;
    if (orgs.length === 0) {
      setForest([]);
      return;
    }
    Promise.all(
      orgs.map((o) =>
        fetchDeptTree(o.id)
          .then((roots) => ({ orgId: o.id, orgName: o.name, roots }))
          .catch(() => ({ orgId: o.id, orgName: o.name, roots: [] as DeptNode[] })),
      ),
    ).then((list) => {
      if (!alive) return;
      setForest(list.filter((f) => f.roots.length > 0));
    });
    return () => {
      alive = false;
    };
  }, [orgs]);

  const toggle = (key: 'orgIds' | 'deptIds' | 'roleIds', id: string, checked: boolean) => {
    const cur = value[key];
    // checked 表示「点击前已勾选」：已勾选点击 → 移除；未勾选点击 → 添加
    const nextArr = checked ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ ...value, [key]: nextArr });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedDeptIds = new Set(value.deptIds);

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList>
        <TabsTrigger value="org">组织</TabsTrigger>
        <TabsTrigger value="dept">部门</TabsTrigger>
        <TabsTrigger value="role">角色</TabsTrigger>
      </TabsList>

      <TabsContent value="org">
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
          {orgs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无可分配组织</p>
          ) : (
            orgs.map((o) => {
              const checked = value.orgIds.includes(o.id);
              return (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle('orgIds', o.id, checked)}
                  />
                  {o.name}
                </label>
              );
            })
          )}
        </div>
      </TabsContent>

      <TabsContent value="dept">
        <div className="max-h-72 overflow-auto rounded-md border p-2">
          {forest.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无可分配部门</p>
          ) : (
            forest.map((f) => (
              <div key={f.orgId} className="mb-2 last:mb-0">
                <p className="px-1 pb-0.5 text-xs font-medium text-muted-foreground">{f.orgName}</p>
                {renderDeptNodes(f.roots, 0, expanded, selectedDeptIds, toggleExpand, (id) =>
                  toggle('deptIds', id, selectedDeptIds.has(id)),
                )}
              </div>
            ))
          )}
        </div>
      </TabsContent>

      <TabsContent value="role">
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
          {roles.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无可分配角色</p>
          ) : (
            roles.map((r) => {
              const checked = value.roleIds.includes(r.id);
              return (
                <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle('roleIds', r.id, checked)}
                  />
                  {r.name}
                  <span className="text-xs text-muted-foreground">({r.code})</span>
                </label>
              );
            })
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

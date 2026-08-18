import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchDeptTree } from '@/lib/api/depts';
import type { DeptNode, OrgItem, RoleItem } from '@/types/api';

/** 权限选择结果：组织 / 部门 / 角色 三组 id（均为字符串数组） */
export interface PermSelection {
  orgIds: string[];
  deptIds: string[];
  roleIds: string[];
}

interface PermNode {
  id: string;
  name: string;
  depth: number;
}

/** 部门树扁平化（保留层级深度用于缩进） */
function flattenDeptNodes(nodes: DeptNode[], depth = 0): PermNode[] {
  const out: PermNode[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flattenDeptNodes(n.children, depth + 1));
  }
  return out;
}

interface PermissionTabsProps {
  orgs: OrgItem[];
  roles: RoleItem[];
  value: PermSelection;
  onChange: (next: PermSelection) => void;
}

/**
 * 用户权限：组织 / 部门 / 角色 三个独立 TAB（无联动）。
 *
 * <ul>
 *   <li>组织与部门互不联动：部门列表来自全量部门树（按组织取树后扁平化去重），不随组织勾选过滤；</li>
 *   <li>角色 TAB 为唯一角色分配入口，保存时由父组件调用 {@code assignUserRoles}。</li>
 * </ul>
 */
export function PermissionTabs({ orgs, roles, value, onChange }: PermissionTabsProps) {
  const [tab, setTab] = useState('org');
  const [deptNodes, setDeptNodes] = useState<PermNode[]>([]);

  // 加载全部部门（按组织取树后扁平化）；组织与部门互不联动，独立勾选
  useEffect(() => {
    let alive = true;
    if (orgs.length === 0) {
      setDeptNodes([]);
      return;
    }
    Promise.all(orgs.map((o) => fetchDeptTree(o.id)))
      .then((trees) => {
        if (!alive) return;
        const flat = trees.flatMap((t) => flattenDeptNodes(t));
        const seen = new Set<string>();
        const deduped: PermNode[] = [];
        for (const n of flat) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            deduped.push(n);
          }
        }
        setDeptNodes(deduped);
      })
      .catch(() => {
        if (alive) setDeptNodes([]);
      });
    return () => {
      alive = false;
    };
  }, [orgs]);

  const toggle = (key: 'orgIds' | 'deptIds' | 'roleIds', id: string, checked: boolean) => {
    const cur = value[key];
    const nextArr = checked ? [...cur, id] : cur.filter((x) => x !== id);
    onChange({ ...value, [key]: nextArr });
  };

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
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border p-2">
          {deptNodes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无可分配部门</p>
          ) : (
            deptNodes.map((n) => {
              const checked = value.deptIds.includes(n.id);
              return (
                <label
                  key={n.id}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                  style={{ paddingLeft: n.depth * 14 + 4 }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle('deptIds', n.id, checked)}
                  />
                  {n.name}
                </label>
              );
            })
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

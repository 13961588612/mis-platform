import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fetchDeptTree } from '@/lib/api/depts';
import { listOrgs } from '@/lib/api/orgs';
import type { DeptNode, OrgItem } from '@/types/api';

const fieldInputClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

export interface DeptTreeMultiProps {
  /** 当前选中部门 id 数组（多选，沿用 deptIds 并集语义） */
  value?: (string | number)[];
  onChange: (value: (string | number)[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * 部门树形多选（E.7）：用于岗位查询「所属部门」过滤。
 *
 * <p>与 DeptTreeSelect 同源修复（E.6）：组织选择器独立于 Popover，Popover 内只渲染部门树
 * （复选 + 选中以 chip 展示 + 保持 Popover 打开）。值类型 string[]，提交 deptIds（并集）。
 * 复用现有 fetchDeptTree / listOrgs，不引入新依赖。
 */
export function DeptTreeMulti({ value = [], onChange, placeholder, disabled }: DeptTreeMultiProps) {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [open, setOpen] = useState(false);

  const selectedIds = useMemo(() => new Set(value.map(String)), [value]);

  // id → name 映射（用于 chip 展示）
  const idToName = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: DeptNode[]) => {
      for (const n of nodes) {
        map.set(String(n.id), n.name);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  // 组织列表仅加载一次；首次加载后默认选中首个组织
  useEffect(() => {
    let alive = true;
    listOrgs()
      .then((list) => {
        if (!alive) return;
        setOrgs(list);
        setOrgId((prev) => (prev || (list[0] ? String(list[0].id) : '')));
      })
      .catch(() => {
        /* 组织加载失败：选择器为空，不影响其他交互 */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    fetchDeptTree(orgId)
      .then((t) => {
        if (alive) setTree(t);
      })
      .catch(() => {
        if (alive) setTree([]);
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  const toggleNode = (node: DeptNode) => {
    const key = String(node.id);
    if (selectedIds.has(key)) {
      onChange(value.filter((v) => String(v) !== key));
    } else {
      onChange([...value, node.id]);
    }
  };

  const removeChip = (key: string) => {
    onChange(value.filter((v) => String(v) !== key));
  };

  const renderNodes = (nodes: DeptNode[], depth: number): ReactNode =>
    nodes.map((n) => {
      const checked = selectedIds.has(String(n.id));
      return (
        <div key={n.id}>
          <button
            type="button"
            onClick={() => toggleNode(n)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition hover:bg-muted',
              checked && 'bg-primary/10 font-medium text-primary',
              depth > 0 && 'ml-3',
            )}
          >
            <span
              className={cn(
                'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
              )}
            >
              {checked ? <Check className="h-3 w-3" /> : null}
            </span>
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{n.name}</span>
          </button>
          {n.children?.length ? renderNodes(n.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <div className="flex items-stretch gap-2">
      {/* 组织选择器：独立于 Popover（E.6 根因修复） */}
      <select
        className="h-auto min-h-9 w-32 shrink-0 rounded-md border border-input bg-card px-2 text-sm"
        value={orgId}
        disabled={disabled}
        onChange={(e) => setOrgId(e.target.value)}
      >
        {orgs.length === 0 ? (
          <option value="">暂无组织</option>
        ) : (
          orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))
        )}
      </select>
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              fieldInputClass,
              'flex flex-1 items-center justify-between text-left',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <span className={cn(selectedIds.size === 0 ? 'text-muted-foreground' : 'text-foreground')}>
              {selectedIds.size === 0
                ? placeholder || '请选择部门（可多选）'
                : `已选 ${selectedIds.size} 个部门`}
            </span>
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            勾选部门（当前组织：{orgs.find((o) => o.id === orgId)?.name ?? '—'}）
          </div>
          <div className="max-h-64 overflow-auto rounded-md border border-border/60 p-1">
            {tree.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">该组织暂无部门</div>
            ) : (
              renderNodes(tree, 0)
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedIds.size > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {value.map((v) => {
            const key = String(v);
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary/80"
              >
                {idToName.get(key) ?? key}
                <button
                  type="button"
                  className="rounded-full hover:text-primary"
                  onClick={() => removeChip(key)}
                  aria-label={`移除 ${idToName.get(key) ?? key}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

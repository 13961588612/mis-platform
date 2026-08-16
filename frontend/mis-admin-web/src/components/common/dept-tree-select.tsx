import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fetchDeptTree } from '@/lib/api/depts';
import { listOrgs } from '@/lib/api/orgs';
import type { DeptNode, OrgItem } from '@/types/api';

const fieldInputClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

export interface DeptTreeSelectProps {
  /** 当前选中部门 id（单值）；表单回填时由引擎传入 */
  value?: string | number | null;
  /** 选中部门时回传单值 deptId（POST-01：提交单值） */
  onChange: (value: string | number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * 部门树形单选（POST-01）。
 *
 * <p><b>根因修复（E.6）</b>：组织选择器<b>移出</b> Radix Popover —— 原生 &lt;select&gt; 展开后的选项
 * 是操作系统级浮层，不在 Popover DOM 内；若置于 {@code PopoverContent} 内，Radix DismissableLayer
 * 会将其判定为「Popover 外交互」而触发关闭（setOpen(false)）。现组织选择器作为 Popover 触发器旁的
 * 独立 DOM，Popover 内只渲染部门树，点组织不再误关弹窗。
 *
 * <p>单选语义保留：选中部门回填单值 deptId（与 sys_post.dept_id 单部门归属一致）。
 * 复用现有 fetchDeptTree / listOrgs，不引入新依赖。
 */
export function DeptTreeSelect({ value, onChange, placeholder, disabled }: DeptTreeSelectProps) {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState('');

  // id → name 映射（用于回填展示选中部门名）
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

  useEffect(() => {
    if (value == null || value === '') {
      setSelectedName('');
      return;
    }
    setSelectedName(idToName.get(String(value)) ?? '');
  }, [value, idToName]);

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

  const selectNode = (node: DeptNode) => {
    onChange(node.id);
    setSelectedName(node.name);
    setOpen(false);
  };

  const renderNodes = (nodes: DeptNode[], depth: number): ReactNode =>
    nodes.map((n) => (
      <div key={n.id}>
        <button
          type="button"
          onClick={() => selectNode(n)}
          className={cn(
            'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition hover:bg-muted',
            String(value) === String(n.id) && 'bg-primary/10 font-medium text-primary',
            depth > 0 && 'ml-3',
          )}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{n.name}</span>
        </button>
        {n.children?.length ? renderNodes(n.children, depth + 1) : null}
      </div>
    ));

  return (
    <div className="flex items-stretch gap-2">
      {/* 组织选择器：独立于 Popover（E.6 根因修复），点组织不会误关部门树弹窗 */}
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
            <span className={cn(selectedName ? 'text-foreground' : 'text-muted-foreground')}>
              {selectedName || placeholder || '请选择部门（树形·单选）'}
            </span>
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            选择部门（当前组织：{orgs.find((o) => o.id === orgId)?.name ?? '—'}）
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
    </div>
  );
}

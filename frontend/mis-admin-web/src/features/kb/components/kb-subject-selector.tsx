import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { searchSubjects } from '../api/kb-api';
import type { KbSubject } from '../types';
import { KB_SUBJECT_TYPE_OPTIONS } from '../types';

/** 选中的授权主体（回传给表单的最小信息）。 */
export interface KbSubjectSelection {
  subjectType: string;
  subjectId: number;
  subjectName: string;
}

interface KbSubjectSelectorProps {
  /** 当前主体类型 `user` | `role` | `dept`。 */
  subjectType: string;
  onSubjectTypeChange: (type: string) => void;
  /** 当前选中项；未选为 null。 */
  value: KbSubjectSelection | null;
  onChange: (selection: KbSubjectSelection | null) => void;
  className?: string;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 授权主体选择器（I-03）。
 *
 * <p>三种主体走同一个后端端点 `/kb/subjects/search?type=&keyword=`：
 * - `user` / `role`：关键字模糊检索，平铺列表
 * - `dept`：后端忽略关键字直接返回整棵树，前端本地过滤 + 折叠展开
 *
 * <p>**为什么部门不做服务端搜索**：部门树是强层级数据，服务端按关键字过滤会
 * 打断父子链路，返回一堆没有上下文的孤儿节点，用户根本分不清「财务部」是哪个公司的。
 * 整树下发 + 本地高亮是唯一能保住层级语义的做法，量级也撑得住（企业部门数通常 < 2000）。
 */
export function KbSubjectSelector({
  subjectType,
  onSubjectTypeChange,
  value,
  onChange,
  className,
}: KbSubjectSelectorProps) {
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<KbSubject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const isDept = subjectType === 'dept';

  const load = useCallback(
    async (type: string, kw: string) => {
      setLoading(true);
      setError(null);
      try {
        // dept 不传关键字：后端返回整树，过滤交给前端做（保住层级）
        const list = await searchSubjects(type, type === 'dept' ? undefined : kw);
        setItems(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : '检索主体失败');
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // 类型切换：清空已选与关键字，立即重新拉取
  useEffect(() => {
    setKeyword('');
    onChange(null);
    void load(subjectType, '');
    // onChange 由父组件以稳定引用传入；纳入依赖会在每次父级渲染时重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, load]);

  // user/role：关键字防抖检索；dept：本地过滤，不再请求
  useEffect(() => {
    if (isDept) return;
    const timer = window.setTimeout(() => void load(subjectType, keyword), 300);
    return () => window.clearTimeout(timer);
  }, [keyword, subjectType, isDept, load]);

  /** 部门树本地过滤：命中节点的所有祖先一并保留，避免层级断链。 */
  const deptTree = useMemo(() => {
    if (!isDept) return items;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    const filter = (nodes: KbSubject[]): KbSubject[] => {
      const out: KbSubject[] = [];
      for (const n of nodes) {
        const children = filter(n.children ?? []);
        const selfHit = (n.name ?? '').toLowerCase().includes(kw);
        if (selfHit || children.length > 0) {
          out.push({ ...n, children });
        }
      }
      return out;
    };
    return filter(items);
  }, [items, keyword, isDept]);

  // 关键字过滤后自动展开全部命中路径，否则用户看到的是一堆折叠的空壳
  useEffect(() => {
    if (!isDept || !keyword.trim()) return;
    const ids = new Set<number>();
    const walk = (nodes: KbSubject[]): void => {
      for (const n of nodes) {
        if (n.id != null && (n.children?.length ?? 0) > 0) ids.add(n.id);
        walk(n.children ?? []);
      }
    };
    walk(deptTree);
    setExpanded(ids);
  }, [deptTree, keyword, isDept]);

  function toggle(id: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function select(node: KbSubject): void {
    if (node.id == null) return;
    onChange({
      subjectType,
      subjectId: node.id,
      subjectName: node.name ?? String(node.id),
    });
  }

  function renderTree(nodes: KbSubject[], depth: number): ReactNode[] {
    return nodes.map((n) => {
      const hasChildren = (n.children?.length ?? 0) > 0;
      const isOpen = n.id != null && expanded.has(n.id);
      const selected = value?.subjectId === n.id && value?.subjectType === subjectType;
      return (
        <div key={`${n.type}-${n.id ?? n.name}`}>
          <div
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-1 text-sm',
              selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
            )}
            style={{ paddingLeft: `${depth * 0.9 + 0.375}rem` }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="shrink-0 rounded p-0.5 hover:bg-accent"
                onClick={() => n.id != null && toggle(n.id)}
                aria-label={isOpen ? '收起' : '展开'}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="w-[1.375rem] shrink-0" />
            )}
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => select(n)}
              title={n.name ?? ''}
            >
              {n.name ?? `#${n.id}`}
              {n.extra ? (
                <span className="ml-1 text-xs text-muted-foreground">{n.extra}</span>
              ) : null}
            </button>
          </div>
          {hasChildren && isOpen ? renderTree(n.children ?? [], depth + 1) : null}
        </div>
      );
    });
  }

  function renderFlat(nodes: KbSubject[]): ReactNode[] {
    return nodes.map((n) => {
      const selected = value?.subjectId === n.id && value?.subjectType === subjectType;
      return (
        <button
          key={`${n.type}-${n.id ?? n.name}`}
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
            selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
          )}
          onClick={() => select(n)}
        >
          <span className="min-w-0 truncate">{n.name ?? `#${n.id}`}</span>
          {n.extra ? (
            <span className="shrink-0 text-xs text-muted-foreground">{n.extra}</span>
          ) : null}
        </button>
      );
    });
  }

  const list = isDept ? deptTree : items;

  return (
    <div className={cn('space-y-2', className)}>
      <select
        className={selectClass}
        value={subjectType}
        onChange={(e) => onSubjectTypeChange(e.target.value)}
      >
        {KB_SUBJECT_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={isDept ? '按部门名称过滤（本地）' : '输入名称 / 工号检索'}
          className="pl-8"
        />
      </div>

      <div className="h-56 overflow-auto rounded-md border bg-card p-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : error ? (
          <p className="p-3 text-sm text-destructive">{error}</p>
        ) : list.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {keyword.trim() ? '无匹配主体' : '暂无可选主体'}
          </p>
        ) : isDept ? (
          renderTree(list, 0)
        ) : (
          renderFlat(list)
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {value
          ? `已选：${value.subjectName}（ID ${value.subjectId}）`
          : '未选择主体'}
      </p>
    </div>
  );
}

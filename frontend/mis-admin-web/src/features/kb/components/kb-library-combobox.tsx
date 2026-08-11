import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, Loader2, RotateCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listCategories, listLibraries } from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import type { KbCategory, KbLibrary } from '../types';
import { secrecyLabel } from '../types';

/** 组合框选项：库 + 预算好的分类路径与搜索索引。 */
export interface KbLibraryOption {
  library: KbLibrary;
  /** 分类全路径，如 `财务 / 报销制度`；无分类时为「未分类」。 */
  categoryPath: string;
  /** 同名库标记：列表里存在另一个同名库时为 true，此时分类路径要加粗。 */
  duplicatedName: boolean;
  /** 预拼好的小写搜索串（库名 ∪ 分类路径 ∪ ID）。 */
  haystack: string;
}

interface KbLibraryComboboxProps {
  /** 当前选中的知识库 ID（null = 未选） */
  value: number | null;
  onChange: (id: number | null, library: KbLibrary | null) => void;
  /** 可选：仅列出指定分类下的知识库 */
  categoryId?: number | null;
  /** 是否允许清空选择 */
  allowClear?: boolean;
  /**
   * 可清空且当前未选时，触发器显示的空选文案（替代默认「请选择知识库」）。
   * 例如问答页传「全部可见知识库」。不传则完全等同 P0 行为。
   */
  emptyOptionLabel?: string;
  placeholder?: string;
  className?: string;
  /** 选项加载完成回调（父组件可缓存列表，如渲染「当前操作对象」卡片） */
  onLoaded?: (options: KbLibraryOption[]) => void;
  /**
   * 所在页面路径（如 `/kb/permissions`）。KeepAlive 下组件常驻，
   * 仅挂载时拉一次会在「他页新建库 → 切回本页」后显示陈旧列表；
   * 传入后路由切回本页时重拉（与 `KbLibraryPicker` 同口径）。
   */
  activePath?: string;
}

const MAX_CATEGORY_DEPTH = 32;

/** 沿 parentId 向上回溯拼分类全路径；`MAX_CATEGORY_DEPTH` 兜住脏数据成环。 */
function buildCategoryPath(categoryId: number | null, byId: Map<number, KbCategory>): string {
  if (categoryId == null) return '未分类';
  const segments: string[] = [];
  let cursor: number | null = categoryId;
  let depth = 0;
  while (cursor != null && depth < MAX_CATEGORY_DEPTH) {
    const node: KbCategory | undefined = byId.get(cursor);
    if (!node) break;
    segments.unshift(node.name);
    cursor = node.parentId;
    depth += 1;
  }
  return segments.length > 0 ? segments.join(' / ') : '未分类';
}

/**
 * 知识库可搜索组合框（Q1 防误选核心控件）。
 *
 * <p>与 {@link KbLibraryPicker} 的区别：原生 `<select>` 只显示「库名（密级）」，
 * 两个不同分类下的同名库在下拉里长得**一模一样**，管理员选错了也没有任何提示——
 * 权限页选错库 = 把机密库授权给错误的人，这是本组件存在的唯一理由。
 *
 * <p>因此这里做三件 `<select>` 做不到的事：
 * <ol>
 *   <li>每行都带**分类全路径**与 `#ID`，同名时路径加粗；</li>
 *   <li>输入即筛，命中「库名 ∪ 分类路径 ∪ ID 串」任一即可；</li>
 *   <li>空态三分（无库 / 搜索无结果 / 加载失败带重试），不给静默空白。</li>
 * </ol>
 *
 * <p>分类路径是**前端本地 join** 出来的（`listLibraries` + `listCategories`），
 * 零后端改动；两个请求并发发出，慢的一方不阻塞另一方渲染。
 *
 * <p>「当前操作对象」卡片刻意**不**做在组件内——那是调用页的布局职责，
 * 塞进来会让这个控件在文档页/命中测试页变得没法用。
 */
export function KbLibraryCombobox({
  value,
  onChange,
  categoryId = null,
  allowClear = false,
  emptyOptionLabel,
  placeholder = '搜索库名 / 分类 / ID',
  className,
  onLoaded,
  activePath,
}: KbLibraryComboboxProps) {
  const [options, setOptions] = useState<KbLibraryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const libraryEpoch = useKbStore((s) => s.libraryEpoch);
  const categoryEpoch = useKbStore((s) => s.categoryEpoch);
  const pathname = useLocation().pathname;
  const pageActive = activePath == null || pathname === activePath;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [libraries, categories] = await Promise.all([
        listLibraries(categoryId),
        listCategories(),
      ]);
      const byId = new Map<number, KbCategory>(categories.map((c) => [c.id, c]));
      const nameCount = new Map<string, number>();
      for (const lib of libraries) {
        nameCount.set(lib.name, (nameCount.get(lib.name) ?? 0) + 1);
      }
      const next: KbLibraryOption[] = libraries.map((library) => {
        const categoryPath = buildCategoryPath(library.categoryId, byId);
        return {
          library,
          categoryPath,
          duplicatedName: (nameCount.get(library.name) ?? 0) > 1,
          haystack: `${library.name} ${categoryPath} ${library.id}`.toLowerCase(),
        };
      });
      setOptions(next);
      onLoaded?.(next);
    } catch (e) {
      setOptions([]);
      setError(e instanceof Error ? e.message : '加载知识库失败');
    } finally {
      setLoading(false);
    }
    // onLoaded 由父组件以稳定引用传入；纳入依赖会造成重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
    if (!pageActive) return;
    void load();
  }, [load, libraryEpoch, categoryEpoch, pageActive]);

  /* 点击组件外部关闭下拉（不劫持 Esc 以外的键盘行为） */
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const selected = useMemo(
    () => options.find((o) => o.library.id === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return options;
    return options.filter((o) => o.haystack.includes(kw));
  }, [options, keyword]);

  /* 选项集变化后把高亮夹回合法区间，否则 Enter 会选中不存在的行 */
  useEffect(() => {
    setActiveIndex((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered]);

  /* 键盘移动时把高亮项滚进可视区 */
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function openPanel() {
    setOpen(true);
    setKeyword('');
    setActiveIndex(Math.max(0, filtered.findIndex((o) => o.library.id === value)));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function pick(option: KbLibraryOption) {
    onChange(option.library.id, option.library);
    setOpen(false);
    setKeyword('');
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      openPanel();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) pick(target);
    }
  }

  const triggerText = selected
    ? `${selected.library.name}（${secrecyLabel(selected.library.secrecy)}）`
    : allowClear && emptyOptionLabel
      ? emptyOptionLabel
      : loading
        ? '加载中…'
        : '请选择知识库';

  return (
    <div ref={rootRef} className={cn('relative', className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-[0.7rem] text-left text-sm shadow-none',
          'focus:outline-none focus:ring-2 focus:ring-ring/40',
          selected ? 'text-foreground' : 'text-muted-foreground',
        )}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <span className="min-w-0 flex-1 truncate">{triggerText}</span>
        {selected ? (
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            {selected.categoryPath} · #{selected.library.id}
          </span>
        ) : null}
        {allowClear && selected ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清空选择"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null, null);
              setOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-40 overflow-hidden rounded-md border border-border bg-popover shadow-card-hover">
          <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={keyword}
              placeholder={placeholder}
              className="h-7 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(e) => {
                setKeyword(e.target.value);
                setActiveIndex(0);
              }}
            />
          </div>

          {error ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              <p className="mb-2 text-destructive">{error}</p>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent"
                onClick={() => void load()}
              >
                <RotateCw className="h-3 w-3" />
                重试
              </button>
            </div>
          ) : loading ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">加载中…</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              还没有知识库，请先到「知识库」页创建
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              没有匹配「{keyword}」的知识库
            </div>
          ) : (
            <ul ref={listRef} role="listbox" className="max-h-72 overflow-auto py-1">
              {filtered.map((o, idx) => {
                const active = idx === activeIndex;
                const isSelected = o.library.id === value;
                return (
                  <li
                    key={o.library.id}
                    data-index={idx}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'cursor-pointer px-3 py-1.5 text-sm',
                      active ? 'bg-accent' : 'hover:bg-accent/60',
                      isSelected && 'text-primary',
                    )}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => pick(o)}
                  >
                    <div className="flex items-baseline gap-1.5">
                      {/* 同名库：分类路径加粗置前，这是区分两个「制度库」的唯一线索 */}
                      <span
                        className={cn(
                          'truncate text-xs',
                          o.duplicatedName
                            ? 'font-bold text-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        {o.categoryPath}
                      </span>
                      <span className="text-muted-foreground">/</span>
                      <span className="truncate font-medium">{o.library.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        （{secrecyLabel(o.library.secrecy)}）
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
                        #{o.library.id}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

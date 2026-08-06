import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { listLibraries } from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import type { KbLibrary } from '../types';
import { secrecyLabel } from '../types';

interface KbLibraryPickerProps {
  /** 当前选中的知识库 ID（null 表示未选） */
  value: number | null;
  onChange: (id: number | null) => void;
  /** 可选：仅列出指定分类下的知识库 */
  categoryId?: number | null;
  /** 是否允许「全部」空选项 */
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  /** 加载完成回调，便于父组件缓存列表 */
  onLoaded?: (libraries: KbLibrary[]) => void;
  /**
   * 所在页面的路径（如 `/kb/documents`）。KeepAlive 下组件常驻，
   * 仅挂载时拉一次会在「他页新建库 → 切回本页」后仍显示空列表；
   * 传入后会在路由切回本页时重拉。
   */
  activePath?: string;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 知识库下拉选择器。
 *
 * <p>列表来自 BFF {@code GET /kb/libraries}（mis-kb 当前按分类可选过滤，
 * <b>不做</b>密级可见性裁剪——可见性只约束检索/问答，管理端列表看全量）。
 * 订阅 {@code libraryEpoch}，创建/删除后与 KeepAlive 回切时都会重拉。
 */
export function KbLibraryPicker({
  value,
  onChange,
  categoryId = null,
  allowEmpty = false,
  emptyLabel = '全部知识库',
  className,
  onLoaded,
  activePath,
}: KbLibraryPickerProps) {
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [loading, setLoading] = useState(false);
  const libraryEpoch = useKbStore((s) => s.libraryEpoch);
  const pathname = useLocation().pathname;
  const pageActive = activePath == null || pathname === activePath;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listLibraries(categoryId);
      setLibraries(list);
      onLoaded?.(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载知识库失败');
    } finally {
      setLoading(false);
    }
    // onLoaded 由父组件以稳定引用传入；此处刻意不纳入依赖以避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
    if (!pageActive) return;
    void load();
  }, [load, libraryEpoch, pageActive]);

  return (
    <select
      className={cn(selectClass, className)}
      value={value == null ? '' : String(value)}
      disabled={loading}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === '' ? null : Number(raw));
      }}
    >
      {allowEmpty ? <option value="">{emptyLabel}</option> : <option value="">请选择知识库</option>}
      {libraries.map((lib) => (
        <option key={lib.id} value={String(lib.id)}>
          {lib.name}（{secrecyLabel(lib.secrecy)}）
        </option>
      ))}
    </select>
  );
}

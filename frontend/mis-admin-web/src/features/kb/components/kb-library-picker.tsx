import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { listLibraries } from '../api/kb-api';
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
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 知识库下拉选择器。
 *
 * <p>列表由 BFF `/kb/libraries` 返回，已由 mis-kb 按可见性过滤（公开∧启用 ∪ ACL − 停用），
 * 前端不再二次裁剪，避免与后端裁定不一致。
 */
export function KbLibraryPicker({
  value,
  onChange,
  categoryId = null,
  allowEmpty = false,
  emptyLabel = '全部知识库',
  className,
  onLoaded,
}: KbLibraryPickerProps) {
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [loading, setLoading] = useState(false);

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
    void load();
  }, [load]);

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

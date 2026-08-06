import { useCallback, useEffect, useRef, useState } from 'react';
import { Power, RefreshCw, RotateCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { EnabledBadge, ParseStatusBadge } from '../components/kb-badges';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { cn } from '@/lib/utils';
import {
  deleteDocument,
  listDocuments,
  reparseDocument,
  setDocumentEnabled,
  uploadDocument,
} from '../api/kb-api';
import type { KbDocument } from '../types';
import { formatSize, formatTime } from '../types';

/** 与 BFF `KbFacadeService` 的 50MB 上限保持一致，前端提前拦截避免无谓上传。 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** 解析中自动刷新间隔（ms）。 */
const PARSING_POLL_MS = 5_000;

/** 列定义：可排序列（标题/大小/版本/更新时间）+ 操作列锁定（不可拖宽/换位）。 */
const DOC_COLUMNS: (ResizableColumn & { sortable?: boolean })[] = [
  { key: 'title', label: '标题', sortable: true },
  { key: 'format', label: '格式' },
  { key: 'size', label: '大小', sortable: true },
  { key: 'version', label: '版本', sortable: true },
  { key: 'parseStatus', label: '解析状态' },
  { key: 'enabled', label: '启用' },
  { key: 'updatedAt', label: '更新时间', sortable: true },
  { key: '__ops__', label: '操作', locked: true },
];

const DOC_LAYOUT_STORAGE_KEY = 'mis-kb-document-table-widths';

export interface KbDocumentTableProps {
  /** 固定知识库 id；L-06 库详情 Tab 直接传入，详情页不另选库。 */
  libraryId: number;
  /** 是否显示上传入口（库详情页允许就地补传文档）。 */
  showUpload?: boolean;
  /** 表格是否占满父容器高度（嵌在 Tab 内需要 flex-1；文档整页场景可省略）。 */
  fill?: boolean;
}

/**
 * 文档列表（复用单元）。
 *
 * <p>把「知识库文档列表 + 启用/重解析/删除/上传」收敛到一处，避免库详情页（L-06 文档 Tab）
 * 与文档管理页各写一份相同 UI 造成漂移。库详情 Tab 固定传 `libraryId`、开 `showUpload`；
 * 文档管理页则把选择器选出的 `libraryId` 透传进来。
 *
 * <p>解析为异步流程，存在 pending/parsing 文档时自动轮询刷新，直至收敛为 success/failed。
 */
export function KbDocumentTable({
  libraryId,
  showUpload = false,
  fill = false,
}: KbDocumentTableProps) {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 列宽记忆（localStorage）+ 表头排序（三态 无 → 升 → 降 → 无）
  const { widthOf, startResize, hasCustom, reset: resetWidths } = useColumnWidths(
    DOC_COLUMNS,
    DOC_LAYOUT_STORAGE_KEY,
  );
  const getSortValue = useCallback((row: KbDocument, key: string) => row[key as keyof KbDocument], []);
  const { sorted: sortedDocs, sortKey, sortDir, toggleSort } = useClientSort(documents, getSortValue);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    try {
      setDocuments(await listDocuments(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载文档失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(libraryId);
  }, [libraryId, load]);

  // 存在未完成解析的文档时自动轮询
  const hasPending = documents.some(
    (d) => d.parseStatus === 'pending' || d.parseStatus === 'parsing',
  );
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      void load(libraryId);
    }, PARSING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasPending, libraryId, load]);

  async function onPickFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`文件超过 ${formatSize(MAX_UPLOAD_BYTES)} 上限`);
      return;
    }
    setUploading(true);
    try {
      const result = await uploadDocument(libraryId, file);
      toast.success(`已上传「${file.name}」，解析状态：${result.parseStatus}`);
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onToggleEnabled(doc: KbDocument) {
    try {
      await setDocumentEnabled(libraryId, doc.id, doc.enabled !== 1);
      toast.success(doc.enabled === 1 ? '已停用' : '已启用');
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '切换状态失败');
    }
  }

  async function onReparse(doc: KbDocument) {
    try {
      await reparseDocument(libraryId, doc.id);
      toast.success('已提交重新解析');
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重新解析失败');
    }
  }

  async function onDelete(doc: KbDocument) {
    if (!window.confirm(`删除文档「${doc.title}」？引擎侧索引将一并清除。`)) return;
    try {
      await deleteDocument(libraryId, doc.id);
      toast.success('已删除');
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'flex flex-col gap-2'}>
      {showUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <PermissionGate permission="kb:document:add">
            <Button size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {uploading ? '上传中…' : '上传文档'}
            </Button>
          </PermissionGate>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load(libraryId)}
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          {hasCustom ? (
            <Button size="sm" variant="ghost" onClick={resetWidths}>
              重置列宽
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            单文件不超过 {formatSize(MAX_UPLOAD_BYTES)}
          </span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
      />

      <div
        className={
          fill
            ? 'min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface'
            : 'overflow-auto rounded-lg border bg-table-surface'
        }
      >
        <table className="w-full table-fixed border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              {DOC_COLUMNS.map((col, ci) => {
                const active = sortKey === col.key;
                const sortable = !!col.sortable;
                return (
                  <th
                    key={col.key}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ width: widthOf(col.key) }}
                    className={cn('px-3 py-2 font-bold', ci > 0 && 'border-l border-border/60')}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'flex w-full items-center gap-1 pr-5 text-left font-bold transition-colors',
                          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                        aria-label={`按${col.label}排序`}
                      >
                        {col.label}
                        <SortIndicator state={active ? sortDir : 'none'} />
                      </button>
                    ) : (
                      <span className="block pr-5 font-bold">{col.label}</span>
                    )}
                    {!col.locked ? (
                      <span
                        onMouseDown={(e) => startResize(e, col.key)}
                        className="absolute inset-y-0 right-0 z-10 w-[5px] cursor-col-resize touch-none select-none hover:bg-primary/40"
                        aria-hidden
                        title={`拖动调整${col.label}列宽`}
                      />
                    ) : null}
                  </th>
                );
              })}
              <th
                className="border-l border-border/60 px-3 py-2 font-bold"
                style={{ width: widthOf('__ops__') ?? 150 }}
              >
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  暂无文档
                </td>
              </tr>
            ) : (
              sortedDocs.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="overflow-hidden whitespace-nowrap text-ellipsis px-3 py-2" title={doc.title}>
                    {doc.title}
                  </td>
                  <td className="overflow-hidden whitespace-nowrap text-ellipsis px-3 py-2 font-mono text-xs">
                    {doc.format ?? '-'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatSize(doc.size)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">v{doc.version ?? 1}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <ParseStatusBadge status={doc.parseStatus} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <EnabledBadge enabled={doc.enabled} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(doc.updatedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center gap-1">
                      <PermissionGate permission="kb:document:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => void onToggleEnabled(doc)}
                        >
                          <Power className="h-3 w-3" />
                          {doc.enabled === 1 ? '停用' : '启用'}
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="kb:document:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => void onReparse(doc)}
                        >
                          <RotateCw className="h-3 w-3" />
                          重解析
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="kb:document:delete">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                          onClick={() => void onDelete(doc)}
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </button>
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

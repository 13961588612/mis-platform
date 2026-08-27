import { useCallback, useEffect, useState } from 'react';
import { Eye, ListRestart, Power, RefreshCw, RotateCw, Settings2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ResetColWidthButton } from '@/components/common/header-action-buttons';
import { Badge } from '@/components/ui/badge';
import { PermissionGate } from '@/components/auth/permission-gate';
import { EnabledBadge, ParseStatusBadge } from '../components/kb-badges';
import { KbDocumentUploadDialog } from '../components/kb-document-upload-dialog';
import { KbDocChunkDialog } from '../components/kb-doc-chunk-dialog';
import { KbDocChunkViewDrawer } from '../components/kb-doc-chunk-view-drawer';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { cn } from '@/lib/utils';
import {
  deleteDocument,
  listDocuments,
  reparseAllDocuments,
  reparseDocument,
  setDocumentEnabled,
} from '../api/kb-api';
import type { KbDocument, KbRagSettings } from '../types';
import { chunkMethodLabel, formatSize, formatTime } from '../types';

/** 解析中自动刷新间隔（ms）。 */
const PARSING_POLL_MS = 5_000;

/**
 * 解析状态单元格（KE-03/KE-04，企业级增强一期）。
 *
 * <p>在既有徽标基础上增强两处：
 * <ul>
 *   <li><b>parsing</b>：徽标旁展示解析进度百分比（{@code parseProgress}，0~100；null = 未知）；</li>
 *   <li><b>failed</b>：把失败原因（{@code parseError}，引擎 progress_msg 摘要）挂到徽标的
 *       title 上，鼠标悬停可见；无失败原因时仅展示徽标。</li>
 * </ul>
 */
function ParseStatusCell({ doc }: { doc: KbDocument }) {
  const progress = doc.parseStatus === 'parsing' && doc.parseProgress != null ? doc.parseProgress : null;
  const error = doc.parseStatus === 'failed' && doc.parseError ? doc.parseError : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={error ? `失败原因：${error}` : undefined}
    >
      <ParseStatusBadge status={doc.parseStatus} />
      {progress != null ? <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span> : null}
    </span>
  );
}

/** 列定义：可排序列（标题/大小/版本/更新时间）+ 操作列锁定（不可拖宽/换位）。 */
const DOC_COLUMNS: (ResizableColumn & { sortable?: boolean })[] = [
  { key: 'title', label: '标题', sortable: true },
  { key: 'format', label: '格式' },
  { key: 'size', label: '大小', sortable: true },
  { key: 'version', label: '版本', sortable: true },
  { key: 'parseStatus', label: '解析状态' },
  { key: 'chunk', label: '切片方式' },
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
  /**
   * 库级 RAG 设置（kb_settings_model_chunk）：供「切片方式」列对「继承库级」文档
   * 标注库级当前有效值（title 提示）。详情页传入；文档管理页不传也不影响功能。
   */
  librarySettings?: KbRagSettings | null;
}

/**
 * 文档列表（复用单元）。
 *
 * <p>把「知识库文档列表 + 启用/重解析/删除/上传/切片设置」收敛到一处，避免库详情页
 * （L-06 文档 Tab）与文档管理页各写一份相同 UI 造成漂移。库详情 Tab 固定传
 * `libraryId`、开 `showUpload`；文档管理页则把选择器选出的 `libraryId` 透传进来。
 *
 * <p>解析为异步流程，存在 pending/parsing 文档时自动轮询刷新，直至收敛为 success/failed。
 *
 * <p>「切片方式」列来源徽标（kb_settings_model_chunk，PRD §5.3）：任一文件级字段非空
 * = FILE_OVERRIDE（文件指定），否则 LIBRARY（继承库级，title 提示库级当前有效值）。
 */
export function KbDocumentTable({
  libraryId,
  showUpload = false,
  fill = false,
  librarySettings = null,
}: KbDocumentTableProps) {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [chunkDoc, setChunkDoc] = useState<KbDocument | null>(null);
  const [chunkOpen, setChunkOpen] = useState(false);
  const [viewDoc, setViewDoc] = useState<KbDocument | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [reparsingAll, setReparsingAll] = useState(false);
  const [reparsingFailed, setReparsingFailed] = useState(false);

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

  /** 文档是否有文件级切片覆盖（任一字段非空）。 */
  function hasChunkOverride(doc: KbDocument): boolean {
    return (
      (doc.chunkMethod != null && doc.chunkMethod !== '') ||
      doc.chunkTokenNum != null ||
      doc.separator != null
    );
  }

  /** 切片方式单元格：方法名 + 来源徽标。 */
  function renderChunkCell(doc: KbDocument) {
    const override = hasChunkOverride(doc);
    const method = doc.chunkMethod != null && doc.chunkMethod !== '' ? doc.chunkMethod : null;
    const libraryMethod = librarySettings?.chunkMethod ?? null;
    const effective = method ?? libraryMethod ?? null;
    const detail = [
      doc.chunkTokenNum != null ? `${doc.chunkTokenNum} token` : null,
      doc.separator != null ? `分隔符: ${doc.separator}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const title = [
      effective ? `生效切片方式: ${chunkMethodLabel(effective)}` : '切片方式: 引擎默认',
      detail,
      override ? '来源: 文件指定' : `来源: 继承库级${libraryMethod ? `（库级 ${chunkMethodLabel(libraryMethod)}）` : ''}`,
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={title}>
        <span className="max-w-[8rem] truncate text-xs">{chunkMethodLabel(effective)}</span>
        {override ? (
          <Badge variant="info" className="px-1.5 py-0 text-[0.6875rem]">
            文件指定
          </Badge>
        ) : (
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.6875rem]">
            继承库级
          </Badge>
        )}
      </span>
    );
  }

  function openChunkDialog(doc: KbDocument) {
    setChunkDoc(doc);
    setChunkOpen(true);
  }

  function openChunkView(doc: KbDocument) {
    setViewDoc(doc);
    setViewOpen(true);
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

  /**
   * 库级一键全部重解析（P1-1：换嵌入模型后全量重解析恢复检索）。
   *
   * <p>确认弹窗内置换模型提示：换嵌入模型后若未全量重解析，检索会因向量映射错误
   * （`q_1536_vec`）报错；重解析期间该库检索可能不可用。此处不做「最近是否改过
   * 嵌入模型」的运行时探测——库侧没有重解析时间戳可比对，静态提示是最小且诚实的方案。
   */
  async function onReparseAll() {
    const count = documents.length;
    if (count === 0) {
      toast.info('该库暂无文档，无需重解析');
      return;
    }
    const ok = window.confirm(
      `确定对该库全部 ${count} 个文档执行重新解析？\n\n` +
        '重解析期间该库检索可能不可用；若刚切换过嵌入模型，解析完成前检索可能报错。\n\n' +
        '已处于解析中的文档将自动跳过。',
    );
    if (!ok) return;
    setReparsingAll(true);
    try {
      const result = await reparseAllDocuments(libraryId, false);
      if (result.failed > 0) {
        const shown = result.failedDocuments.slice(0, 5).map((d) => d.title ?? `#${d.documentId}`);
        const more =
          result.failedDocuments.length > 5 ? ` 等 ${result.failedDocuments.length} 个` : '';
        toast.error(
          `全部重解析完成：成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}（${shown.join('、')}${more}）`,
        );
      } else {
        toast.success(
          `全部重解析完成：成功 ${result.success}` +
            (result.skipped > 0 ? `，跳过（解析中）${result.skipped}` : ''),
        );
      }
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '全部重解析失败');
    } finally {
      setReparsingAll(false);
    }
  }

  /**
   * 仅重试失败文档（KE-05，企业级增强一期）。
   *
   * <p>只对 {@code parse_status=failed} 的文档触发；后端先收敛一次引擎状态再按 failed
   * 过滤，引擎侧实际已成功的 stale-failed 不会重复提交。
   */
  async function onReparseFailed() {
    const failedCount = documents.filter((d) => d.parseStatus === 'failed').length;
    if (failedCount === 0) {
      toast.info('当前没有解析失败的文档');
      return;
    }
    const ok = window.confirm(
      `确定重试 ${failedCount} 个解析失败的文档？\n\n` +
        '仅重试失败文档；已成功/解析中的文档不受影响。',
    );
    if (!ok) return;
    setReparsingFailed(true);
    try {
      const result = await reparseAllDocuments(libraryId, true);
      if (result.failed > 0) {
        const shown = result.failedDocuments.slice(0, 5).map((d) => d.title ?? `#${d.documentId}`);
        const more =
          result.failedDocuments.length > 5 ? ` 等 ${result.failedDocuments.length} 个` : '';
        toast.error(
          `重试完成：成功 ${result.success}，仍失败 ${result.failed}（${shown.join('、')}${more}）`,
        );
      } else {
        toast.success(
          `重试完成：成功 ${result.success}` +
            (result.skipped > 0 ? `，跳过 ${result.skipped}` : ''),
        );
      }
      await load(libraryId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重试失败文档失败');
    } finally {
      setReparsingFailed(false);
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
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" />
              上传文档
            </Button>
          </PermissionGate>
          <PermissionGate permission="kb:document:edit">
            <Button
              size="sm"
              variant="outline"
              disabled={reparsingAll || documents.length === 0}
              onClick={() => void onReparseAll()}
              title="遍历该库全部文档重新解析；换嵌入模型后需全量重解析恢复检索"
            >
              <ListRestart className="h-4 w-4" />
              {reparsingAll ? '提交中…' : '全部重解析'}
            </Button>
          </PermissionGate>
          <PermissionGate permission="kb:document:edit">
            <Button
              size="sm"
              variant="outline"
              disabled={reparsingFailed || !documents.some((d) => d.parseStatus === 'failed')}
              onClick={() => void onReparseFailed()}
              title="仅重试解析失败的文档（先收敛引擎状态再按 failed 过滤）"
            >
              <RotateCw className="h-4 w-4" />
              {reparsingFailed ? '提交中…' : '重试全部失败文档'}
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
          {hasCustom ? <ResetColWidthButton onClick={resetWidths} /> : null}
          <span className="text-xs text-muted-foreground">
            单文件不超过 {formatSize(50 * 1024 * 1024)}
          </span>
        </div>
      )}

      <KbDocumentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        libraryId={libraryId}
        librarySettings={librarySettings}
        onUploaded={() => void load(libraryId)}
      />
      <KbDocChunkDialog
        open={chunkOpen}
        onOpenChange={setChunkOpen}
        libraryId={libraryId}
        doc={chunkDoc}
        librarySettings={librarySettings}
        onUpdated={() => void load(libraryId)}
      />
      <KbDocChunkViewDrawer
        open={viewOpen}
        onOpenChange={setViewOpen}
        libraryId={libraryId}
        doc={viewDoc}
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
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
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
                    <ParseStatusCell doc={doc} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{renderChunkCell(doc)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <EnabledBadge enabled={doc.enabled} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(doc.updatedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center gap-1">
                      <PermissionGate permission="kb:document:list">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openChunkView(doc)}
                          title="查看该文档的切片结果（只读）"
                        >
                          <Eye className="h-3 w-3" />
                          查看切分
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="kb:document:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openChunkDialog(doc)}
                        >
                          <Settings2 className="h-3 w-3" />
                          切片设置
                        </button>
                      </PermissionGate>
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

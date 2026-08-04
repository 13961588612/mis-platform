import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { exportOperationsCsv, listLibraries, listOperationSessions } from '../api/kb-api';
import type { OperationSessionQuery } from '../api/kb-api';
import type { KbLibrary, KbQaSessionListItem } from '../types';
import { formatTime } from '../types';
import { KbQaSessionDetailDialog } from './kb-qa-session-detail-dialog';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';
const fieldLabel = 'mb-[0.3rem] block text-xs font-medium text-muted-foreground';

/** 筛选表单（全部用字符串承载，提交前再归一，避免受控 input 的 number 抖动）。 */
interface FilterForm {
  from: string;
  to: string;
  libraryId: string;
  userId: string;
  hasFeedback: string;
  keyword: string;
}

const EMPTY_FILTER: FilterForm = {
  from: '',
  to: '',
  libraryId: '',
  userId: '',
  hasFeedback: '',
  keyword: '',
};

const PAGE_SIZE = 20;

/** 表单 → 查询条件：空串一律转 null，由 `cleanParams` 统一剔除。 */
function toQuery(f: FilterForm): Omit<OperationSessionQuery, 'page' | 'size'> {
  const libraryId = Number(f.libraryId);
  const userId = Number(f.userId);
  return {
    from: f.from || null,
    to: f.to || null,
    libraryId: Number.isFinite(libraryId) && libraryId > 0 ? libraryId : null,
    userId: Number.isFinite(userId) && userId > 0 ? userId : null,
    hasFeedback: f.hasFeedback === '' ? null : f.hasFeedback === '1',
    keyword: f.keyword.trim() || null,
  };
}

/** 评分展示：null 回落 `-`。 */
function score(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '-' : String(v);
}

/**
 * 问答记录页签（A-02b 列表 + A-02e 导出）。
 *
 * <p>服务端分页 + 服务端过滤：这里**不做前端二次过滤**，
 * 分页语义（total/page/size）完全以 BFF `PageResult` 为准。
 *
 * <p>导出（A-02e）默认对 `userId` 做脱敏（`u_<12位hash>`）。
 * 取消勾选会导出明文用户 ID，属于个人信息外发——按钮旁已给出显式提示，
 * 不要为了「方便」把默认值改成不脱敏。
 */
export function KbQaRecordTab() {
  const [filter, setFilter] = useState<FilterForm>(EMPTY_FILTER);
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [rows, setRows] = useState<KbQaSessionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [desensitize, setDesensitize] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async (p: number, f: FilterForm) => {
    setLoading(true);
    try {
      const res = await listOperationSessions({ ...toQuery(f), page: p, size: PAGE_SIZE });
      setRows(res.list ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载问答记录失败');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void listLibraries()
      .then(setLibraries)
      .catch(() => setLibraries([]));
  }, []);

  useEffect(() => {
    void load(page, filter);
    // filter 变更统一走 onSearch（会把 page 重置为 1），此处只跟随 page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function onSearch() {
    if (page === 1) {
      void load(1, filter);
    } else {
      setPage(1); // 触发上面的 effect
    }
  }

  function onReset() {
    setFilter(EMPTY_FILTER);
    if (page === 1) {
      void load(1, EMPTY_FILTER);
    } else {
      setPage(1);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      await exportOperationsCsv(toQuery(filter), desensitize);
      toast.success('已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  function openDetail(id: number) {
    setDetailId(id);
    setDetailOpen(true);
  }

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div>
            <label className={fieldLabel}>起始日期</label>
            <Input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <label className={fieldLabel}>截止日期</label>
            <Input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div>
            <label className={fieldLabel}>知识库</label>
            <select
              className={selectClass}
              value={filter.libraryId}
              onChange={(e) => setFilter((f) => ({ ...f, libraryId: e.target.value }))}
            >
              <option value="">全部</option>
              {libraries.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel}>提问人 ID</label>
            <Input
              value={filter.userId}
              placeholder="精确匹配"
              onChange={(e) => setFilter((f) => ({ ...f, userId: e.target.value }))}
            />
          </div>
          <div>
            <label className={fieldLabel}>反馈</label>
            <select
              className={selectClass}
              value={filter.hasFeedback}
              onChange={(e) => setFilter((f) => ({ ...f, hasFeedback: e.target.value }))}
            >
              <option value="">全部</option>
              <option value="1">已评价</option>
              <option value="0">未评价</option>
            </select>
          </div>
          <div>
            <label className={fieldLabel}>关键字</label>
            <Input
              value={filter.keyword}
              placeholder="问题 / 回答"
              onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch();
              }}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={loading} onClick={onSearch}>
            <Search className="h-4 w-4" />
            查询
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={onReset}>
            <RefreshCw className="h-4 w-4" />
            重置
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={desensitize}
                onChange={(e) => setDesensitize(e.target.checked)}
              />
              导出脱敏用户 ID
            </label>
            <Button size="sm" variant="outline" disabled={exporting} onClick={() => void onExport()}>
              <Download className="h-4 w-4" />
              导出 CSV
            </Button>
          </div>
        </div>
        {!desensitize ? (
          <p className="mt-2 text-xs text-destructive">
            已关闭脱敏：导出文件将包含明文用户 ID，请确认接收方具备相应数据权限。
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full bg-table-surface text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">会话</th>
              <th className="px-3 py-2 font-bold">提问人</th>
              <th className="px-3 py-2 font-bold">问题</th>
              <th className="px-3 py-2 font-bold">回答摘要</th>
              <th className="px-3 py-2 font-bold">消息</th>
              <th className="px-3 py-2 font-bold">引用</th>
              <th className="px-3 py-2 font-bold">评价</th>
              <th className="px-3 py-2 font-bold">时间</th>
              <th className="px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  暂无问答记录
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.userName ?? (r.userId == null ? '-' : `#${r.userId}`)}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2" title={r.question ?? ''}>
                    {r.question ?? '-'}
                  </td>
                  <td
                    className="max-w-[20rem] truncate px-3 py-2 text-muted-foreground"
                    title={r.answerBrief ?? ''}
                  >
                    {r.answerBrief ?? '-'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.messageCount ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums">{r.citeCount ?? 0}</td>
                  <td className="px-3 py-2">
                    {r.hasFeedback ? (
                      <Badge variant="success">
                        准确 {score(r.accuracy)} / 有用 {score(r.helpful)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">未评价</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                      onClick={() => openDetail(r.id)}
                    >
                      <Eye className="h-3 w-3" />
                      详情
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
        <span>
          共 {total} 条 · 第 {page} / {maxPage} 页
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page >= maxPage}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <KbQaSessionDetailDialog
        sessionId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}

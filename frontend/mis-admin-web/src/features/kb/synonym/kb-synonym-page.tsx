import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader } from '@/components/common/page-header';
import { PermissionGate } from '@/components/auth/permission-gate';
import { usePermission } from '@/hooks/use-permission';
import { KbSynonymDrawer } from './kb-synonym-drawer';
import { KbSynonymImportDialog } from './kb-synonym-import-dialog';
import {
  deleteSynonymGroup,
  exportSynonyms,
  getSynonymConfig,
  listSynonymGroups,
  setSynonymEnabled,
} from '../api/kb-api';
import type { KbSynonymConfig, KbSynonymGroup, KbSynonymTermItem } from '../types';
import {
  KB_SYNONYM_STATUS_OPTIONS,
  formatTime,
  normalizeSynonymTerm,
  synonymStatusLabel,
} from '../types';

/** 本页路由路径（URL 驱动开抽屉时用于校验 keep-alive 下的 pathname）。 */
const PAGE_PATH = '/kb/synonyms';

/** 服务端分页页长（WD-03：任何情况下不一次性拉全表）。 */
const PAGE_SIZE = 20;

/** 词表规模「接近建议上限」的告警水位线（PRD §7 P1：达 80% 提示）。 */
const NEAR_LIMIT_RATIO = 0.8;

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';
const fieldLabel = 'mb-[0.3rem] block text-xs font-medium text-muted-foreground';

/** 列表筛选表单（字符串承载，提交前归一，避免受控 input 的 number 抖动）。 */
interface FilterForm {
  keyword: string;
  status: string;
}

const EMPTY_FILTER: FilterForm = { keyword: '', status: '' };

/**
 * 把关键字在文本中的出现处高亮。
 *
 * <p>服务端搜索同时匹配规范词与别名，命中位置必须让用户一眼看见，
 * 否则在一屏 20 组、每组十几个词条的密度下根本找不到自己搜的是哪个词。
 */
function highlight(text: string, keyword: string): ReactNode {
  const kw = keyword.trim();
  if (!kw) return text;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lower = kw.toLowerCase();
  return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, i) =>
    part.toLowerCase() === lower ? (
      <mark key={i} className="rounded bg-warning/25 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** 取该组的别名（排除规范词自身），按 `sortNo` 保序——顺序即预算截断优先级。 */
function aliasesOf(group: KbSynonymGroup): KbSynonymTermItem[] {
  return (group.terms ?? [])
    .filter((t) => t.canonical !== true)
    .sort((a, b) => (a.sortNo ?? 0) - (b.sortNo ?? 0));
}

/**
 * 同义词全局开关（页头 actions 区）。
 *
 * <p>三个字段语义严格区分，不可混用：
 * - `enabled`：库内业务开关，本页可写；
 * - `killSwitchEnabled`：Nacos 熔断闸，页面**只读**；
 * - `effective`：= 两者与，实际生效状态。
 *
 * <p>熔断闸显式为 `false` 时开关置灰并给出只读说明——管理员点不动时
 * 必须知道「为什么点不动、该找谁」，否则只会变成一张支持工单。
 */
function SynonymGlobalSwitch({
  config,
  busy,
  onToggle,
}: {
  config: KbSynonymConfig | null;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { hasPermission } = usePermission();
  const canWrite = hasPermission('kb:config:synonym:write') === true;
  // 能力位一律 `=== true` 判定：字段缺失（null/undefined）时按「未开启」处理，
  // 绝不 fail-open 地把功能亮出来（Wave A 事故教训）。
  const enabled = config?.enabled === true;
  const effective = config?.effective === true;
  // 置灰只认「运维显式关闭熔断闸」这一种情形；未加载（null）不算。
  const killSwitchOff = config?.killSwitchEnabled === false;
  const disabled = busy || !canWrite || killSwitchOff || config == null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className={disabled ? 'text-muted-foreground' : undefined}>同义词扩展总开关</span>
        </label>
        <Badge variant={effective ? 'success' : 'secondary'}>
          实际生效：{effective ? '是' : '否'}
        </Badge>
      </div>
      {killSwitchOff ? (
        <p className="max-w-[26rem] text-right text-xs text-warning">
          运维已在配置中心关闭熔断闸（<code className="font-mono">mis.kb.synonym.kill-switch</code>
          ），此处为只读；需由运维恢复后方可调整。
        </p>
      ) : !canWrite ? (
        <p className="text-right text-xs text-muted-foreground">
          你没有 <code className="font-mono">kb:config:synonym:write</code> 权限，开关只读。
        </p>
      ) : (
        <p className="text-right text-xs text-muted-foreground">
          实际生效 = 本开关 且 运维熔断闸；任一为关即不生效。
        </p>
      )}
    </div>
  );
}

/**
 * 同义词与术语表管理页（S-07 / Wave D）。
 *
 * <p>服务端分页 + 服务端搜索：词表按 5k～1 万词条验收，
 * 前端一次性拉全表会直接让页面失去响应（WD-03 / AC-06）。
 *
 * <p>命中测试的扩展轨迹卡片通过 `navigate('/kb/synonyms?groupId=42')` 跳到本页，
 * 本页读取 URL 查询参数自行打开抽屉——**两侧不互相 import 组件**，
 * 否则会与 keep-alive 的 `PAGE_MAP` 形成循环引用。
 */
export function KbSynonymPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canView = hasPermission('kb:config:synonym:view') === true;

  const [filter, setFilter] = useState<FilterForm>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterForm>(EMPTY_FILTER);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<KbSynonymGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [config, setConfig] = useState<KbSynonymConfig | null>(null);
  const [toggling, setToggling] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await getSynonymConfig());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '获取同义词配置失败');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSynonymGroups({
        keyword: applied.keyword.trim() || null,
        status: applied.status === '' ? null : Number(applied.status),
        page,
        size: PAGE_SIZE,
      });
      setRows(res.list ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载术语组失败');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * URL 驱动开抽屉：`/kb/synonyms?groupId=42`。
   *
   * <p>keep-alive 下本页可能常驻不卸载，因此必须先校验 `pathname` 再消费参数；
   * 消费后立刻 `replace` 掉查询串，避免关闭抽屉后被后续渲染重新弹开。
   */
  useEffect(() => {
    if (location.pathname !== PAGE_PATH) return;
    const raw = new URLSearchParams(location.search).get('groupId');
    if (!raw) return;
    const id = Number(raw);
    navigate(PAGE_PATH, { replace: true });
    if (!Number.isFinite(id) || id <= 0) return;
    setEditingId(id);
    setDrawerOpen(true);
  }, [location.pathname, location.search, navigate]);

  function onSearch(): void {
    setApplied({ ...filter });
    setPage(1);
  }

  function onReset(): void {
    setFilter(EMPTY_FILTER);
    setApplied({ ...EMPTY_FILTER });
    setPage(1);
  }

  /**
   * 切换全局开关。
   *
   * <p>「开 → 关」必须二次确认：关掉会让全平台问答的召回面立刻收窄，
   * 属于影响所有终端用户的变更，不能一次误点就生效。「关 → 开」直接生效。
   */
  async function onToggleEnabled(next: boolean): Promise<void> {
    if (config?.killSwitchEnabled === false) return;
    if (!next) {
      const ok = window.confirm(
        '关闭后，全平台问答与检索将不再进行同义词扩展，召回结果可能明显变少。\n' +
          '该变更约 3 秒内对所有用户生效。确认关闭？',
      );
      if (!ok) return;
    }
    setToggling(true);
    try {
      setConfig(await setSynonymEnabled(next));
      toast.success(next ? '同义词扩展已开启' : '同义词扩展已关闭');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '切换同义词开关失败');
      void loadConfig();
    } finally {
      setToggling(false);
    }
  }

  /** 硬删：级联删除组内全部词条，且不可恢复，确认文案必须说破。 */
  async function onDelete(group: KbSynonymGroup): Promise<void> {
    const ok = window.confirm(
      `删除术语组「${group.canonicalTerm}」？\n` +
        `组内 ${group.termCount ?? aliasesOf(group).length + 1} 个词条将一并永久删除，` +
        '删除后不可恢复，也不进回收站。确认删除？',
    );
    if (!ok) return;
    try {
      await deleteSynonymGroup(group.id);
      toast.success('已删除');
      await Promise.all([load(), loadConfig()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除术语组失败');
    }
  }

  async function onExport(format: 'CSV' | 'JSON'): Promise<void> {
    setExporting(true);
    try {
      await exportSynonyms(format, {
        keyword: applied.keyword.trim() || null,
        status: applied.status === '' ? null : Number(applied.status),
      });
      toast.success('已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出词表失败');
    } finally {
      setExporting(false);
    }
  }

  function openCreate(): void {
    setEditingId(null);
    setDrawerOpen(true);
  }

  function openEdit(id: number): void {
    setEditingId(id);
    setDrawerOpen(true);
  }

  async function afterSaved(): Promise<void> {
    await Promise.all([load(), loadConfig()]);
  }

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const scale = config?.scale ?? null;
  const groupCount = scale?.groupCount ?? 0;
  const termCount = scale?.termCount ?? 0;
  const recommended = scale?.recommendedTermLimit ?? null;
  const hasLimit = recommended != null && recommended > 0;
  const overLimit = hasLimit && termCount > recommended;
  const nearLimit = hasLimit && !overLimit && termCount >= recommended * NEAR_LIMIT_RATIO;

  if (!canView) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
        <PageHeader title="同义词" description="同义词与术语表维护。" />
        <div className="rounded-lg border bg-table-surface py-10 text-center text-sm text-muted-foreground">
          你没有 <code className="font-mono">kb:config:synonym:view</code> 权限，无法查看词表。
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-5">
      <PageHeader
        title="同义词"
        description="维护检索时用于扩写问句的术语组；一个规范词 + 若干别名，命中任一即按规范词一并召回。"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <SynonymGlobalSwitch
              config={config}
              busy={toggling}
              onToggle={(v) => void onToggleEnabled(v)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => {
                void load();
                void loadConfig();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        }
      />

      {/* 常驻不可关闭：本页与文档的分类标记完全是两回事，进错页会白改一通 */}
      <Alert>
        <AlertTitle>同义词用于「检索时扩写问句」，不是给文档打的分类标记</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          这里维护的术语组只影响检索召回：用户问句里出现别名时，系统会按规范词一并检索，
          不会改变任何文档自身的属性，也不会影响文档的归类与筛选。
          若你要找的是文档标签，请前往
          <Link to="/kb/documents" className="mx-1 text-primary underline">
            「文档」页
          </Link>
          。
        </AlertDescription>
      </Alert>

      {/* 词表规模水位（WD-15：只提示不硬拦，数字全部取自后端 config.scale） */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="text-muted-foreground">词表规模</span>
        <span className="font-medium tabular-nums">
          共 {groupCount} 个术语组 / {termCount} 个词条
        </span>
        {hasLimit ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            建议上限 {recommended} 个词条
          </span>
        ) : null}
        {overLimit ? (
          <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            已超过建议上限（{termCount}/{recommended}）：系统不会硬性拦截，
            但扩展耗时与被预算截断的概率会明显上升，建议清理低频术语组。
          </span>
        ) : nearLimit ? (
          <span className="rounded-md bg-warning/10 px-2 py-0.5 text-xs text-warning">
            已达建议上限的 80%（{termCount}/{recommended}）：接近容量水位，建议开始清理低频术语组。
          </span>
        ) : null}
      </div>

      {/* 筛选 + 操作条 */}
      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={fieldLabel}>关键字</label>
            <Input
              value={filter.keyword}
              placeholder="同时搜规范词与别名，部分匹配、不区分大小写"
              onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch();
              }}
            />
          </div>
          <div>
            <label className={fieldLabel}>状态</label>
            <select
              className={selectClass}
              value={filter.status}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
            >
              {KB_SYNONYM_STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <PermissionGate permission="kb:config:synonym:import">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                导入
              </Button>
            </PermissionGate>
            <PermissionGate permission="kb:config:synonym:import">
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={() => void onExport('CSV')}
              >
                <Download className="h-4 w-4" />
                导出 CSV
              </Button>
            </PermissionGate>
            <PermissionGate permission="kb:config:synonym:import">
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={() => void onExport('JSON')}
              >
                <Download className="h-4 w-4" />
                导出 JSON
              </Button>
            </PermissionGate>
            <PermissionGate permission="kb:config:synonym:write">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新增术语组
              </Button>
            </PermissionGate>
          </div>
        </div>
      </div>

      {/* 列表（服务端分页，绝不前端二次过滤） */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full bg-table-surface text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">规范词</th>
              <th className="px-3 py-2 font-bold">别名（顺序即扩展优先级）</th>
              <th className="px-3 py-2 font-bold">词条数</th>
              <th className="px-3 py-2 font-bold">状态</th>
              <th className="px-3 py-2 font-bold">更新时间</th>
              <th className="px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  {applied.keyword.trim() || applied.status !== ''
                    ? '没有符合条件的术语组'
                    : '暂无术语组，点击右上角「新增术语组」开始维护'}
                </td>
              </tr>
            ) : (
              rows.map((g) => {
                const aliases = aliasesOf(g);
                const matchedKey = g.matchedAlias ? normalizeSynonymTerm(g.matchedAlias) : null;
                return (
                  <tr
                    key={g.id}
                    className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">
                        {highlight(g.canonicalTerm, applied.keyword)}
                      </div>
                      {g.matchedAlias ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          命中别名：
                          <span className="text-foreground">{g.matchedAlias}</span>
                        </div>
                      ) : null}
                      {g.remark ? (
                        <div className="mt-0.5 max-w-[18rem] truncate text-xs text-muted-foreground" title={g.remark}>
                          {g.remark}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {aliases.length === 0 ? (
                        <span className="text-xs text-muted-foreground">（无别名）</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {aliases.map((t, i) => {
                            const hit =
                              matchedKey != null && normalizeSynonymTerm(t.term) === matchedKey;
                            return (
                              <span
                                key={`${g.id}-${t.term}-${i}`}
                                className={
                                  hit
                                    ? 'rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs text-foreground'
                                    : 'rounded-full border border-border bg-card px-2 py-0.5 text-xs'
                                }
                              >
                                {highlight(t.term, applied.keyword)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">{g.termCount ?? '-'}</td>
                    <td className="px-3 py-2 align-top">
                      <Badge variant={g.status === 1 ? 'success' : 'secondary'}>
                        {synonymStatusLabel(g.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {formatTime(g.updatedAt)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-1">
                        <PermissionGate permission="kb:config:synonym:write">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => openEdit(g.id)}
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="kb:config:synonym:write">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                            onClick={() => void onDelete(g)}
                          >
                            <Trash2 className="h-3 w-3" />
                            删除
                          </button>
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                );
              })
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

      <KbSynonymDrawer
        open={drawerOpen}
        groupId={editingId}
        budget={config?.budget ?? null}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void afterSaved()}
        onViewGroup={(id) => {
          setEditingId(id);
          setDrawerOpen(true);
        }}
      />

      <KbSynonymImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void afterSaved()}
      />
    </div>
  );
}

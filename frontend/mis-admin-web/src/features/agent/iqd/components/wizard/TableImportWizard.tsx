/**
 * TableImportWizard.tsx — 表发现导入向导（4 步，MR-02 / system-design §6.1）。
 *
 * <h2>四步</h2>
 * <ol>
 *   <li><b>选 schema</b>：`listSchemas(connectionId)`；</li>
 *   <li><b>表清单</b>：`listTables`（关键字搜索 + 分页 + 全选/反选）；</li>
 *   <li><b>列预览</b>：`listColumns`，**主键推断列高亮**（`is_pk_inferred`）；</li>
 *   <li><b>导入确认</b>：`importTables(mode='create_or_skip')` → 展示「新增 N / 跳过 M」。</li>
 * </ol>
 *
 * <h2>两条硬约束（T02a 实证，写错会静默出问题）</h2>
 * ① **绝不传 `in_scope`**：T02a 已按 PRD §6.3 把服务端默认值回退为 `false`
 * （「导入 ≠ 可问，权限边界不因建模便利而放松」）。是否纳入问数范围由用户在 `/iqd/scope`
 * 自选 —— 本向导导入完成后**只做引导**，不替用户决定（治理边界）。
 * ② **错误分流必须用 50201 / 42200 判定器**：Worker 的这两类错误走**非 200 HTTP**，
 * 若当成普通故障，用户会看到「导入失败」而不是「WrenAI 连接不可用，请检查 profile 注入」。
 *
 * <h2>幂等</h2>
 * `create_or_skip` 语义：已存在的模型在后端被跳过（T02a：同 `model_item_key` 命中即返回首次
 * 结果且不 bump revision），前端把返回的 `imported` / `skipped` 如实呈现。
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  importTables,
  isDiscoveryUnavailable,
  isDiscoveryValidation,
  listColumns,
  listSchemas,
  listTables,
  type ListColumnsParams,
} from '../../api/iqd-discovery';
import type { DiscoveryColumn, DiscoveryTable, ImportTablesResult } from '../../types/modeling';
import { useModelingStore } from '../../store/modeling-store';
import { IQD_SCOPE_PAGE_PATH } from '../../iqd-scope-page';
import { WizardShell, type WizardStep } from './WizardShell';

/** 4 步定义（`import:` 前缀避免与连接向导共用 store 槽位时串台）。 */
const STEPS: WizardStep[] = [
  { key: 'import:schema', title: '选 schema' },
  { key: 'import:tables', title: '选表' },
  { key: 'import:columns', title: '列预览' },
  { key: 'import:confirm', title: '导入' },
];

/** 列预览里每张表最多展示的列数（超长表截断，避免一次渲染上千行）。 */
const COLUMN_PREVIEW_LIMIT = 60;

/** `TableImportWizard` Props。 */
export interface TableImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前连接 id；null → 空态引导去连接向导（A-12）。 */
  connectionId: number | null;
  /** 无连接/未就绪时的引导回调（父组件打开连接向导）。 */
  onOpenConnectionWizard?: () => void;
  /** 导入成功回调（父组件失效 catalog 缓存刷新画布）。 */
  onImported?: (result: ImportTablesResult) => void;
}

/**
 * 表发现导入向导。
 */
export function TableImportWizard({
  open,
  onOpenChange,
  connectionId,
  onOpenConnectionWizard,
  onImported,
}: TableImportWizardProps) {
  const wizardStep = useModelingStore((state) => state.wizardStep);
  const pushWizardStep = useModelingStore((state) => state.pushWizardStep);
  const popWizardStep = useModelingStore((state) => state.popWizardStep);

  const [schema, setSchema] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  /** 已勾选表名（Set 保序无关，导入时按表格顺序输出）。 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 列预览当前查看的表名。 */
  const [previewTable, setPreviewTable] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportTablesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentStep =
    wizardStep && STEPS.some((step) => step.key === wizardStep) ? wizardStep : STEPS[0].key;
  const stepIndex = STEPS.findIndex((step) => step.key === currentStep);
  const ready = connectionId != null;

  // 打开 → 回第一步并清空草稿（向导状态走 store：只重置步骤，草稿是本地态）
  useEffect(() => {
    if (open) {
      pushWizardStep(STEPS[0].key);
      setSchema('');
      setKeyword('');
      setPage(1);
      setSelected(new Set());
      setPreviewTable('');
      setResult(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** schema 列表。 */
  const schemasQuery = useQuery({
    queryKey: ['iqd', 'discovery', 'schemas', connectionId],
    queryFn: () => listSchemas(connectionId as number),
    enabled: open && ready,
    staleTime: 60_000,
  });

  /** 表清单（依赖 schema/page/keyword）。 */
  const tablesQuery = useQuery({
    queryKey: ['iqd', 'discovery', 'tables', connectionId, schema, page, keyword],
    queryFn: () =>
      listTables({ connectionId: connectionId as number, schema, page, keyword: keyword || undefined }),
    enabled: open && ready && schema !== '',
    staleTime: 30_000,
  });

  /** 列预览（只查当前查看的那张表——避免一次拉 N 张表的上千列）。 */
  const columnsQuery = useQuery({
    queryKey: ['iqd', 'discovery', 'columns', connectionId, schema, previewTable],
    queryFn: () =>
      listColumns({
        connectionId: connectionId as number,
        schema,
        table: previewTable,
      } satisfies ListColumnsParams),
    enabled: open && ready && schema !== '' && previewTable !== '',
    staleTime: 60_000,
  });

  const schemas = useMemo(() => schemasQuery.data ?? [], [schemasQuery.data]);
  const tables = useMemo<DiscoveryTable[]>(() => tablesQuery.data?.tables ?? [], [tablesQuery.data]);
  const columns = useMemo<DiscoveryColumn[]>(() => columnsQuery.data ?? [], [columnsQuery.data]);
  const total = tablesQuery.data?.total ?? 0;

  /**
   * 数据来源提醒：直连业务库失败时会**静默回落 wren MCP**（只含已建模表）。
   * 若不提示，用户会以为「库里就这几张表」，从而漏建模 —— 这正是本轮踩过的坑。
   */
  const tableSource = tablesQuery.data?.source;
  const fellBackToMcp = tableSource === 'wren_mcp';

  /** 错误分流：50201 / 42200 各自语义（**不得**笼统成「加载失败」）。 */
  const schemaError = describeError(schemasQuery.error);
  const tablesError = describeError(tablesQuery.error);
  const columnsError = describeError(columnsQuery.error);

  const toggleTable = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const allSelected = tables.length > 0 && tables.every((table) => prev.has(table.name));
      if (allSelected) {
        return new Set();
      }
      const next = new Set(prev);
      for (const table of tables) {
        next.add(table.name);
      }
      return next;
    });
  };

  const doImport = async () => {
    if (connectionId == null || selected.size === 0) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const payload = {
        connection_id: connectionId,
        tables: Array.from(selected).map((name) => ({ schema, name })),
        mode: 'create_or_skip' as const,
        // 注意：**刻意不传 in_scope**（PRD §6.3：导入 ≠ 可问，纳入范围由用户在 /iqd/scope 决定）
      };
      const imported = await importTables(payload);
      setResult(imported);
      onImported?.(imported);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setImporting(false);
    }
  };

  const handleNext = () => {
    if (currentStep === STEPS[3].key) {
      return;
    }
    if (currentStep === STEPS[2].key) {
      pushWizardStep(STEPS[3].key);
      void doImport();
      return;
    }
    const next = STEPS[stepIndex + 1];
    if (next) {
      pushWizardStep(next.key);
    }
  };

  return (
    <WizardShell
      open={open}
      onOpenChange={onOpenChange}
      title="表发现导入"
      description="按连接读取业务库结构（凭证 server-side，前端不触达业务库），勾选后导入为模型。"
      steps={STEPS}
      currentKey={currentStep}
      onBack={() => popWizardStep()}
      onNext={handleNext}
      busy={importing}
      finish={stepIndex === STEPS.length - 1}
      widthClassName="max-w-5xl"
      nextDisabled={
        (currentStep === STEPS[0].key && schema === '') ||
        (currentStep === STEPS[1].key && selected.size === 0)
      }
      nextLabel={currentStep === STEPS[2].key ? '确认导入' : undefined}
    >
      {/* ---------------- 无连接空态（A-12） ---------------- */}
      {!ready && (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <p className="text-[13px] font-medium">尚未选择连接</p>
          <p className="max-w-md text-[12px] text-muted-foreground">
            表发现必须绑定一个连接（schema/表/列都取自该连接的 WrenAI profile）。
            请先创建或选择一个连接。
          </p>
          {onOpenConnectionWizard && (
            <Button size="sm" onClick={onOpenConnectionWizard}>
              去连接向导
            </Button>
          )}
        </div>
      )}

      {/* ---------------- 步骤 1：选 schema ---------------- */}
      {ready && currentStep === 'import:schema' && (
        <div className="space-y-3">
          <ErrorAlert error={schemaError} />
          <div className="space-y-1">
            <Label className="text-[13px]">schema</Label>
            {schemasQuery.isLoading ? (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在读取 schema…
              </p>
            ) : schemas.length === 0 && !schemaError ? (
              <p className="text-[12px] text-muted-foreground">
                该连接下未发现 schema。请确认 DBA 已完成 profile 注入（multiconn §5）。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {schemas.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => {
                      setSchema(item.name);
                      setSelected(new Set());
                      setPage(1);
                    }}
                    className={cn(
                      'rounded border px-2 py-1 text-[13px]',
                      schema === item.name
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-accent/60',
                    )}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 步骤 2：表清单 ---------------- */}
      {ready && currentStep === 'import:tables' && (
        <div className="flex min-h-0 flex-col gap-2">
          <ErrorAlert error={tablesError} />
          {fellBackToMcp && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-[13px]">当前只列出「已建模的表」</AlertTitle>
              <AlertDescription className="text-[12px]">
                直连业务库未生效（连接缺 host / database / user，或数据库不可达），已回落
                MCP 清单 —— <strong>这里不是全库表清单</strong>。请到「连接向导 → 数据源」
                补全业务库参数后再试，否则会漏掉未建模的表。
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder={`在 ${schema} 中搜索表名…`}
                className="pl-7"
              />
            </div>
            <Button size="sm" variant="outline" onClick={toggleAll}>
              {tables.length > 0 && tables.every((table) => selected.has(table.name))
                ? '取消全选'
                : '全选本页'}
            </Button>
            <Badge variant="outline" className="text-[12px]">
              已选 {selected.size}
            </Badge>
          </div>

          {/* 单层滚动：min-h-0 + flex-1 + overflow-auto（项目规范，禁嵌套滚动） */}
          <div className="min-h-0 flex-1 overflow-auto rounded border border-border/60">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border/60 text-left">
                  <th className="w-10 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">表名</th>
                  <th className="border-l border-border/60 px-2 py-1.5 font-medium">注释</th>
                  <th className="border-l border-border/60 px-2 py-1.5 font-medium">预估行数</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((table) => (
                  <tr key={table.name} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selected.has(table.name)}
                        onChange={() => toggleTable(table.name)}
                        aria-label={`选择 ${table.name}`}
                      />
                    </td>
                    <td className="px-2 py-1">{table.name}</td>
                    <td className="border-l border-border/60 px-2 py-1 text-muted-foreground">
                      {table.comment ?? '—'}
                    </td>
                    <td className="border-l border-border/60 px-2 py-1 text-muted-foreground">
                      {table.row_count_estimate ?? '—'}
                    </td>
                  </tr>
                ))}
                {!tablesQuery.isLoading && tables.length === 0 && !tablesError && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                      无匹配的表
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[12px] text-muted-foreground">
            <span>共 {total} 张（本页 {tables.length}）</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </Button>
              <span>第 {page} 页</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={page * 100 >= total}
                onClick={() => setPage((prev) => prev + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 步骤 3：列预览 ---------------- */}
      {ready && currentStep === 'import:columns' && (
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-[13px]">查看表的列：</Label>
            <Select value={previewTable} onValueChange={setPreviewTable}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="选择一张已勾选的表" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(selected).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[12px] text-muted-foreground">
              <span className="font-medium text-primary">PK</span> = 主键推断列（最终以 WrenAI 为准）
            </span>
          </div>
          <ErrorAlert error={columnsError} />
          <div className="min-h-0 flex-1 overflow-auto rounded border border-border/60">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border/60 text-left">
                  <th className="px-2 py-1.5 font-medium">字段</th>
                  <th className="border-l border-border/60 px-2 py-1.5 font-medium">类型</th>
                  <th className="border-l border-border/60 px-2 py-1.5 font-medium">注释</th>
                  <th className="border-l border-border/60 px-2 py-1.5 font-medium">标记</th>
                </tr>
              </thead>
              <tbody>
                {columns.slice(0, COLUMN_PREVIEW_LIMIT).map((column) => (
                  <tr
                    key={column.name}
                    className={cn(
                      'border-b border-border/40',
                      column.is_pk_inferred && 'bg-primary/5',
                    )}
                  >
                    <td className="px-2 py-1 font-medium">{column.name}</td>
                    <td className="border-l border-border/60 px-2 py-1 text-muted-foreground">
                      {column.type}
                    </td>
                    <td className="border-l border-border/60 px-2 py-1 text-muted-foreground">
                      {column.comment ?? '—'}
                    </td>
                    <td className="border-l border-border/60 px-2 py-1">
                      {column.is_pk_inferred && (
                        <Badge className="h-4 px-1 text-[10px]">PK</Badge>
                      )}
                      {!column.nullable && (
                        <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                          NOT NULL
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {!columnsQuery.isLoading && columns.length === 0 && previewTable !== '' && !columnsError && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                      该表无字段或不可读
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {columns.length > COLUMN_PREVIEW_LIMIT && (
            <p className="text-[12px] text-muted-foreground">
              仅展示前 {COLUMN_PREVIEW_LIMIT} 列（共 {columns.length} 列）；导入时按全量落库。
            </p>
          )}
        </div>
      )}

      {/* ---------------- 步骤 4：导入结果 + 治理引导 ---------------- */}
      {ready && currentStep === 'import:confirm' && (
        <div className="space-y-3">
          {importing && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在导入 {selected.size} 张表（新增 / 跳过已存在）…
            </p>
          )}
          <ErrorAlert error={error} />

          {result && (
            <>
              <div className="flex items-center gap-3 rounded border border-border/60 p-3 text-[13px]">
                <span className="text-emerald-600">新增 {result.imported.length} 张</span>
                <span className="text-muted-foreground">跳过 {result.skipped.length} 张</span>
              </div>
              {result.skipped.length > 0 && (
                <details className="text-[12px] text-muted-foreground">
                  <summary className="cursor-pointer">跳过明细（已存在，未重复导入、未改版本）</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {result.skipped.map((key) => (
                      <li key={key}>{key}</li>
                    ))}
                  </ul>
                </details>
              )}

              {/* 治理边界：导入 ≠ 可问，只引导不代决 */}
              <Alert>
                <ArrowRight className="h-4 w-4" />
                <AlertTitle className="text-[13px]">下一步：决定是否纳入问数范围</AlertTitle>
                <AlertDescription className="text-[12px]">
                  导入的表<strong>默认不纳入问数范围</strong>（PRD §6.3「导入 ≠ 可问」）。
                  若要让它们可被问数，请到{' '}
                  <a className="text-primary underline" href={IQD_SCOPE_PAGE_PATH}>
                    {IQD_SCOPE_PAGE_PATH}
                  </a>{' '}
                  勾选 —— 是否开放给问数由你（数据治理）决定，向导不代为开启。
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>
      )}
    </WizardShell>
  );
}

/** 把任意异常翻译成「可行动」的中文提示（50201 / 42200 分流；其余透传）。 */
function describeError(err: unknown): string | null {
  if (!err) {
    return null;
  }
  if (isDiscoveryUnavailable(err)) {
    return 'WrenAI 连接不可用：MCP 未就绪或 profile 未注入。请检查该连接的 profile 绑定与 MCP 进程状态后重试。';
  }
  if (isDiscoveryValidation(err)) {
    return `请求不合法：${err instanceof Error ? err.message : String(err)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** 错误提示块（无错误时不渲染）。 */
function ErrorAlert({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-[13px]">出现错误</AlertTitle>
      <AlertDescription className="text-[12px]">{error}</AlertDescription>
    </Alert>
  );
}

export default TableImportWizard;

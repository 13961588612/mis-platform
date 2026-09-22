/**
 * CubeEditor.tsx — Cube 编辑器（v1.11 MR-06；T03c = M-G2 后半：「建 Cube（含 measure）→ 问数命中聚合」）。
 *
 * <h2>入口与职责</h2>
 * 从**左树**打开（`ModelTree` 的「指标（Cube）」分组 / 「新建 Cube」按钮 → 父页面持有开关状态），
 * **不塞进画布**（画布只管 ER 视图与连线；见 T03b 报告「给 T03c 的接口备注 8」）。
 * 本组件负责：挂靠模型选择、Cube 名称、measures/dimensions 编辑、依赖提示区、保存与错误分流。
 *
 * <h2>⚠️ 本批只支持「新建」；既有 Cube 为**只读查看**（重要，勿误当缺陷）</h2>
 * 后端能力边界（T03a 实测）：
 * <ul>
 *   <li>`POST /catalog/cube` 是 **create-only 且双幂等**：同 `item_key` 已存在时**直接返回首次结果、
 *       不应用新字段** —— 于是「编辑既有 Cube 后保存」会变成**提示成功但没改**的静默缺陷；</li>
 *   <li>`PUT /catalog/node` 只能改**单个节点自身**的 display_name/description/expression，
 *       **无法增删 cube 的 measures/dimensions 子节点**；</li>
 *   <li>`POST /catalog/batch`（saveCatalogBatch）走的是「MDL/物料镜像」语义：**不写
 *       `edit_revision`**，而派生用的 `findEditedItems` 只取 `edit_revision IS NOT NULL`
 *       → 用它写子节点会让 Cube **永远进不了 build**（比不支持编辑更糟）。</li>
 * </ul>
 * 故本批：**新建 = 全功能**（M-G2 主路径）；**既有 Cube = 只读查看**（展示挂靠/度量/维度/子节点键/依赖方），
 * 并给出明确文案与 `TODO(T04)`。更新路径需后端补一个 cube 级 upsert（或让 `createCube` 在
 * 同 `item_key` 时改为 upsert 子节点 + 删除孤儿）。
 *
 * <h2>复用（见 T03b 报告「给 T03c 的接口备注」）</h2>
 * <ul>
 *   <li>{@link useCodeMirror}：度量表达式编辑器；⚠️ `error` 非 null 时**必须** `<Textarea>` 兜底
 *       （见 `MeasureDimensionList` 内的 `MeasureExpressionEditor`）——编辑器挂了不能阻断建 Cube；</li>
 *   <li>{@link useDirtyState}：草稿 + 幂等键；⚠️ **提交成功后必须 `rotateIdempotencyKey()`**
 *       （双幂等复用旧 key 会「看起来成功却没改」）；</li>
 *   <li>{@link describeCubeError} / {@link validateCubeDraft}：错误码分流与提交前预检（纯函数、已单测）；</li>
 *   <li>`model_ref` 是挂靠**真值**，提交传全键 `mdl:model:<name>`。</li>
 * </ul>
 *
 * <h2>草稿 key 的两个细节</h2>
 * <ol>
 *   <li>新建时 `dirtyDrafts` 的 key 用**占位键**（`new-cube:<模型>`）而不是实时跟随名称：
 *       否则用户在名称框每敲一个字符就会在 store 里留下一条 `mdl:cube:rev*` 脏记录；
 *       真实 item_key（`mdl:cube:<name>`）只在提交时用 {@link buildCubeItemKey} 算出来。</li>
 *   <li>表单按 `cube.item_key` / `defaultModelKey` **重挂载**（`key`），局部状态天然重置 ——
 *       不用 effect 手工清状态（同 `RelationshipDialog` 的做法）。</li>
 * </ol>
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import { createCube, errorCode, errorData, listDependencies } from '../../api/iqd-modeling';
import { useDirtyState } from '../../hooks/useDirtyState';
import { useCatalogNodes } from '../../hooks/useCatalogNodes';
import { useSyncStatus } from '../shared/useSyncStatus';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';
import { MeasureDimensionList } from './MeasureDimensionList';
import {
  buildCubeItemKey,
  cubeNameOf,
  describeCubeError,
  dimensionItemKey,
  emptyMeasureRow,
  inferModelRef,
  keyTail,
  measureItemKey,
  parseCubeChildren,
  toDimensionRows,
  toMeasureRows,
  toDimensions,
  toMeasures,
  validateCubeDraft,
  type CubeDraftValues,
} from './cubeUtils';

/** 一个可选挂靠模型（含字段清单，供补全 / 维度下拉）。 */
interface ModelOption {
  itemKey: string;
  displayName: string;
  /** 限定名字段（`orders.amount`）。 */
  fieldOptions: string[];
}

/** `CubeEditor` Props。 */
export interface CubeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前连接 id（数字，见 `ModelTree` 模块头的「🔴 关键」）。 */
  connectionId: number | null;
  /** 要查看的既有 Cube（null = 新建）。 */
  cube: IqdCatalogItem | null;
  /** 新建时的默认挂靠模型 item_key（用户在树里选中模型后点「新建 Cube」）。 */
  defaultModelKey?: string | null;
  /** 保存成功回调（父页面可据此关闭/提示；缓存失效由本组件负责）。 */
  onSaved?: () => void;
}

/** Cube 编辑器（壳：按目标重挂载表单）。 */
export function CubeEditor(props: CubeEditorProps) {
  const { open, onOpenChange, cube, defaultModelKey } = props;
  /** 表单身份键：换 Cube / 换默认模型即重挂载 → 局部状态重置。 */
  const formKey = `${cube?.item_key ?? 'new'}:${defaultModelKey ?? '-'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 p-0">
        {open && <CubeForm key={formKey} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

/** 表单主体。 */
function CubeForm({
  connectionId,
  cube,
  defaultModelKey,
  onOpenChange,
  onSaved,
}: CubeEditorProps) {
  const queryClient = useQueryClient();
  const { catalog, nodes, isLoading } = useCatalogNodes(connectionId);
  const sync = useSyncStatus(connectionId);
  const clearDirty = useModelingStore((state) => state.clearDirty);

  /** 只读 = 既有 Cube（后端无更新路径，见模块头）。
   *
   *  TODO(T04)：后端补「cube 级 upsert（含子节点增删 + 孤儿清理）」后，把这里改成
   *  `readOnly = false` 并复用同一草稿/幂等/错误分流链路即可（表单本身已支持编辑，
   * 只是当前不该发写请求）。 */
  const readOnly = cube != null;

  /** 挂靠模型选项（字段取画布派生节点里的 `columns`，那是**全量**字段，非卡片上渲染的前 8 列）。 */
  const modelOptions = useMemo<ModelOption[]>(
    () =>
      nodes
        .filter((node) => node.data.kind === 'model')
        .map((node) => {
          const displayName = node.data.displayName;
          const fieldOptions = (node.data.columns ?? [])
            .map((column) => {
              const field = column.display_name ?? keyTail(column.item_key);
              return field === '' ? '' : `${displayName}.${field}`;
            })
            .filter((field) => field !== '');
          return { itemKey: node.data.itemKey, displayName, fieldOptions };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [nodes],
  );

  /** 初值（既有 Cube 走「子节点回读」；新建走默认值 + 一个空度量行）。 */
  const initial = useMemo<CubeDraftValues>(() => {
    if (cube) {
      const { measures, dimensions } = parseCubeChildren(catalog, cube.item_key);
      return {
        displayName: cube.display_name ?? cubeNameOf(cube.item_key),
        modelRef: inferModelRef(cube, modelOptions.map((option) => option.itemKey)),
        measures: toMeasureRows(measures),
        dimensions: toDimensionRows(dimensions),
      };
    }
    return {
      displayName: '',
      modelRef: (defaultModelKey ?? '').trim(),
      measures: [emptyMeasureRow()],
      dimensions: [],
    };
  }, [cube, catalog, defaultModelKey, modelOptions]);

  /**
   * 草稿的 `itemKey`：新建用**占位键**（不随名称输入漂移，见模块头细节 1）。
   * 既有 Cube 直接用它的真实键（只读，不提交）。
   */
  const draftItemKey = cube?.item_key ?? `new-cube:${defaultModelKey ?? 'none'}`;
  const baseRevision = sync.status?.current_edit_revision ?? null;

  const draft = useDirtyState<CubeDraftValues>({
    connectionId,
    itemKey: draftItemKey,
    kind: 'cube',
    baseValues: initial,
    baseRevision: baseRevision ?? 0,
    action: 'create',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 当前所选模型的字段（补全 + 维度下拉 + 预检数据源）。 */
  const fieldOptions = useMemo(
    () => modelOptions.find((option) => option.itemKey === draft.draft.modelRef)?.fieldOptions ?? [],
    [modelOptions, draft.draft.modelRef],
  );

  /** 提交前本地预检（权威仍在后端）。 */
  const validationErrors = useMemo(
    () => (readOnly ? [] : validateCubeDraft(draft.draft, fieldOptions)),
    [readOnly, draft.draft, fieldOptions],
  );

  /** 依赖提示区：谁引用此 Cube（仅既有 Cube 有意义）。 */
  const dependenciesQuery = useQuery({
    queryKey: iqdKeys.dependencies(connectionId, cube?.item_key ?? ''),
    queryFn: () => listDependencies(connectionId as number, cube?.item_key as string),
    enabled: connectionId != null && cube != null,
    staleTime: 15_000,
    retry: false,
  });

  const dependents = dependenciesQuery.data?.dependents ?? [];
  const cubeName = cubeNameOf(cube?.item_key) || draft.draft.displayName;

  const canSubmit =
    !readOnly &&
    !saving &&
    connectionId != null &&
    validationErrors.length === 0 &&
    draft.draft.displayName.trim() !== '';

  const submit = useCallback(async () => {
    if (!canSubmit || connectionId == null) {
      return;
    }
    setSaving(true);
    setError(null);
    const itemKey = buildCubeItemKey(draft.draft.displayName);
    try {
      await createCube({
        connection_id: connectionId,
        item_key: itemKey,
        kind: 'cube',
        patch: {
          display_name: draft.draft.displayName.trim(),
          // ★ 挂靠真值：传**全键**（后端也会归一，但全键最不容易出歧义）
          model_ref: draft.draft.modelRef,
          measures: toMeasures(draft.draft.measures),
          dimensions: toDimensions(draft.draft.dimensions),
        },
        // base_revision 省略 = 服务端不校验（拿不到当前版本时不要填 0，那会必然 40900）
        ...(baseRevision != null ? { base_revision: baseRevision } : {}),
        idempotency_key: draft.idempotencyKey,
      });
      // ★ 双幂等：成功后必须换新 key，否则下次提交会命中旧 key 返回首次结果（看起来成功却没改）
      draft.rotateIdempotencyKey();
      draft.resetDraft();
      clearDirty(draftItemKey);
      // 单源刷新：树 / 画布角标 / 右栏同时跟随
      await queryClient.invalidateQueries({ queryKey: iqdKeys.catalogs(connectionId) });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(
        describeCubeError(
          errorCode(err),
          errorData(err),
          err instanceof Error ? err.message : String(err),
        ),
      );
      // 失败（尤其 40901 幂等键重复）也换新 key，让「重试」真的能落到服务端
      draft.rotateIdempotencyKey();
    } finally {
      setSaving(false);
    }
  }, [
    canSubmit,
    connectionId,
    draft,
    baseRevision,
    clearDirty,
    draftItemKey,
    queryClient,
    onSaved,
    onOpenChange,
  ]);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open) {
        clearDirty(draftItemKey);
      }
      onOpenChange(open);
    },
    [clearDirty, draftItemKey, onOpenChange],
  );

  // 既有 Cube 但 catalog 还没到（冷缓存）→ 不渲染表单（否则初值会「空着」且不再更新）
  if (readOnly && isLoading && catalog.length === 0) {
    return (
      <>
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-[14px]">Cube 详情</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载 Cube 详情…
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader className="border-b border-border/60 px-4 py-3">
        <DialogTitle className="text-[14px]">
          {readOnly ? 'Cube 详情' : '新建 Cube'}：{draft.draft.displayName || cubeName || '未命名'}
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          Cube 是问数的聚合出口：挂在一个模型上，度量决定「算什么」，维度决定「按什么分组」。
          落库后由整连接 build 派生进 MDL，问数即可命中聚合通道。
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
        {readOnly && (
          <div className="flex items-start gap-2 rounded border border-amber-500/50 bg-amber-50/80 px-2 py-1.5 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              当前为只读查看：后端 <code>POST /catalog/cube</code> 是「只新建、同键幂等返回首次结果」的语义，
              <code>PUT /catalog/node</code> 也无法增删 measure/dimension 子节点 —— 直接改会变成「提示成功却没改」。
              修改既有 Cube 需后端补 cube 级更新端点（已记入 T04 待办）。
            </span>
          </div>
        )}

        {/* ---------------- 基本信息 ---------------- */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[13px]">Cube 名称</Label>
            <Input
              value={draft.draft.displayName}
              readOnly={readOnly}
              onChange={(event) => draft.patchDraft({ displayName: event.target.value })}
              placeholder="如 销售额"
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">
              挂靠模型（model_ref）
              <span className="ml-1 text-[11px] text-muted-foreground">Cube 的语义基座</span>
            </Label>
            <Select
              value={draft.draft.modelRef === '' ? undefined : draft.draft.modelRef}
              disabled={readOnly || modelOptions.length === 0}
              onValueChange={(value) => draft.patchDraft({ modelRef: value })}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue
                  placeholder={modelOptions.length === 0 ? '该连接暂无模型' : '选择挂靠模型…'}
                />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.itemKey} value={option.itemKey} className="text-[13px]">
                    {option.displayName}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      （{option.fieldOptions.length} 字段）
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 稳定键（透明化：与后端日志/依赖引用对齐） */}
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span className="shrink-0">稳定键</span>
          <code className="rounded border border-border/60 bg-muted/40 px-1 py-0.5">
            {readOnly ? cube?.item_key : buildCubeItemKey(draft.draft.displayName)}
          </code>
          {!readOnly && draft.isDirty && (
            <span className="shrink-0 rounded border border-amber-500/50 bg-amber-50 px-1 py-0.5 text-amber-900">
              未保存
            </span>
          )}
        </div>

        {/* ---------------- measures / dimensions ---------------- */}
        <MeasureDimensionList
          measures={draft.draft.measures}
          dimensions={draft.draft.dimensions}
          fieldOptions={fieldOptions}
          readOnly={readOnly}
          onMeasuresChange={(next) => draft.patchDraft({ measures: next })}
          onDimensionsChange={(next) => draft.patchDraft({ dimensions: next })}
        />

        {/* ---------------- 子节点键预览（落库形态透明化） ---------------- */}
        <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <p className="text-[12px] font-medium">将写入的 catalog 节点</p>
          <ul className="mt-0.5 space-y-0.5">
            <li className="text-[12px]">
              <code className="rounded bg-background px-1">{readOnly ? cube?.item_key : buildCubeItemKey(draft.draft.displayName)}</code>
              <span className="ml-1 text-muted-foreground">（kind=cube，挂 model_ref）</span>
            </li>
            {draft.draft.measures.map((row) => (
              <li key={row.rowId} className="text-[12px]">
                <code className="rounded bg-background px-1">{measureItemKey(cubeName, row.name)}</code>
                <span className="ml-1 text-muted-foreground">（kind=measure）</span>
              </li>
            ))}
            {draft.draft.dimensions.map((row) => (
              <li key={row.rowId} className="text-[12px]">
                <code className="rounded bg-background px-1">
                  {dimensionItemKey(cubeName, row.name)}
                </code>
                <span className="ml-1 text-muted-foreground">（kind=dimension）</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---------------- 依赖提示区 ---------------- */}
        <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <p className="text-[12px] font-medium">
            依赖方（谁引用此 Cube）
            {dependenciesQuery.isSuccess && (
              <span className="ml-1 text-[11px] text-muted-foreground">共 {dependenciesQuery.data?.total ?? 0} 项</span>
            )}
          </p>
          {!readOnly ? (
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
              <Info className="h-3 w-3" />
              新建前无引用方；保存后可在此查看（如 sql 样本对、知识条目引用了它的度量）。
            </p>
          ) : dependenciesQuery.isLoading ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground">查询中…</p>
          ) : dependenciesQuery.isError ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              依赖方查询失败（不影响其它操作）。
            </p>
          ) : dependents.length === 0 ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              暂无引用方。删除/改名不会受阻断。
            </p>
          ) : (
            <ul className="mt-0.5 space-y-0.5">
              {dependents.map((dependent) => (
                <li key={dependent.item_key} className="text-[12px]">
                  <code className="rounded bg-background px-1">{dependent.item_key}</code>
                  <span className="ml-1 text-muted-foreground">（{dependent.kind}）</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------------- 预检 / 错误 ---------------- */}
        {validationErrors.length > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[12px] text-destructive">
            <p className="font-medium">提交前还需修正：</p>
            <ul className="mt-0.5 list-disc pl-4">
              {validationErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[12px] text-destructive">
            {error}
          </div>
        )}
      </div>

      <DialogFooter className="border-t border-border/60 px-4 py-3">
        <Button size="sm" variant="outline" onClick={() => handleClose(false)} disabled={saving}>
          {readOnly ? '关闭' : '取消'}
        </Button>
        {!readOnly && (
          <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            保存 Cube
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export default CubeEditor;

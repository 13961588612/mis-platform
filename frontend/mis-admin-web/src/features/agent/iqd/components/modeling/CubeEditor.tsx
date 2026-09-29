/**
 * CubeEditor.tsx — Cube 编辑器（v1.11 MR-06；T03c = M-G2 后半：「建 Cube（含 measure）→ 问数命中聚合」）。
 *
 * <h2>入口与职责</h2>
 * 从**左树**打开（`ModelTree` 的「指标（Cube）」分组 / 「新建 Cube」按钮 → 父页面持有开关状态），
 * **不塞进画布**（画布只管 ER 视图与连线；见 T03b 报告「给 T03c 的接口备注 8」）。
 * 本组件负责：挂靠模型选择、Cube 名称、measures/dimensions 编辑、依赖提示区、保存与错误分流。
 *
 * <h2>新建 = POST / 既有 = PUT（T04b 已放开既有 Cube 编辑）</h2>
 * 后端能力边界（T03a 实测 + T04a 补齐）：
 * <ul>
 *   <li>`POST /catalog/cube` 是 **create-only 且双幂等**：同 `item_key` 已存在时**直接返回首次结果、
 *       不应用新字段** —— 故**新建**走它；</li>
 *   <li>`PUT /catalog/cube`（**T04a 新增**，{@link upsertCube}）语义明确的「更新既有 Cube」
 *       （自身字段 + measures/dimensions 子节点增删改 + 孤儿清理）—— 故**既有 Cube 编辑**走它。</li>
 *   <li>`PUT /catalog/node` 只能改**单个节点自身**的 display_name/description/expression，
 *       **无法增删 cube 的 measures/dimensions 子节点**；</li>
 *   <li>`POST /catalog/batch`（saveCatalogBatch）走的是「MDL/物料镜像」语义：**不写
 *       `edit_revision`**，而派生用的 `findEditedItems` 只取 `edit_revision IS NOT NULL`
 *       → 用它写子节点会让 Cube **永远进不了 build**（比不支持编辑更糟）。</li>
 * </ul>
 * 故本批：**新建 = POST**（M-G2 主路径）；**既有 Cube = PUT**（T04b 兑现 T04a 的成果）。
 * ⚠️ `PUT` 是**全量替换**语义 → 提交 patch 由 {@link buildCubePatch} 统一构造，
 * **永远带完整的 measures/dimensions 列表**（漏传会误清空既有子节点，见 `cubeUtils` 函数头）。
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
import { AlertTriangle, Info, Loader2, Trash2 } from 'lucide-react';
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
import {
  createCube,
  deleteCube,
  errorCode,
  errorData,
  listDependencies,
  upsertCube,
} from '../../api/iqd-modeling';
import { useDirtyState } from '../../hooks/useDirtyState';
import { useCatalogNodes } from '../../hooks/useCatalogNodes';
import { useSyncStatus } from '../shared/useSyncStatus';
import { IQD_MODELING_PERMISSIONS, useIqdModelingPermission } from '../shared/usePermission';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';
import { MeasureDimensionList } from './MeasureDimensionList';
import {
  buildCubeItemKey,
  buildCubePatch,
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
  /** 保存权限（T04b）：`POST/PUT /catalog/cube` 均绑 `iqd:modeling:edit`（V87:92618 / V90:92700）。 */
  const { hasPermission } = useIqdModelingPermission();
  const canEdit = hasPermission(IQD_MODELING_PERMISSIONS.edit);

  /**
   * 是否为「编辑既有 Cube」。
   *
   * <p>T04b：`PUT /catalog/cube` 由 T04a 补齐后，既有 Cube **可编辑**（保存走 {@link upsertCube}）。
   * 保留此布尔只用于**文案/提交分支**（新建走 POST，既有走 PUT），**不再表示只读**。
   */
  const isExisting = cube != null;

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
    // 自动预选：新建时优先用左树选中的模型（defaultModelKey）；
    // 未选中但该连接只有一个模型时直接选中它（避免每次手动选）；否则留空由用户选。
    const fallback =
      (defaultModelKey ?? '').trim() ||
      (modelOptions.length === 1 ? modelOptions[0].itemKey : '');
    return {
      displayName: '',
      modelRef: fallback,
      measures: [emptyMeasureRow()],
      dimensions: [],
    };
  }, [cube, catalog, defaultModelKey, modelOptions]);

  /**
   * 草稿的 `itemKey`：新建用**占位键**（不随名称输入漂移，见模块头细节 1）；
   * 既有 Cube 用它的**真实键**（`mdl:cube:<name>`）。
   *
   * <p>⚠️ 既有 Cube 的更新 `item_key` **必须**用它的真实键 —— 改名（改 `display_name`）时
   * 不能重算 `buildCubeItemKey`（那会指向另一个不存在的 cube → 服务端 42200「cube 不存在」）。
   */
  const draftItemKey = cube?.item_key ?? `new-cube:${defaultModelKey ?? 'none'}`;
  const baseRevision = sync.status?.current_edit_revision ?? null;

  const draft = useDirtyState<CubeDraftValues>({
    connectionId,
    itemKey: draftItemKey,
    kind: 'cube',
    baseValues: initial,
    baseRevision: baseRevision ?? 0,
    // 既有 = update（幂等键 `{conn}:cube:update:{uuid}`），新建 = create
    action: isExisting ? 'update' : 'create',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 当前所选模型的字段（补全 + 维度下拉 + 预检数据源）。 */
  const fieldOptions = useMemo(
    () => modelOptions.find((option) => option.itemKey === draft.draft.modelRef)?.fieldOptions ?? [],
    [modelOptions, draft.draft.modelRef],
  );

  /** 提交前本地预检（权威仍在后端；新建/更新同口径）。 */
  const validationErrors = useMemo(
    () => validateCubeDraft(draft.draft, fieldOptions),
    [draft.draft, fieldOptions],
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

  /** 删除二次确认 + 状态（T03c 删除路径：物理删 + 孤儿清理）。 */
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ item_key: string; kind: string }>>(
    [],
  );

  /** 删除 Cube（仅既有 Cube 且 canEdit）；成功后失效 catalog 缓存 + onSaved 关闭。 */
  const doDelete = useCallback(async () => {
    if (!cube || connectionId == null) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCube(
        connectionId,
        cube.item_key,
        baseRevision ?? undefined,
        `cube-del-${cube.item_key}-${Date.now()}`,
      );
      clearDirty(draftItemKey);
      setConfirmDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: iqdKeys.catalogs(connectionId) });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      const code = errorCode(err);
      const data = errorData(err);
      const deps = (data?.dependents ?? null) as Array<{ item_key: string; kind: string }> | null;
      if (code === 42200 && Array.isArray(deps) && deps.length > 0) {
        setDeleteBlockers(deps);
        setDeleteError('该 Cube 被引用，禁止删除。');
      } else {
        setDeleteBlockers([]);
        setDeleteError(err instanceof Error ? err.message : '删除 Cube 失败');
      }
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }, [baseRevision, clearDirty, connectionId, cube, draftItemKey, onSaved, onOpenChange, queryClient]);

  const canSubmit =
    canEdit &&
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
    // 既有 Cube 用真实键（改名不换键）；新建按名称算键。
    const itemKey = isExisting && cube ? cube.item_key : buildCubeItemKey(draft.draft.displayName);
    // ★ PUT 全量替换：patch 由 buildCubePatch 统一构造，**永远**带完整 measures/dimensions（防误清空）
    const patch = buildCubePatch(draft.draft);
    const body = {
      connection_id: connectionId,
      item_key: itemKey,
      kind: 'cube' as const,
      patch,
      // base_revision 省略 = 服务端不校验（拿不到当前版本时不要填 0，那会必然 40900）
      ...(baseRevision != null ? { base_revision: baseRevision } : {}),
      idempotency_key: draft.idempotencyKey,
    };
    try {
      if (isExisting) {
        // 既有 Cube → PUT /catalog/cube（T04a：自身字段 + 子节点增删改 + 孤儿清理）
        await upsertCube(body);
      } else {
        await createCube(body);
      }
      // 双幂等：成功后必须换新 key，否则下次提交会命中旧 key 返回首次结果（看起来成功却没改）
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
    isExisting,
    cube,
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
  if (isExisting && isLoading && catalog.length === 0) {
    return (
      <>
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-[14px]">编辑 Cube</DialogTitle>
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
          {isExisting ? '编辑 Cube' : '新建 Cube'}：{draft.draft.displayName || cubeName || '未命名'}
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          Cube 是问数的聚合出口：挂在一个模型上，度量决定「算什么」，维度决定「按什么分组」。
          落库后由整连接 build 派生进 MDL，问数即可命中聚合通道。
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
        {isExisting && (
          <div className="flex items-start gap-2 rounded border border-sky-500/50 bg-sky-50/80 px-2 py-1.5 text-[12px] text-sky-900">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              更新走 <code>PUT /catalog/cube</code>（T04a 新增）：<strong>全量替换</strong>语义 ——
              本次表单里的 measures/dimensions 即为目标集合，<strong>移除的行会被删除</strong>
              （孤儿清理）。提交时前端始终带完整列表，避免误清空。
            </span>
          </div>
        )}
        {!canEdit && (
          <div className="flex items-start gap-2 rounded border border-amber-500/50 bg-amber-50/80 px-2 py-1.5 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>无 {IQD_MODELING_PERMISSIONS.edit} 权限，本弹窗只读查看。</span>
          </div>
        )}

        {/* ---------------- 基本信息 ---------------- */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[13px]">Cube 名称</Label>
            <Input
              value={draft.draft.displayName}
              readOnly={!canEdit}
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
              disabled={!canEdit || modelOptions.length === 0}
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
            {isExisting ? cube?.item_key : buildCubeItemKey(draft.draft.displayName)}
          </code>
          {isExisting && (
            <span className="shrink-0 text-[11px]">（更新时按键定位，改名不换键）</span>
          )}
          {canEdit && draft.isDirty && (
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
          readOnly={!canEdit}
          onMeasuresChange={(next) => draft.patchDraft({ measures: next })}
          onDimensionsChange={(next) => draft.patchDraft({ dimensions: next })}
        />

        {/* ---------------- 子节点键预览（落库形态透明化） ---------------- */}
        <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <p className="text-[12px] font-medium">将写入的 catalog 节点</p>
          <ul className="mt-0.5 space-y-0.5">
            <li className="text-[12px]">
              <code className="rounded bg-background px-1">{isExisting ? cube?.item_key : buildCubeItemKey(draft.draft.displayName)}</code>
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
          {!isExisting ? (
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

        {/* 删除失败 / 被引用阻断（T03c） */}
        {deleteError && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[12px] text-destructive">
            <p>{deleteError}</p>
            {deleteBlockers.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {deleteBlockers.map((d) => (
                  <li key={d.item_key}>
                    <code className="rounded bg-background px-1">{d.item_key}</code>
                    <span className="ml-1 text-muted-foreground">（{d.kind}）</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
        {isExisting && canEdit ? (
          <Button
            size="sm"
            variant="destructive"
            className="mr-auto"
            onClick={() => {
              setDeleteError(null);
              setDeleteBlockers([]);
              setConfirmDeleteOpen(true);
            }}
            disabled={saving || deleting}
          >
            {deleting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            删除 Cube
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => handleClose(false)} disabled={saving}>
          取消
        </Button>
        {canEdit && (
          <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isExisting ? '保存 Cube' : '新建 Cube'}
          </Button>
        )}
      </DialogFooter>

      {/* 二次确认（与关系删除同范式：destructive 按钮） */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除该 Cube？</DialogTitle>
            <DialogDescription>
              将从 catalog 物理删除{' '}
              <code className="rounded bg-muted px-1">{cube?.item_key}</code>
              及其全部 measures/dimensions 子节点，并重新派生并发布 MDL。
              此操作不可撤销；问数将不再命中该聚合。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={() => void doDelete()} disabled={deleting}>
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CubeEditor;

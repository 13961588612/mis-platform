/**
 * PropertyPanel.tsx — 右栏属性面板（v1.11 MR-S4 T02b-3；**T04b 起字段可直编**）。
 *
 * <h2>🔴 只读展示部分不再发请求（Q5 单源）</h2>
 * 节点/字段的**展示数据**全部来自 {@link useCatalogNodes} 已返回的 `catalog` + store 的
 * `selectedItemKey`：同一份缓存，左树/画布/右栏三处一致。**不要**在此再 `useQuery` 一次清单
 * （会多一次请求，且与画布不同步）。
 *
 * <h2>本批（T04b / T04b-补）新增编辑能力</h2>
 * <ol>
 *   <li><b>字段业务描述直编（MR-09）</b>：写 `iqd_catalog_item.description`，走
 *       `PUT /iqd/catalog/node`（乐观并发 `base_revision` + 幂等 `idempotency_key`）——
 *       与 catalog 页同源同闭环（同一端点/同一缓存，改完 catalog 页同步可见）。</li>
 *   <li><b>字段脱敏直编（MR-13）</b>：写 `iqd_catalog_item.sensitive_level` / `mask_rule`，
 *       **同样**走 `PUT /iqd/catalog/node`（T04b-补 已把该端点 patch 扩展到接受这两个字段，
 *       bump `edit_revision`）——命中 masking.py §7.5 规则链的**优先级 1/2**；
 *       下拉保留五类内置 + custom（与增强页 `RULE_LABEL` 一致），权限 `catalog:edit ∧ mask:save`。</li>
 *   <li><b>依赖方提示区</b>：`GET /iqd/dependencies`（T03 已落地），删除/改名前先看谁在引用。</li>
 * </ol>
 *
 * <h2>字段怎么「选中」</h2>
 * 左树没有字段分组，故：选中一个 **model / table** 后，下方字段表**点行**即把 `selectedItemKey`
 * 切到该字段（`store.setSelected(field.item_key)`）→ 面板切到「字段编辑」态。字段编辑区按
 * `key` 重挂载（换字段 / 服务端描述变更即重置局部态，见 {@link FieldEditor} 的 key）。
 *
 * <h2>⚠️ 提交成功后必须 `rotateIdempotencyKey()`</h2>
 * 后端是**双幂等**（幂等键命中 → 返回首次结果；同 `item_key` 已存在 → 也返回首次结果）。
 * 复用旧 key 做第二次「修改」会拿到首次结果而**看起来保存成功却没改**。
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  updateIqdCatalogNode,
  type IqdCatalogItem,
} from '@/lib/api/iqd';
// 依赖方清单在**建模台 wire 层**（非 catalog 页 wire 层）：`GET /iqd/dependencies`。
import { listDependencies } from '../../api/iqd-modeling';
import { useCatalogNodes } from '../../hooks/useCatalogNodes';
import { useDirtyState } from '../../hooks/useDirtyState';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';
import { useIqdModelingPermission } from '../shared/usePermission';
import { useSyncStatus } from '../shared/useSyncStatus';
import {
  MASK_SAVE_PERMISSION,
  NODE_EDIT_PERMISSION,
  SENSITIVE_LEVEL_OPTIONS,
  buildMaskNodeEditPayload,
  buildMaskRuleOptions,
  buildNodeEditPayload,
  describeMaskSaveError,
  describeNodeEditError,
  fieldNameOf,
  initialMaskRule,
  maskRuleLabel,
  type FieldDraftValues,
} from './propertyEditUtils';

/** `PropertyPanel` Props。 */
export interface PropertyPanelProps {
  /** **数字**连接 id（与画布/左树同一 cache key）。 */
  connectionId: number | null;
}

/** kind → 中文名（只列可能出现在画布/树上的四类）。 */
const KIND_LABEL: Record<string, string> = {
  model: '模型',
  table: '物理表',
  cube: '指标（Cube）',
  relationship: '关系',
  column: '字段',
};

/** 敏感等级 → 中文标签（未知值原样）。 */
function sensitiveLabel(level: string | undefined): string {
  return SENSITIVE_LEVEL_OPTIONS.find((option) => option.value === (level ?? 'none'))?.label ?? '无';
}

/** 字段徽标（与画布节点卡同口径）。 */
function columnBadges(column: IqdCatalogItem): string[] {
  const badges: string[] = [];
  if (column.is_primary_key) {
    badges.push('PK');
  }
  if (column.expression) {
    badges.push('计算列');
  }
  if ((column.sensitive_level ?? 'none') !== 'none' || column.mask_rule) {
    badges.push('脱敏');
  }
  return badges;
}

/** 从任意异常里取业务 `code` / `data`（`updateIqdCatalogNode` 把它们挂在 Error 上）。 */
function readError(err: unknown): { code: number | null; data: Record<string, unknown> | null } {
  const shape = err as { code?: unknown; data?: unknown };
  const code = typeof shape?.code === 'number' ? shape.code : null;
  const data =
    shape?.data !== null && typeof shape?.data === 'object'
      ? (shape.data as Record<string, unknown>)
      : null;
  return { code, data };
}

/** 右栏属性面板。 */
export function PropertyPanel({ connectionId }: PropertyPanelProps) {
  const { catalog } = useCatalogNodes(connectionId);
  const selectedItemKey = useModelingStore((state) => state.selectedItemKey);
  const setSelected = useModelingStore((state) => state.setSelected);

  /** 选中项。 */
  const selected = useMemo(
    () => catalog.find((item) => item.item_key === selectedItemKey) ?? null,
    [catalog, selectedItemKey],
  );

  /** 选中项的字段（model/table 才有：按其物理表 key 收集列 + 计算列）。 */
  const fields = useMemo(() => {
    if (!selected || (selected.kind !== 'model' && selected.kind !== 'table')) {
      return [] as IqdCatalogItem[];
    }
    const tableName = (selected.display_name ?? selected.item_key).toLowerCase();
    const tableKey =
      selected.kind === 'table'
        ? selected.item_key
        : catalog.find(
            (item) => item.kind === 'table' && item.item_key.toLowerCase().endsWith(`.${tableName}`),
          )?.item_key ?? null;
    return catalog.filter(
      (item) =>
        item.kind === 'column' &&
        ((tableKey != null && item.parent_key === tableKey) || item.parent_key === selected.item_key),
    );
  }, [catalog, selected]);

  if (!selected) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-2 text-[12px] text-muted-foreground">
        未选中任何节点。在左侧树或画布中点一个模型 / 表 / 指标查看详情。
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* 基础信息 */}
      <div className="space-y-2 border-b border-border/60 p-2">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {selected.display_name ?? selected.item_key}
          </span>
          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
            {KIND_LABEL[selected.kind] ?? selected.kind}
          </Badge>
          {selected.source === 'modeling' && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
              建模台
            </Badge>
          )}
        </div>
        <dl className="space-y-1 text-[12px]">
          <Row label="item_key" value={selected.item_key} mono />
          <Row
            label="纳入问数范围"
            value={selected.in_scope ? '是' : '否（可在 /iqd/scope 勾选）'}
          />
          <Row label="来源" value={selected.source ?? '—'} />
          {/* 字段（column）的描述由下方「字段编辑」区承载，此处不重复只读行 */}
          {selected.kind !== 'column' && selected.description && (
            <Row label="描述" value={selected.description} />
          )}
          {selected.expression && <Row label="表达式" value={selected.expression} mono />}
        </dl>
      </div>

      {/* 字段列表（model / table）：点行进入字段编辑 */}
      {(selected.kind === 'model' || selected.kind === 'table') && (
        <div className="border-b border-border/60 p-2">
          <p className="mb-1 text-[13px] font-medium">字段（{fields.length}）</p>
          <p className="mb-1 text-[11px] text-muted-foreground">
            点字段行可在下方直接编辑业务描述与脱敏标记。
          </p>
          <div className="rounded border border-border/60">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-2 py-1 font-medium">字段</th>
                  <th className="border-l border-border/60 px-2 py-1 font-medium">类型</th>
                  <th className="border-l border-border/60 px-2 py-1 font-medium">标记</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr
                    key={field.item_key}
                    onClick={() => setSelected(field.item_key)}
                    className="cursor-pointer border-t border-border/40 hover:bg-accent/50"
                    title="点击编辑该字段的描述 / 脱敏"
                  >
                    <td className="px-2 py-1">{field.display_name ?? field.item_key}</td>
                    <td className="border-l border-border/60 px-2 py-1 text-muted-foreground">
                      {field.data_type ?? '—'}
                    </td>
                    <td className="border-l border-border/60 px-2 py-1">
                      {columnBadges(field).map((badge) => (
                        <Badge
                          key={badge}
                          variant={badge === 'PK' ? 'default' : 'outline'}
                          className="mr-1 h-4 px-1 text-[10px]"
                        >
                          {badge}
                        </Badge>
                      ))}
                    </td>
                  </tr>
                ))}
                {fields.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                      无字段
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 字段编辑（选中字段时；按 item_key 重挂载，换字段即重置局部态） */}
      {selected.kind === 'column' && (
        <FieldEditor key={selected.item_key} connectionId={connectionId} field={selected} />
      )}

      {/* 指标/关系的补充说明 */}
      {selected.kind === 'cube' && (
        <div className="border-t border-border/60 p-2 text-[12px] text-muted-foreground">
          指标的 measures / dimensions 编辑在左树双击 Cube 打开编辑器（T03c/T04b）。
        </div>
      )}
      {selected.kind === 'relationship' && (
        <div className="border-t border-border/60 p-2 text-[12px] text-muted-foreground">
          关系编辑（join 类型 / 基数 / 条件）在画布上选边打开。
        </div>
      )}
    </div>
  );
}

/** 键值行（item_key 等长串用等宽字体便于核对）。 */
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? 'min-w-0 break-all font-mono text-[11px]' : 'min-w-0 break-words'}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 字段编辑器（MR-09 描述直编 + MR-13 脱敏直编 + 依赖方提示）。
 *
 * <p>拆成独立组件并用 `key` 重挂载的理由：`useDirtyState` 的草稿是**局部 state**（初值只取一次），
 * 换字段若不重挂载就会把上一个字段的草稿带过来 —— 同 `CubeEditor` / `RelationshipDialog` 的做法。
 */
function FieldEditor({
  connectionId,
  field,
}: {
  connectionId: number | null;
  field: IqdCatalogItem;
}) {
  const queryClient = useQueryClient();
  const sync = useSyncStatus(connectionId);
  const { hasPermission } = useIqdModelingPermission();
  const clearDirty = useModelingStore((state) => state.clearDirty);
  const canEditDescription = hasPermission(NODE_EDIT_PERMISSION);
  /**
   * 脱敏保存闸门 = `catalog:edit ∧ mask:save`（双码）。
   *
   * <p>写入端点 `PUT /catalog/node` 的后端真码是 `catalog:edit`（保证与后端一致，不出现
   * 「前端放行、后端 40300」）；额外叠加 `mask:save` 是 PRD MR-13 的显式要求
   * （「无 `iqd:mask:save` 权限时只读」）——脱敏是敏感操作，前端严格度 ≥ 后端是安全的。
   */
  const canSaveMask = hasPermission(NODE_EDIT_PERMISSION) && hasPermission(MASK_SAVE_PERMISSION);

  const draft = useDirtyState<FieldDraftValues>({
    connectionId,
    itemKey: field.item_key,
    kind: field.kind,
    baseValues: { description: field.description ?? '' },
    baseRevision: sync.status?.current_edit_revision ?? 0,
    action: 'update',
  });

  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [descriptionSaved, setDescriptionSaved] = useState(false);

  /**
   * 「未保存」判定的两个信号取与（`useDirtyState` 的**值比较** + store 的**触碰标记**）：
   * <ul>
   *   <li>只用 `draft.isDirty`（值比较）→ 保存成功后、catalog 失效回填前的往返窗口里，
   *       草稿已收敛到新值而基线仍是旧值 → 会**误报「未保存」**（与「已保存」同屏，自相矛盾）；</li>
   *   <li>只用 store 标记（触碰过）→ 「改了又改回原值」会**误报未保存**。</li>
   * </ul>
   * 二者取与即同时规避这两种误报（保存后 `clearDirty` 立刻把标记清掉）。
   */
  const touched = useModelingStore((state) => state.dirtyDrafts.has(field.item_key));
  const descriptionDirty = touched && draft.isDirty;

  const columnName = fieldNameOf(field);
  /** 脱敏表单本地态：初值取服务端当前值（FieldEditor 按 item_key 重挂载 → 换字段即重置）。 */
  const [sensitiveLevel, setSensitiveLevel] = useState<string>(() =>
    (field.sensitive_level ?? 'none').trim() || 'none',
  );
  const [maskRule, setMaskRule] = useState<string>(() => initialMaskRule(field.mask_rule));
  const [savingMask, setSavingMask] = useState(false);
  const [maskError, setMaskError] = useState<string | null>(null);
  const [maskSaved, setMaskSaved] = useState<string | null>(null);
  /** 下拉项：清除 + 五类内置 + custom；当前值为未知历史值时补一个「现有」动态项。 */
  const maskRuleOptions = useMemo(
    () => buildMaskRuleOptions(field.mask_rule ?? ''),
    [field.mask_rule],
  );

  /** 保存业务描述（MR-09）：严格走 PUT /iqd/catalog/node（乐观并发 + 幂等）。 */
  const saveDescription = useCallback(async () => {
    if (connectionId == null || !canEditDescription) {
      return;
    }
    setSavingDescription(true);
    setDescriptionError(null);
    setDescriptionSaved(false);
    const baseRevision = sync.status?.current_edit_revision ?? 0;
    const sentText = draft.draft.description.trim();
    try {
      await updateIqdCatalogNode(
        connectionId,
        buildNodeEditPayload(field, draft.draft.description, baseRevision, draft.idempotencyKey),
      );
      // ★ 双幂等：成功后必须换新 key，否则下次提交会命中旧 key 返回首次结果（看起来成功却没改）
      draft.rotateIdempotencyKey();
      // 收敛到「已保存值」（而不是 resetDraft 回退到改前值 —— 那会让编辑内容视觉上「弹回去」）
      draft.setDraft({ description: sentText });
      clearDirty(field.item_key);
      setDescriptionSaved(true);
      // Q5 单源：失效 catalog 缓存 → 画布/左树/catalog 页同时刷新
      await queryClient.invalidateQueries({ queryKey: iqdKeys.catalogs(connectionId) });
      sync.refresh();
    } catch (err) {
      const { code, data } = readError(err);
      setDescriptionError(
        describeNodeEditError(
          code,
          data,
          err instanceof Error ? err.message : String(err),
        ),
      );
      // 失败（尤其 40901 幂等键重复 / 40900 版本变更）也换新 key + 刷新版本，让「重试」真的能落地
      draft.rotateIdempotencyKey();
      sync.refresh();
    } finally {
      setSavingDescription(false);
    }
  }, [connectionId, canEditDescription, field, draft, sync, clearDirty, queryClient]);

  /**
   * 保存脱敏直编（MR-13）：走 `PUT /iqd/catalog/node`（T04b-补：patch 带
   * `sensitive_level` + `mask_rule`），与描述同端点、同乐观并发 + 幂等。
   */
  const saveMask = useCallback(async () => {
    if (connectionId == null || !canSaveMask) {
      return;
    }
    setSavingMask(true);
    setMaskError(null);
    setMaskSaved(null);
    const baseRevision = sync.status?.current_edit_revision ?? 0;
    try {
      await updateIqdCatalogNode(
        connectionId,
        buildMaskNodeEditPayload(
          field,
          sensitiveLevel,
          maskRule,
          baseRevision,
          draft.idempotencyKey,
        ),
      );
      // ★ 双幂等：成功后必须换新 key（脱敏与描述两次提交共用草稿幂等键，不换会拿到首次结果）
      draft.rotateIdempotencyKey();
      setMaskSaved(
        `已保存脱敏：等级=${sensitiveLevel}，字段级规则=${maskRuleLabel(maskRule)}（已 bump 编辑版本，将随整库 build 生效）。`,
      );
      // Q5 单源：失效 catalog 缓存 → 画布/左树/catalog 页同步看到新脱敏标记
      await queryClient.invalidateQueries({ queryKey: iqdKeys.catalogs(connectionId) });
      sync.refresh();
    } catch (err) {
      const { code, data } = readError(err);
      setMaskError(
        describeMaskSaveError(code, data, err instanceof Error ? err.message : String(err)),
      );
      // 失败也换新 key + 刷新版本（40901 / 40900 后可安全重试）
      draft.rotateIdempotencyKey();
      sync.refresh();
    } finally {
      setSavingMask(false);
    }
  }, [
    connectionId,
    canSaveMask,
    field,
    sensitiveLevel,
    maskRule,
    draft,
    sync,
    queryClient,
  ]);

  /** 依赖方（谁引用此字段）；仅作提示，不阻断（阻断在后端 42200）。 */
  const dependentsQuery = useQuery({
    queryKey: iqdKeys.dependencies(connectionId, field.item_key),
    queryFn: () => listDependencies(connectionId as number, field.item_key),
    enabled: connectionId != null,
    staleTime: 15_000,
    retry: false,
  });
  const dependents = dependentsQuery.data?.dependents ?? [];

  return (
    <div className="space-y-3 p-2">
      {/* ---------------- MR-09：业务描述直编 ---------------- */}
      <div className="space-y-1.5">
        <Label className="text-[13px]">业务描述（description）</Label>
        <Textarea
          value={draft.draft.description}
          readOnly={!canEditDescription}
          onChange={(event) => draft.patchDraft({ description: event.target.value })}
          placeholder="给这个字段写一句业务含义（如「订单金额，含税」）"
          rows={3}
          className="text-[12px]"
        />
        {!canEditDescription && (
          <p className="text-[11px] text-muted-foreground">
            无 {NODE_EDIT_PERMISSION} 权限，描述只读。
          </p>
        )}
        {descriptionError && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[12px] text-destructive">
            {descriptionError}
            <Button
              size="sm"
              variant="outline"
              className="ml-2 h-6"
              onClick={() => sync.refresh()}
            >
              <RotateCcw className="h-3 w-3" />
              重读版本
            </Button>
          </div>
        )}
        {descriptionSaved && !descriptionError && (
          <p className="text-[11px] text-success">已保存（catalog 页同步可见）。</p>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7"
            disabled={!canEditDescription || savingDescription || !descriptionDirty}
            onClick={() => void saveDescription()}
          >
            {savingDescription ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            保存描述
          </Button>
          {descriptionDirty && <span className="text-[11px] text-warning">未保存</span>}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            v{sync.status?.current_edit_revision ?? 0}
          </span>
        </div>
      </div>

      {/* ---------------- MR-13：字段脱敏直编 ---------------- */}
      <div className="space-y-1.5 border-t border-border/60 pt-2">
        <Label className="flex items-center gap-1 text-[13px]">
          <ShieldCheck className="h-3.5 w-3.5" />
          字段脱敏
        </Label>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            当前敏感等级：<span className="text-foreground">{sensitiveLabel(field.sensitive_level)}</span>
          </span>
          <span>
            当前脱敏规则：<span className="font-mono text-foreground">{field.mask_rule || '—'}</span>
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          写字段级 <code>sensitive_level</code> / <code>mask_rule</code>（masking.py 规则链**优先级 1/2**），
          与增强页脱敏 Tab 的下拉口径一致（五类内置 + custom）。字段名：{columnName}。
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[12px] text-muted-foreground">敏感等级</Label>
            <Select
              value={sensitiveLevel}
              disabled={!canSaveMask}
              onValueChange={(value) => setSensitiveLevel(value)}
            >
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENSITIVE_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[12px]">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[12px] text-muted-foreground">字段级脱敏规则</Label>
            <Select
              value={maskRule}
              disabled={!canSaveMask}
              onValueChange={(value) => setMaskRule(value)}
            >
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {maskRuleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[12px]">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          提示：等级=高 即按 data_type / 列名自动脱敏；字段级规则为**显式指定**（优先级更高）。
          「无 / 清除字段级规则」= 写 <code>null</code>（撤回字段级显式规则）。
        </p>
        {!canSaveMask && (
          <p className="text-[11px] text-muted-foreground">
            需同时具备 {NODE_EDIT_PERMISSION} 与 {MASK_SAVE_PERMISSION} 权限，否则脱敏只读。
          </p>
        )}
        {maskError && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[12px] text-destructive">
            {maskError}
            <Button
              size="sm"
              variant="outline"
              className="ml-2 h-6"
              onClick={() => sync.refresh()}
            >
              <RotateCcw className="h-3 w-3" />
              重读版本
            </Button>
          </div>
        )}
        {maskSaved && !maskError && <p className="text-[11px] text-success">{maskSaved}</p>}
        <Button
          size="sm"
          variant="secondary"
          className="h-7"
          disabled={!canSaveMask || savingMask}
          onClick={() => void saveMask()}
        >
          {savingMask ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
          )}
          保存脱敏
        </Button>
      </div>

      {/* ---------------- 依赖方提示区 ---------------- */}
      <div className="space-y-1 rounded border border-border/60 bg-muted/20 px-2 py-1.5">
        <p className="text-[12px] font-medium">
          依赖方（谁引用此字段）
          {dependentsQuery.isSuccess && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              共 {dependentsQuery.data?.total ?? 0} 项
            </span>
          )}
        </p>
        {dependentsQuery.isLoading ? (
          <p className="text-[12px] text-muted-foreground">查询中…</p>
        ) : dependentsQuery.isError ? (
          <p className="text-[12px] text-muted-foreground">依赖方查询失败（不影响其它操作）。</p>
        ) : dependents.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">暂无引用方。</p>
        ) : (
          <ul className="space-y-0.5">
            {dependents.map((dependent) => (
              <li key={dependent.item_key} className="text-[12px]">
                <code className="rounded bg-background px-1">{dependent.item_key}</code>
                <span className="ml-1 text-muted-foreground">（{dependent.kind}）</span>
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3" />
          被引用不阻断「改描述 / 改脱敏」；仅**改名**会触发后端引用校验（42200）。
        </p>
      </div>
    </div>
  );
}

export default PropertyPanel;

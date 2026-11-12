/**
 * RelationshipDialog.tsx — 关系编辑/查看弹窗（v1.11 MR-05；M-G2 主路径）。
 *
 * <h2>两种模式</h2>
 * <ul>
 *   <li><b>create</b>：画布连线的落点。预填两端模型，默认 `INNER` + `1:N`（建模最高频形态），
 *       保存走 `POST /api/v1/iqd/catalog/relationship`（**单数路径**，T03a 已实现）；</li>
 *   <li><b>view</b>：点击既有关系边。只读回显 join 语义与条件
 *       —— **刻意不做成可编辑**：T03a 的 create 端点**双幂等**（同 `item_key` 已存在 →
 *       返回首次结果且**不应用新字段**），若这里允许「改完保存」，会出现
 *       「提示保存成功、实际没改」的静默缺陷。修改既有关系应走 `PUT /catalog/node`（T03c）。</li>
 * </ul>
 *
 * <h2>错误处理（T03a 报告「给 T03b 的接口备注 5」，**必须读 `data`**）</h2>
 * mis-iqd 的业务冲突是 **HTTP 200 + `body.code` + `body.data`**，BFF 原样透传。只读
 * `message` 会把「哪个字段不存在」丢掉，用户只能盲猜。本弹窗逐码分流：
 * <table border="1">
 *   <caption>错误码 → 呈现</caption>
 *   <tr><th>code</th><th>data</th><th>呈现</th></tr>
 *   <tr><td>42200</td><td>`unknown_fields[]` / `field` / `model_item_key`</td>
 *       <td>「条件里引用了不存在的字段：a、b」+ 指出是哪个模型没找到</td></tr>
 *   <tr><td>42201</td><td>`errors[]`</td><td>逐条列出</td></tr>
 *   <tr><td>40900</td><td>`current_edit_revision`</td><td>提示版本已变更、需刷新重试</td></tr>
 *   <tr><td>40300</td><td>—</td><td>该连接未开启 MDL 写回（治理闸门）</td></tr>
 *   <tr><td>40901</td><td>`idempotency_key`</td><td>并发重复提交，提示重试（会自动换新 key）</td></tr>
 * </table>
 *
 * <h2>幂等（§8.4 / T03a 备注 6）</h2>
 * 每次提交用 `{connId}:relationship:create:{uuid}`（{@link buildIdempotencyKey}），
 * 保存成功后 `rotateIdempotencyKey()` —— 否则再次提交会命中旧 key 直接返回首次结果，
 * 表现为「改了但没保存上」。
 *
 * <h2>引用预览的两级语义（**不要越权**）</h2>
 * 本地 `analyzeCondition` 只做**提示**（可能引用不到的字段用橙色列出），**不阻断保存**：
 * 字段存在性的**权威判定在后端**（它掌握模型真实字段全量，前端只有画布上已加载的部分）。
 * 前端若「自以为知道」而拦截保存，会把正确的条件挡在门外。
 */
import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import {
  createRelationship,
  deleteRelationship,
  errorCode,
  errorData,
} from '../../api/iqd-modeling';
import type { Cardinality, JoinType } from '../../types/modeling';
import { useDirtyState } from '../../hooks/useDirtyState';
import { useCodeMirror } from '../../hooks/useCodeMirror';
import { parseRelationship } from '../../hooks/useCatalogNodes';
import { useModelingStore } from '../../store/modeling-store';
import {
  analyzeCondition,
  buildRelationshipName,
  normalizeCardinalityValue,
  normalizeJoinTypeValue,
} from './relationUtils';

/** 关系一端（模型节点）的信息。 */
export interface RelationEndpoint {
  /** 模型稳定键（`mdl:model:orders`）。 */
  itemKey: string;
  /** 展示名（`orders`）。 */
  displayName: string;
  /** 字段名清单（补全 / 引用预览用）。 */
  fields: string[];
}

/** 草稿形状（**用 type 而非 interface**：便于作为 `Record<string, unknown>` 约束的实参）。 */
type RelationshipDraft = {
  joinType: JoinType;
  cardinality: Cardinality;
  condition: string;
};

/** join 类型选项。 */
const JOIN_TYPES: Array<{ value: JoinType; label: string }> = [
  { value: 'inner', label: 'INNER · 内连接（只保留匹配行）' },
  { value: 'left', label: 'LEFT · 左表全保留' },
  { value: 'right', label: 'RIGHT · 右表全保留' },
  { value: 'full', label: 'FULL · 两侧全保留' },
];

/** 基数选项（顺序 = 常用度）。 */
const CARDINALITIES: Array<{ value: Cardinality; label: string }> = [
  { value: '1:N', label: '1:N · 一对多（最常用）' },
  { value: 'N:1', label: 'N:1 · 多对一' },
  { value: '1:1', label: '1:1 · 一对一' },
  { value: 'N:N', label: 'N:N · 多对多（慎用）' },
];

/** `RelationshipDialog` Props。 */
export interface RelationshipDialogProps {
  open: boolean;
  /** create = 连线新建；view = 点击既有边查看（只读）。 */
  mode: 'create' | 'view';
  onOpenChange: (open: boolean) => void;
  connectionId: number | null;
  /** 源端（连线起点 / 边 source）。 */
  source: RelationEndpoint | null;
  /** 目标端（连线终点 / 边 target）。 */
  target: RelationEndpoint | null;
  /** view 模式下的既有关系条目。 */
  existing: IqdCatalogItem | null;
  /** 连接当前编辑版本（乐观并发基线）；null → 不传（服务端不校验）。 */
  baseRevision: number | null;
  /** 保存成功回调（父组件失效 catalog 缓存刷新画布）。 */
  onSaved?: () => void;
  /**
   * 删除成功回调（与 {@link onSaved} 同口径：父组件失效 catalog 缓存）。
   * T03c 删除路径（2026-09-29）新增。
   */
  onDeleted?: () => void;
  /** 是否可写（`iqd:modeling:edit`）；false 时删除按钮不出现。 */
  canEdit?: boolean;
}

/** 关系弹窗（壳：连接变化即重挂载表单，避免用 effect 手工重置）。 */
export function RelationshipDialog(props: RelationshipDialogProps) {
  const { open, onOpenChange, source, target, existing, mode } = props;
  /** 表单身份键：端点/模式一变就重挂载 → 局部状态天然重置（不用 effect 清状态）。 */
  const formKey = `${mode}:${source?.itemKey ?? '-'}:${target?.itemKey ?? '-'}:${existing?.item_key ?? '-'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && (
          <RelationshipForm key={formKey} {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 表单（与弹窗壳分离，便于按 `key` 重挂载）。 */
function RelationshipForm({
  mode,
  connectionId,
  source,
  target,
  existing,
  baseRevision,
  onOpenChange,
  onSaved,
  onDeleted,
  canEdit = false,
}: RelationshipDialogProps) {
  const clearDirty = useModelingStore((state) => state.clearDirty);
  const readOnly = mode === 'view';

  /** 初值：create = 默认 INNER/1:N 空条件；view = 从既有关系的信封（或裸条件）回读。 */
  const initial = useMemo<RelationshipDraft>(() => {
    if (existing) {
      const parsed = parseRelationship(existing);
      return {
        joinType: normalizeJoinTypeValue(parsed.joinType),
        cardinality: normalizeCardinalityValue(parsed.cardinality),
        condition: parsed.condition ?? '',
      };
    }
    return { joinType: 'inner', cardinality: '1:N', condition: '' };
  }, [existing]);

  const relationshipName = buildRelationshipName(source?.displayName, target?.displayName);
  const itemKey = existing?.item_key ?? `mdl:relationship:${relationshipName}`;

  const dirty = useDirtyState<RelationshipDraft>({
    connectionId,
    itemKey,
    kind: 'relationship',
    baseValues: initial,
    baseRevision: baseRevision ?? 0,
    action: 'create',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldOptions = useMemo(() => {
    const list: string[] = [];
    for (const endpoint of [source, target]) {
      if (!endpoint) {
        continue;
      }
      for (const field of endpoint.fields) {
        list.push(`${endpoint.displayName}.${field}`);
      }
    }
    return list;
  }, [source, target]);

  const analysis = useMemo(
    () => analyzeCondition(dirty.draft.condition, source, target),
    [dirty.draft.condition, source, target],
  );

  /** 删除二次确认 + 进行中 / 失败状态（T03c 删除路径）。 */
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** 被删除前检出的直接引用方（非空则禁止删除；与后端 42200 同口径）。 */
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ item_key: string; kind: string }>>(
    [],
  );

  /**
   * 删除关系（物理删除 + bump）。
   *
   * <p>仅 view 模式（点已有边）且有 `iqd:modeling:edit` 时可用。
   * 成功后走 {@link RelationshipDialogProps.onDeleted} 失效 catalog 缓存（画布重派生后边自然消失）。
   */
  const doDelete = useCallback(async () => {
    if (connectionId == null || !existing) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRelationship(
        connectionId,
        existing.item_key,
        baseRevision ?? undefined,
        `rel-del-${existing.item_key}-${Date.now()}`,
      );
      clearDirty(itemKey);
      setConfirmDeleteOpen(false);
      onDeleted?.();
    } catch (err) {
      const code = errorCode(err);
      const data = errorData(err);
      // 42200 且带 dependents → 被引用阻断，列出引用方（与改名阻断同样式）
      const deps = (data?.dependents ?? null) as Array<{ item_key: string; kind: string }> | null;
      if (code === 42200 && Array.isArray(deps) && deps.length > 0) {
        setDeleteBlockers(deps);
        setDeleteError('该关系被引用，禁止删除。');
      } else {
        setDeleteBlockers([]);
        setDeleteError(
          err instanceof Error ? err.message : '删除关系失败',
        );
      }
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }, [baseRevision, clearDirty, connectionId, existing, itemKey, onDeleted]);

  const canSubmit =
    !readOnly &&
    !saving &&
    connectionId != null &&
    Boolean(source && target) &&
    dirty.draft.condition.trim() !== '';

  const submit = useCallback(async () => {
    if (!canSubmit || connectionId == null || !source || !target) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createRelationship({
        connection_id: connectionId,
        item_key: itemKey,
        kind: 'relationship',
        patch: {
          join_type: dirty.draft.joinType,
          cardinality: dirty.draft.cardinality,
          condition: dirty.draft.condition.trim(),
          source_model: source.itemKey,
          target_model: target.itemKey,
        },
        // T03a：base_revision 为 null 时服务端**不校验**；有值（同步状态已加载）则启用乐观并发
        ...(baseRevision != null ? { base_revision: baseRevision } : {}),
        idempotency_key: dirty.idempotencyKey,
      });
      // 成功后轮换幂等键 + 清脏标记（否则二次提交会命中旧 key 直接返回首次结果）
      dirty.rotateIdempotencyKey();
      dirty.resetDraft();
      clearDirty(itemKey);
      onSaved?.();
    } catch (err) {
      setError(describeRelationshipError(err));
      // 40901（并发重复提交）/ 其它失败都换新 key，让用户重试能真正落到服务端
      dirty.rotateIdempotencyKey();
    } finally {
      setSaving(false);
    }
  }, [canSubmit, connectionId, source, target, itemKey, dirty, baseRevision, onSaved, clearDirty]);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open) {
        clearDirty(itemKey);
      }
      onOpenChange(open);
    },
    [clearDirty, itemKey, onOpenChange],
  );

  if (!source || !target) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="text-[14px]">关系</DialogTitle>
          <DialogDescription className="text-[12px]">
            端点信息缺失，无法编辑关系。请重新在画布上连线，或点击一条已存在的关系边。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => handleClose(false)}>
            关闭
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[14px]">
          {readOnly ? '查看关系' : '新建关系'}：{source.displayName} → {target.displayName}
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          关系落 `iqd_catalog_item`（`kind=relationship`），发布后由整连接 build 派生进 MDL。
          {readOnly
            ? 'join 类型 / 基数 / 条件为只读回显（修改走 catalog 节点编辑）；本弹窗可删除该关系。'
            : '保存后画布会出现关系边；同一连接可多次建不同关系。'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-1">
        {/* 稳定键（透明化：用户能看到将落库的 key，便于与后端日志/审计对照） */}
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="shrink-0">稳定键</span>
          <code className="truncate rounded border border-border/60 bg-muted/40 px-1 py-0.5">
            {itemKey}
          </code>
          {dirty.isDirty && !readOnly && (
            <span className="shrink-0 rounded border border-amber-500/50 bg-amber-50 px-1 py-0.5 text-amber-900">
              未保存
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[13px]">join 类型</Label>
            <Select
              value={dirty.draft.joinType}
              onValueChange={(value) => dirty.patchDraft({ joinType: value as JoinType })}
              disabled={readOnly}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOIN_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[13px]">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">cardinality</Label>
            <Select
              value={dirty.draft.cardinality}
              onValueChange={(value) => dirty.patchDraft({ cardinality: value as Cardinality })}
              disabled={readOnly}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARDINALITIES.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[13px]">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[13px]">join 条件</Label>

          {readOnly ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-[13px]">
              {dirty.draft.condition || '（无条件）'}
            </pre>
          ) : (
            <ConditionEditor
              value={dirty.draft.condition}
              onChange={(next) => dirty.patchDraft({ condition: next })}
              fields={fieldOptions}
              defaultTable={source?.displayName ?? null}
              placeholder={`如 ${source?.displayName ?? 'orders'}.customer_id = ${target?.displayName ?? 'customers'}.id`}
            />
          )}
        </div>

        {/* 引用预览：本地提示（**不阻断保存**；权威判定在后端 42200） */}
        <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <p className="text-[12px] font-medium">引用预览</p>
          {analysis.pairs.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              尚未识别出 `a = b` 形式的等值条件（复合条件请用 AND 连接）。
            </p>
          ) : (
            <ul className="mt-0.5 space-y-0.5">
              {analysis.pairs.map((pair) => (
                <li key={`${pair.left}=${pair.right}`} className="text-[12px]">
                  <code className="rounded bg-background px-1">{pair.left}</code>
                  <span className="mx-1 text-muted-foreground">=</span>
                  <code className="rounded bg-background px-1">{pair.right}</code>
                </li>
              ))}
            </ul>
          )}
          {analysis.unknownTokens.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              可能不存在：{analysis.unknownTokens.join('、')}
              （仅本地提示；字段是否合法以服务端校验为准）
            </p>
          )}
        </div>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[12px] text-destructive">
            {error}
          </div>
        )}

        {/* 删除失败 / 被引用阻断（T03c）：与改名阻断同样式列出引用方 */}
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
      </div>

      <DialogFooter>
        {readOnly && existing && canEdit ? (
          <Button
            size="sm"
            variant="destructive"
            className="mr-auto"
            onClick={() => {
              setDeleteError(null);
              setDeleteBlockers([]);
              setConfirmDeleteOpen(true);
            }}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            删除关系
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => handleClose(false)} disabled={saving}>
          {readOnly ? '关闭' : '取消'}
        </Button>
        {!readOnly && (
          <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            保存关系
          </Button>
        )}
      </DialogFooter>

      {/* 二次确认（与 SelfHealPanel 强制重建同范式：destructive 按钮） */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除该关系？</DialogTitle>
            <DialogDescription>
              将从 catalog 物理删除{' '}
              <code className="rounded bg-muted px-1">{existing?.item_key}</code>，
              并重新派生并发布 MDL。此操作不可撤销；
              两表之间的 join 关系将从问数上下文中消失。
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

/**
 * join 条件编辑器（**只在 create 模式挂载**）。
 *
 * <p>单独抽成组件有两个原因：
 * <ol>
 *   <li>view 模式不挂载 → 不会为了「看一眼」去动态 import CodeMirror（省一次 chunk 请求）；</li>
 *   <li>降级路径集中在一处：编辑器不可用（依赖缺失 / 容器未挂载）时退回 `<Textarea>`，
 *       **绝不让编辑器故障阻断「建关系」这条 M-G2 主路径**。</li>
 * </ol>
 */
function ConditionEditor({
  value,
  onChange,
  fields,
  defaultTable,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  fields: string[];
  defaultTable: string | null;
  placeholder: string;
}) {
  const editor = useCodeMirror({
    value,
    onChange,
    fields,
    defaultTable,
    placeholder,
    height: 140,
  });

  if (editor.error) {
    return (
      <div className="space-y-1">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[90px] text-[13px]"
          placeholder={placeholder}
        />
        <p className="text-[11px] text-muted-foreground">
          代码编辑器不可用（{editor.error}），已降级为纯文本输入。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* 字段补全（本批以**显式插入**交付：光标处插入 `表.字段`；编辑器内补全见 useCodeMirror 文件头 TODO） */}
      <div className="flex items-center justify-end">
        <Select value="" onValueChange={(field) => editor.insert(`${field} `)}>
          <SelectTrigger className="h-7 w-44 text-[12px]">
            <SelectValue placeholder="插入字段…" />
          </SelectTrigger>
          <SelectContent>
            {fields.length === 0 ? (
              <SelectItem value="__none" disabled className="text-[12px]">
                两端均无字段
              </SelectItem>
            ) : (
              fields.map((field) => (
                <SelectItem key={field} value={field} className="text-[12px]">
                  {field}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div
        ref={editor.containerRef}
        className="overflow-hidden rounded border border-border/60 bg-background px-2"
      />
      {editor.loading && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          编辑器加载中…
        </p>
      )}
      {editor.degraded && (
        <p className="text-[11px] text-muted-foreground">
          SQL 高亮不可用（依赖缺失），已降级为纯文本编辑。
        </p>
      )}
    </div>
  );
}

/** 归一 join 类型 / 基数：实现在 {@link ./relationUtils}（纯函数，可单测）。 */

/**
 * 把后端业务码翻译成人话（**逐个读 `data` 明细**，见文件头错误表）。
 */
function describeRelationshipError(err: unknown): string {
  const code = errorCode(err);
  const data = errorData(err);
  const message = err instanceof Error ? err.message : String(err);

  if (code === 42200) {
    const unknownFields = Array.isArray(data?.unknown_fields) ? data.unknown_fields.map(String) : [];
    const field = typeof data?.field === 'string' ? data.field : null;
    const modelKey = typeof data?.model_item_key === 'string' ? data.model_item_key : null;
    const parts: string[] = ['条件校验未通过'];
    if (unknownFields.length > 0) {
      parts.push(`条件里引用了不存在的字段：${unknownFields.join('、')}`);
    }
    if (field) {
      parts.push(`字段 ${field} 指向的模型不存在${modelKey ? `（${modelKey}）` : ''}`);
    }
    if (unknownFields.length === 0 && !field) {
      parts.push(message);
    }
    return `[${code}] ${parts.join('；')}`;
  }
  if (code === 42201) {
    const errors = Array.isArray(data?.errors) ? data.errors.map(String) : [];
    return `[${code}] ${errors.length > 0 ? errors.join('；') : message}`;
  }
  if (code === 40900) {
    const current = data?.current_edit_revision;
    return `[${code}] 版本已变更（当前 ${String(current ?? '?')}），请刷新后重试`;
  }
  if (code === 40901) {
    return `[${code}] 该提交已被处理（幂等键重复），已为你换新提交号，可直接重试`;
  }
  if (code === 40300) {
    return `[${code}] 该连接未开启 MDL 写回（mdl_writeback_enabled=false），请联系管理员`;
  }
  if (code === 50300) {
    return `[${code}] 关系创建接口尚未就绪`;
  }
  return code != null ? `[${code}] ${message}` : message;
}

export default RelationshipDialog;

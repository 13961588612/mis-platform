import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createFormDefinition,
  updateFormDefinition,
  FORM_STATUS_ENABLED,
  FORM_STATUS_DISABLED,
  type FormDefinitionItem,
  type UpsertFormDefinitionRequest,
} from '@/lib/api/form-definition';
import { hasFormLoader, listFormLoaderCodes, loadFormEntry } from './forms/form-loaders';
import { resolveForm } from './registry';
import type { FormFieldSchema } from './types';
import { CategorySingleTreeSelect } from '@/components/common/category-single-tree-select';
import type { CategoryTreeNode } from '@/components/common/category-tree-select';
import {
  readConfigTitleField,
  withConfigTitleField,
} from '@/features/taskflow/lib/resolve-process-title';

export interface FormDefinitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新增；否则编辑该条。 */
  initial: FormDefinitionItem | null;
  /** 业务分类树（嵌套 children，来自 biz_category）。空选 = 未分类（categoryId: null）。 */
  categoryTree: CategoryTreeNode[];
  tenantId: string;
  operatorId: string;
  onSaved: () => void;
}

const CODE_ERROR = '请选择已注册的表单组件';
const NAME_ERROR = '请填写名称';

/** 在分类树中查找某 id 是否存在（编辑时判断当前分类是否仍在候选树里）。 */
function treeHasId(nodes: CategoryTreeNode[], target: string): boolean {
  for (const n of nodes) {
    if (String(n.id) === target) return true;
    if (n.children?.length && treeHasId(n.children, target)) return true;
  }
  return false;
}

/**
 * 表单定义「新增 / 编辑」对话框（仅表单；分类独立为 `form_category`）。
 *
 * <p>字段：code（下拉选已注册组件）、name、categoryId（分类下拉，可空 = 未分类）、
 * status（ENABLED/DISABLED）、sortOrder（number）、description。
 *
 * <p>⚠️ `code` 仍从 `listFormLoaderCodes()` 选择。若 `initial.code` 不在候选里
 * （如种子数据 `PURCHASE_APPROVAL_DEMO`），保留一条红色「未关联组件：<code>」
 * 选项 + 警告提示，但仍允许保存（历史数据不可丢）。
 */
export function FormDefinitionDialog({
  open,
  onOpenChange,
  initial,
  categoryTree,
  tenantId,
  operatorId,
  onSaved,
}: FormDefinitionDialogProps) {
  const isEdit = initial !== null;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<string>(FORM_STATUS_ENABLED);
  const [sortOrder, setSortOrder] = useState('');
  const [titleField, setTitleField] = useState('');
  const [titleFieldOptions, setTitleFieldOptions] = useState<FormFieldSchema[]>([]);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 每次打开时根据 initial 重置表单。
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCode(initial.code);
      setName(initial.name);
      setDescription(initial.description ?? '');
      setCategoryId(initial.categoryId == null ? '' : String(initial.categoryId));
      setStatus(initial.status === FORM_STATUS_DISABLED ? FORM_STATUS_DISABLED : FORM_STATUS_ENABLED);
      setSortOrder(initial.sortOrder == null ? '' : String(initial.sortOrder));
      setTitleField(readConfigTitleField(initial.config) ?? '');
    } else {
      setCode('');
      setName('');
      setDescription('');
      setCategoryId('');
      setStatus(FORM_STATUS_ENABLED);
      setSortOrder('');
      setTitleField('');
    }
    setTitleFieldOptions([]);
    setCodeError(null);
    setNameError(null);
  }, [open, initial]);

  // 选中表单组件后加载字段 schema，供「标题字段」下拉。
  useEffect(() => {
    if (!open || !code) {
      setTitleFieldOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      await loadFormEntry(code);
      if (cancelled) return;
      const entry = resolveForm(code);
      setTitleFieldOptions(entry?.fields ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, code]);

  // 已注册组件编码清单；以及「initial.code 不在清单里」时的游离选项。
  const loaderCodes = useMemo(() => listFormLoaderCodes(), []);
  const strayCode = useMemo(
    () => (initial?.code && !loaderCodes.includes(initial.code) ? initial.code : null),
    [initial, loaderCodes],
  );

  // 编辑时若当前分类不在候选项里（分类被删/跨租户），补一条兜底提示，避免下拉显示空白。
  const categoryMissing = useMemo(() => {
    if (initial?.categoryId == null) return null;
    const key = String(initial.categoryId);
    return treeHasId(categoryTree, key) ? null : key;
  }, [initial, categoryTree]);

  async function handleSubmit() {
    const trimmedName = name.trim();
    // 必须选一个已注册组件（含历史游离 code 的情况）。
    const cErr = !code || !hasFormLoader(code) ? CODE_ERROR : null;
    const nErr = trimmedName.length === 0 ? NAME_ERROR : null;
    setCodeError(cErr);
    setNameError(nErr);
    if (cErr || nErr) return;

    const baseConfig = isEdit && initial ? initial.config : '{}';
    const body: UpsertFormDefinitionRequest = {
      categoryId: categoryId === '' ? null : Number(categoryId),
      code: code.trim(),
      name: trimmedName,
      description: description.trim().length === 0 ? null : description.trim(),
      status: status === FORM_STATUS_DISABLED ? FORM_STATUS_DISABLED : FORM_STATUS_ENABLED,
      sortOrder: sortOrder.trim().length === 0 ? null : Number(sortOrder),
      config: withConfigTitleField(baseConfig, titleField || null),
    };

    setSaving(true);
    try {
      if (isEdit && initial) {
        await updateFormDefinition(initial.id, tenantId, body);
        toast.success('已更新表单定义');
      } else {
        await createFormDefinition(tenantId, operatorId, body);
        toast.success('已创建表单定义');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑表单定义' : '新增表单定义'}</DialogTitle>
          <DialogDescription>
            {isEdit ? '修改表单定义元数据，保存后实时生效。' : '选择已注册的表单组件并登记元数据。'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3 px-1 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="fd-code" className="block text-sm font-medium text-foreground">
              表单组件 *
            </label>
            <select
              id="fd-code"
              aria-label="表单组件"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (codeError) setCodeError(null);
              }}
              className={cn(
                'h-8 w-full rounded-md border border-input bg-background px-2 text-sm',
                codeError && 'border-destructive focus-visible:ring-destructive',
              )}
            >
              <option value="">选择已注册组件</option>
              {loaderCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {strayCode ? (
                <option value={strayCode} className="text-destructive">
                  {`未关联组件：${strayCode}`}
                </option>
              ) : null}
            </select>
            {codeError ? (
              <p className="text-xs text-destructive">{codeError}</p>
            ) : strayCode ? (
              <p className="text-xs text-destructive">
                当前编码「{strayCode}」未关联到任何前端组件，保存后审批页将走「未注册」兜底。
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">下拉选择后端已启用且前端已实现的表单组件。</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fd-name" className="block text-sm font-medium text-foreground">
              名称 *
            </label>
            <Input
              id="fd-name"
              aria-label="表单名称"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="如 报销单"
            />
            {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fd-category" className="block text-sm font-medium text-foreground">
              分类
            </label>
            <CategorySingleTreeSelect
              id="fd-category"
              ariaLabel="分类"
              tree={categoryTree}
              value={categoryId === '' ? null : categoryId}
              onChange={(id) => setCategoryId(id ?? '')}
              placeholder="未分类"
              fallbackLabel={categoryMissing ? `分类#${categoryMissing}` : null}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="fd-status" className="block text-sm font-medium text-foreground">
                状态
              </label>
              <select
                id="fd-status"
                aria-label="状态"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value={FORM_STATUS_ENABLED}>启用</option>
                <option value={FORM_STATUS_DISABLED}>停用</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="fd-sort" className="block text-sm font-medium text-foreground">
                排序
              </label>
              <Input
                id="fd-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fd-title-field" className="block text-sm font-medium text-foreground">
              标题字段
            </label>
            <select
              id="fd-title-field"
              aria-label="标题字段"
              value={titleField}
              onChange={(e) => setTitleField(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">不指定（发起时弹窗补录）</option>
              {titleFieldOptions.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}（{f.key}）
                </option>
              ))}
              {titleField && !titleFieldOptions.some((f) => f.key === titleField) ? (
                <option value={titleField}>{titleField}（未在注册表）</option>
              ) : null}
            </select>
            <p className="text-xs text-muted-foreground">
              写入 config.titleField；发起流程时优先取该表单字段作为实例标题。
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fd-desc" className="block text-sm font-medium text-foreground">
              描述
            </label>
            <Textarea
              id="fd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选，用途说明"
              rows={3}
            />
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default FormDefinitionDialog;

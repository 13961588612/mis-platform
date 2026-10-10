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
  isValidFormCode,
  FORM_STATUS_ENABLED,
  FORM_STATUS_DISABLED,
  FORM_KIND_FORM,
  type FormDefinitionItem,
  type FormKind,
  type UpsertFormDefinitionRequest,
} from '@/lib/api/form-definition';
import { hasFormLoader, listFormLoaderCodes } from './forms/form-loaders';

export interface ParentOption {
  id: string;
  name: string;
  depth: number;
}

export interface FormDefinitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新增；否则编辑该条。 */
  initial: FormDefinitionItem | null;
  /** 可选父级节点（已排除自身及子孙），'root' 表示无父级。 */
  parentOptions: ParentOption[];
  /** 新增时的默认父级 id（来自选中树节点），'root' 表示无。 */
  defaultParentId?: string;
  /** 节点类型：CATEGORY（自由编码）/ FORM（下拉选已注册组件）。默认 FORM。 */
  kind?: FormKind;
  tenantId: string;
  operatorId: string;
  onSaved: () => void;
}

const CODE_ERROR_FORM = '请选择已注册的表单组件';
const CODE_ERROR_CATEGORY = '编码格式不正确（需以大写字母开头，仅含大写字母、数字、下划线，长度 2-64）';
const NAME_ERROR = '请填写名称';

/**
 * 表单定义「新增 / 编辑」对话框。
 *
 * <p>字段：code、name、description（textarea）、parentId（下拉选已有节点）、
 * status（ENABLED/DISABLED）、sortOrder（number）。
 *
 * <p>⚠️ **code 的形态由 `kind` 决定**（需求 q-0）：
 * - `FORM`：下拉选「已注册组件」（`listFormLoaderCodes()` 来源）。若 `initial.code`
 *   不在候选里（如种子数据 `PURCHASE_APPROVAL_DEMO`），保留一条红色「未关联组件：<code>」
 *   选项 + 警告提示，但仍允许保存（历史数据不可丢）。
 * - `CATEGORY`：自由文本编码，沿用 `isValidFormCode` 正则校验。
 */
export function FormDefinitionDialog({
  open,
  onOpenChange,
  initial,
  parentOptions,
  defaultParentId = 'root',
  kind = FORM_KIND_FORM,
  tenantId,
  operatorId,
  onSaved,
}: FormDefinitionDialogProps) {
  const isEdit = initial !== null;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('root');
  const [status, setStatus] = useState<string>(FORM_STATUS_ENABLED);
  const [sortOrder, setSortOrder] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 每次打开时根据 initial / defaultParentId 重置表单。
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCode(initial.code);
      setName(initial.name);
      setDescription(initial.description ?? '');
      setParentId(initial.parentId == null ? 'root' : String(initial.parentId));
      setStatus(initial.status === FORM_STATUS_DISABLED ? FORM_STATUS_DISABLED : FORM_STATUS_ENABLED);
      setSortOrder(initial.sortOrder == null ? '' : String(initial.sortOrder));
    } else {
      setCode('');
      setName('');
      setDescription('');
      setParentId(defaultParentId);
      setStatus(FORM_STATUS_ENABLED);
      setSortOrder('');
    }
    setCodeError(null);
    setNameError(null);
  }, [open, initial, defaultParentId]);

  // FORM 模式：已注册组件编码清单；以及「initial.code 不在清单里」时的游离选项。
  const loaderCodes = useMemo(() => listFormLoaderCodes(), []);
  const strayCode = useMemo(
    () => (initial?.code && !loaderCodes.includes(initial.code) ? initial.code : null),
    [initial, loaderCodes],
  );

  async function handleSubmit() {
    const trimmedName = name.trim();
    let cErr: string | null = null;
    if (kind === FORM_KIND_FORM) {
      // 必须选一个已注册组件（含历史游离 code 的情况）。
      if (!code || !hasFormLoader(code)) cErr = CODE_ERROR_FORM;
    } else if (!isValidFormCode(code.trim())) {
      cErr = CODE_ERROR_CATEGORY;
    }
    const nErr = trimmedName.length === 0 ? NAME_ERROR : null;
    setCodeError(cErr);
    setNameError(nErr);
    if (cErr || nErr) return;

    const body: UpsertFormDefinitionRequest = {
      parentId: parentId === 'root' ? null : Number(parentId),
      code: code.trim(),
      name: trimmedName,
      description: description.trim().length === 0 ? null : description.trim(),
      status: status === FORM_STATUS_DISABLED ? FORM_STATUS_DISABLED : FORM_STATUS_ENABLED,
      sortOrder: sortOrder.trim().length === 0 ? null : Number(sortOrder),
      config: null,
      kind: kind ?? FORM_KIND_FORM,
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

  const isForm = kind === FORM_KIND_FORM;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '编辑表单定义' : isForm ? '新增表单定义' : '新增分类'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改表单定义元数据，保存后实时生效。'
              : isForm
                ? '选择已注册的表单组件并登记元数据。'
                : '创建一个分类节点，用于组织表单与流程。'}
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
              {isForm ? '表单组件 *' : '编码 *'}
            </label>
            {isForm ? (
              <select
                id="fd-code"
                aria-label={isForm ? '表单组件' : '表单编码'}
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
            ) : (
              <Input
                id="fd-code"
                aria-label="表单编码"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (codeError) setCodeError(null);
                }}
                placeholder="如 EXPENSE_FORM"
                className={cn(codeError && 'border-destructive focus-visible:ring-destructive')}
              />
            )}
            {codeError ? (
              <p className="text-xs text-destructive">{codeError}</p>
            ) : isForm && strayCode ? (
              <p className="text-xs text-destructive">
                当前编码「{strayCode}」未关联到任何前端组件，保存后审批页将走「未注册」兜底。
              </p>
            ) : isForm ? (
              <p className="text-xs text-muted-foreground">下拉选择后端已启用且前端已实现的表单组件。</p>
            ) : (
              <p className="text-xs text-muted-foreground">大小写敏感，正则 ^[A-Z][A-Z0-9_]{'{'}1,63{'}'}$</p>
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
            <label htmlFor="fd-parent" className="block text-sm font-medium text-foreground">
              父级分类
            </label>
            <select
              id="fd-parent"
              aria-label="父级分类"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="root">根节点（无父级）</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {' '.repeat(opt.depth * 2)}
                  {opt.name}
                </option>
              ))}
            </select>
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

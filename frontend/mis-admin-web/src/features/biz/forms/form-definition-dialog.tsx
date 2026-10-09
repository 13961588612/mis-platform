import { useEffect, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  createFormDefinition,
  updateFormDefinition,
  isValidFormCode,
  FORM_STATUS_ENABLED,
  FORM_STATUS_DISABLED,
  type FormDefinitionItem,
  type UpsertFormDefinitionRequest,
} from '@/lib/api/form-definition';

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
  tenantId: string;
  operatorId: string;
  onSaved: () => void;
}

const CODE_ERROR = '编码格式不正确（需以大写字母开头，仅含大写字母、数字、下划线，长度 2-64）';
const NAME_ERROR = '请填写名称';

/**
 * 表单定义「新增 / 编辑」对话框。
 *
 * <p>字段：code（带正则提示与红字校验）、name、description（textarea）、
 * parentId（下拉选已有节点，可空=根）、status（ENABLED/DISABLED）、sortOrder（number）。
 * 提交前做前端校验，校验失败不发起请求；成功回调 `onSaved` 并关闭。
 */
export function FormDefinitionDialog({
  open,
  onOpenChange,
  initial,
  parentOptions,
  defaultParentId = 'root',
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

  async function handleSubmit() {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const cErr = !isValidFormCode(trimmedCode) ? CODE_ERROR : null;
    const nErr = trimmedName.length === 0 ? NAME_ERROR : null;
    setCodeError(cErr);
    setNameError(nErr);
    if (cErr || nErr) return;

    const body: UpsertFormDefinitionRequest = {
      parentId: parentId === 'root' ? null : Number(parentId),
      code: trimmedCode,
      name: trimmedName,
      description: description.trim().length === 0 ? null : description.trim(),
      status: status === FORM_STATUS_DISABLED ? FORM_STATUS_DISABLED : FORM_STATUS_ENABLED,
      sortOrder: sortOrder.trim().length === 0 ? null : Number(sortOrder),
      config: null,
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
            {isEdit ? '修改表单定义元数据，保存后实时生效。' : '创建一条表单定义，用于注册业务表单。'}
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
              编码 *
            </label>
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
            {codeError ? (
              <p className="text-xs text-destructive">{codeError}</p>
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
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="fd-parent" className="w-full">
                <SelectValue placeholder="选择父级（根节点留空）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">根节点（无父级）</SelectItem>
                {parentOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {' '.repeat(opt.depth * 2)}
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="fd-status" className="block text-sm font-medium text-foreground">
                状态
              </label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="fd-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FORM_STATUS_ENABLED}>启用</SelectItem>
                  <SelectItem value={FORM_STATUS_DISABLED}>停用</SelectItem>
                </SelectContent>
              </Select>
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
              placeholder="可选，表单用途说明"
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

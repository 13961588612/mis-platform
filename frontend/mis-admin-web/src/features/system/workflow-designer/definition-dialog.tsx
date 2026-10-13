/**
 * 「新增流程定义」弹窗。
 *
 * <p>字段：名称 / 编码 / 分类 / 可选说明。表单关联已移至列表「关联表单」弹窗，本弹窗不再选表单。
 *
 * <p>⚠️ **本弹窗不直接调 `POST /workflow/definitions`**：
 * 后端 `CreateDefinitionRequest.nodes` 是 `@NotEmpty`，
 * 且 `WfDefinitionService.validateNodes` 要求「恰好 1 个 START + 至少 1 个 END」。
 * 只填元数据就落库必然 400 ⇒ 弹窗只收集元数据，交给编排 Dialog 画完节点再保存。
 */
import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useBizCategoryTree } from './biz-category-catalog';
import { findCodeConflict, validateDefinitionCode } from './save-error';
import { CategorySingleTreeSelect } from '@/components/common/category-single-tree-select';

export interface DefinitionDraft {
  code: string;
  name: string;
  categoryId: number | null;
  description: string;
  /** 新建时恒为空；关联表单在列表「关联表单」中完成。 */
  supportedFormCodes: string[];
}

export interface DefinitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 校验通过后回调（已 trim）。调用方负责关闭本弹窗并打开编排画布。 */
  onSubmit: (draft: DefinitionDraft) => void;
  tenantId?: string;
}

const DESCRIPTION_MAX = 512;

interface Errors {
  name?: string;
  code?: string;
  description?: string;
}

export function DefinitionDialog({
  open,
  onOpenChange,
  onSubmit,
  tenantId = '1',
}: DefinitionDialogProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [checking, setChecking] = useState(false);

  const { tree: categoryTree, loading: catLoading, error: catError } = useBizCategoryTree(tenantId);

  function reset() {
    setName('');
    setCode('');
    setCategoryId(null);
    setDescription('');
    setErrors({});
  }

  async function handleSubmit() {
    const next: Errors = {};
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 128) next.name = '请填写流程名称（1-128 字符）';
    const codeError = validateDefinitionCode(code);
    if (codeError) next.code = codeError;
    if (description.trim().length > DESCRIPTION_MAX) {
      next.description = `说明不能超过 ${DESCRIPTION_MAX} 字符`;
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    const trimmedCode = code.trim();
    setChecking(true);
    try {
      const conflict = await findCodeConflict(tenantId, trimmedCode);
      if (conflict) {
        setErrors({ code: `编码「${conflict}」已存在` });
        return;
      }
    } finally {
      setChecking(false);
    }

    setErrors({});
    onSubmit({
      code: trimmedCode,
      name: trimmedName,
      categoryId,
      description: description.trim(),
      supportedFormCodes: [],
    });
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>新增流程定义</DialogTitle>
          <DialogDescription>
            先登记流程身份，下一步在画布上编排节点；表单请在列表「关联表单」中配置。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-[12px] text-muted-foreground">流程名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="采购审批流程"
              className="h-8"
              aria-label="流程名称"
            />
            {errors.name ? <p className="mt-1 text-[11px] text-destructive">{errors.name}</p> : null}
          </div>

          <div>
            <Label className="mb-1 block text-[12px] text-muted-foreground">流程编码</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="PUR_APPROVAL"
              className="h-8 font-mono"
              aria-label="流程编码"
            />
            {errors.code ? <p className="mt-1 text-[11px] text-destructive">{errors.code}</p> : null}
          </div>

          <div>
            <Label className="mb-1 block text-[12px] text-muted-foreground">分类</Label>
            <CategorySingleTreeSelect
              tree={categoryTree}
              value={categoryId == null ? null : String(categoryId)}
              onChange={(id) => setCategoryId(id == null ? null : Number(id))}
              placeholder="未分类"
              disabled={catLoading}
              ariaLabel="分类"
            />
            {catError ? <p className="mt-1 text-[11px] text-warning">{catError}</p> : null}
          </div>

          <div>
            <Label className="mb-1 block text-[12px] text-muted-foreground">说明（可选）</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={DESCRIPTION_MAX}
              aria-label="说明"
            />
            {errors.description ? (
              <p className="mt-1 text-[11px] text-destructive">{errors.description}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={checking} onClick={() => void handleSubmit()}>
            {checking ? '检查中…' : '下一步：编排'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DefinitionDialog;

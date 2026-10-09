/**
 * 「新增流程定义」弹窗（方案 §4.4 / T4.4）。
 *
 * <p>字段：名称 / 编码 / 分类 / 表单多选（+ 可选说明）。
 *
 * <p>⚠️ **本弹窗不直接调 `POST /workflow/definitions`**：
 * 后端 `CreateDefinitionRequest.nodes` 是 `@NotEmpty`，
 * 且 `WfDefinitionService.validateNodes` 要求「恰好 1 个 START + 至少 1 个 END」。
 * 只填元数据就落库必然 400 ⇒ 弹窗只收集元数据，交给编排 Dialog 画完节点再保存。
 *
 * <p>⚠️ 表单多选**只能选候选项里的**（后端 ENABLED ∧ 前端已实现）。
 * 这一条同时是 §2.4 保险 A「保存时校验 formCode 已注册」的落地点：
 * 下拉里根本不会出现未注册的 code，就不需要在保存时再校验一遍。
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { missingFormCodes, useFormCatalog } from './form-catalog';
import { WF_CATEGORIES } from './property-panel';
import { findCodeConflict, validateDefinitionCode } from './save-error';

export interface DefinitionDraft {
  code: string;
  name: string;
  category: string;
  description: string;
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
  forms?: string;
}

export function DefinitionDialog({
  open,
  onOpenChange,
  onSubmit,
  tenantId = '1',
}: DefinitionDialogProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<string>(WF_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [checking, setChecking] = useState(false);

  const { options, loading, notice } = useFormCatalog(tenantId);
  const missing = missingFormCodes(options, formCodes);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      options.filter(
        (o) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
      ),
    [options, q],
  );

  function reset() {
    setName('');
    setCode('');
    setCategory(WF_CATEGORIES[0]);
    setDescription('');
    setFormCodes([]);
    setErrors({});
    setQuery('');
  }

  function toggleForm(code: string) {
    setFormCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleSubmit() {
    const next: Errors = {};
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 128) next.name = '请填写流程名称（1-128 字符）';
    const codeError = validateDefinitionCode(code);
    if (codeError) next.code = codeError;
    if (formCodes.length === 0) next.forms = '请至少选择一个表单';
    else if (missing.length > 0) next.forms = `${missing.join('、')} 未注册或已停用，请取消勾选`;
    if (description.trim().length > DESCRIPTION_MAX) next.forms = `说明不能超过 ${DESCRIPTION_MAX} 字符`;
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
      category,
      description: description.trim(),
      supportedFormCodes: formCodes,
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
          <DialogDescription>先登记流程身份与可用表单，下一步在画布上编排节点。</DialogDescription>
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
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              aria-label="分类"
            >
              {WF_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/*
            ⚠️ 这里刻意用「可搜索 Checkbox 组」而不是 MultiSelect（Popover + Checkbox）：
            Radix Popover 嵌在 Radix Dialog 里要靠外部点击/焦点管理才能正常展开，
            而 §4.4 字段 5 本来写的就是「可搜索多选（Checkbox 组）」。
          */}
          <div>
            <Label className="mb-1 block text-[12px] text-muted-foreground">表单（可多选，至少 1 项）</Label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索表单"
              className="mb-1.5 h-8"
              aria-label="搜索表单"
            />
            <div className="max-h-40 overflow-auto rounded-md border border-input p-1.5">
              {loading ? (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">加载表单清单…</p>
              ) : visible.length === 0 ? (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">暂无可选项</p>
              ) : (
                visible.map((o) => (
                  <label
                    key={o.code}
                    data-testid="form-option"
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={formCodes.includes(o.code)}
                      onCheckedChange={() => toggleForm(o.code)}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.name}（{o.code}）</span>
                  </label>
                ))
              )}
            </div>
            {notice ? <p className="mt-1 text-[11px] text-warning">{notice}</p> : null}
            {errors.forms ? <p className="mt-1 text-[11px] text-destructive">{errors.forms}</p> : null}
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

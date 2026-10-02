/**
 * 企微用户身份绑定 新增/编辑 弹窗（wecom-user-binding-design.md §11 #60）。
 *
 * <p>绑定事实的三要素：`corp_id + wecom_user_id`（企微侧自然唯一键）→
 * `tenant_id + mis_user_id`（MIS 权限主体）。编辑态不允许改前两者
 * （它们是键，改了等于换一条记录），只允许改目标 MIS 用户与手机号备注。
 *
 * <p>**手机号只写不读**：列表只回 `phone_masked`，这里输入框永远为空，
 * 留空 = 不修改；填了才覆盖（后端只存哈希 + 掩码，不落明文）。
 *
 * <p>来源固定为 `manual`：经此弹窗绑定的一律是人工绑定，优先级最高，
 * 不会被首次手机号自动匹配覆盖。
 */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { SubmitButton } from '@/components/common/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { bindWecomUser } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { WecomUserBinding } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

interface BindFormValues {
  corp_id: string;
  wecom_user_id: string;
  tenant_id: string;
  mis_user_id: string;
  phone: string;
}

const EMPTY_FORM: BindFormValues = {
  corp_id: '',
  wecom_user_id: '',
  tenant_id: '',
  mis_user_id: '',
  phone: '',
};

function buildSchema(isEdit: boolean) {
  return z.object({
    corp_id: isEdit
      ? z.string()
      : z.string().trim().min(1, '企业 ID 必填').max(64, '企业 ID 不超过 64 字符'),
    wecom_user_id: isEdit
      ? z.string()
      : z.string().trim().min(1, '企微 userid 必填').max(64, '企微 userid 不超过 64 字符'),
    tenant_id: z
      .string()
      .trim()
      .min(1, '租户 ID 必填')
      .regex(/^\d+$/, '租户 ID 必须是整数'),
    mis_user_id: z
      .string()
      .trim()
      .min(1, 'MIS 用户 ID 必填')
      .regex(/^\d+$/, 'MIS 用户 ID 必须是整数'),
    phone: z.string().trim().max(32, '手机号不超过 32 字符'),
  });
}

export interface AgentWecomBindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新增；非 null = 编辑该条绑定。 */
  binding: WecomUserBinding | null;
  onSaved: () => void;
}

export function AgentWecomBindDialog({
  open,
  onOpenChange,
  binding,
  onSaved,
}: AgentWecomBindDialogProps) {
  const [form, setForm] = useState<BindFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof BindFormValues, string>>>({});
  const [saving, setSaving] = useState(false);

  const isEdit = binding !== null;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    if (binding) {
      setForm({
        corp_id: binding.corp_id,
        wecom_user_id: binding.wecom_user_id,
        tenant_id: String(binding.tenant_id),
        mis_user_id: String(binding.mis_user_id),
        phone: '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, binding]);

  function patch<K extends keyof BindFormValues>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function onSubmit(): Promise<void> {
    const parsed = buildSchema(isEdit).safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof BindFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof BindFormValues;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setSaving(true);
    try {
      await bindWecomUser(parsed.data.corp_id, parsed.data.wecom_user_id, {
        tenant_id: Number(parsed.data.tenant_id),
        mis_user_id: Number(parsed.data.mis_user_id),
        phone: parsed.data.phone || undefined,
      });
      toast.success(isEdit ? '绑定已更新' : '绑定已创建');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(agentErrorMessage(e, '保存企微用户绑定失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑企微用户绑定' : '新增企微用户绑定'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <label className={fieldLabel} htmlFor="wecom-bind-corp">
              企业 ID（corp_id）{isEdit ? '' : ' *'}
            </label>
            <Input
              id="wecom-bind-corp"
              value={form.corp_id}
              disabled={isEdit}
              autoComplete="off"
              placeholder="ww-xxxxxxxxxxxx"
              onChange={(e) => patch('corp_id', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              企微企业 ID；与 Bot 配置里的 corp_id 一致。绑定按该企业隔离，避免同名 userid 串绑。
            </p>
            {errors.corp_id ? <p className="mt-1 text-xs text-destructive">{errors.corp_id}</p> : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wecom-bind-userid">
              企微 userid（wecom_user_id）{isEdit ? '' : ' *'}
            </label>
            <Input
              id="wecom-bind-userid"
              value={form.wecom_user_id}
              disabled={isEdit}
              autoComplete="off"
              placeholder="zhangsan"
              onChange={(e) => patch('wecom_user_id', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              企微成员 userid（消息发送者标识），不是姓名也不是手机号。
            </p>
            {errors.wecom_user_id ? (
              <p className="mt-1 text-xs text-destructive">{errors.wecom_user_id}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="wecom-bind-tenant">
                MIS 租户 ID *
              </label>
              <Input
                id="wecom-bind-tenant"
                value={form.tenant_id}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => patch('tenant_id', e.target.value)}
              />
              {errors.tenant_id ? (
                <p className="mt-1 text-xs text-destructive">{errors.tenant_id}</p>
              ) : null}
            </div>
            <div>
              <label className={fieldLabel} htmlFor="wecom-bind-mis">
                MIS 用户 ID *
              </label>
              <Input
                id="wecom-bind-mis"
                value={form.mis_user_id}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => patch('mis_user_id', e.target.value)}
              />
              {errors.mis_user_id ? (
                <p className="mt-1 text-xs text-destructive">{errors.mis_user_id}</p>
              ) : null}
            </div>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wecom-bind-phone">
              手机号（可选）
            </label>
            <Input
              id="wecom-bind-phone"
              value={form.phone}
              autoComplete="off"
              placeholder={isEdit ? '留空 = 不修改' : '仅用于记录，只存哈希与掩码'}
              onChange={(e) => patch('phone', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              手机号只写不读：后端只保存加盐哈希与掩码，列表与接口永不回明文。
            </p>
            {errors.phone ? <p className="mt-1 text-xs text-destructive">{errors.phone}</p> : null}
          </div>

          {isEdit && binding ? (
            <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              当前来源：<span className="font-mono">{binding.bind_source}</span>；状态：
              <span className="font-mono">{binding.status}</span>。保存后会置为
              <span className="font-medium text-foreground"> manual </span>并重新激活。
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <SubmitButton loading={saving} onClick={() => void onSubmit()}>
            保存
          </SubmitButton>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

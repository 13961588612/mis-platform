/**
 * 企微企业配置 新增 / 编辑 弹窗（方案 B §64–#70）。
 *
 * <p>两段式语义：
 *   - **企业条目**（corp_id / 租户 / 名称 / 绑定模式）→ 落 `wecom-corps.yaml`；
 *     新增后 `corp_id` 不可改（它是密钥引用与绑定表的键）。
 *   - **corpsecret** → 加密存 Vault，**只写不读**：输入框永远为空，留空 = 不修改；
 *     提供「清除密钥」显式开关（默认关闭，避免误清空导致绑定链路静默失效）。
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
import {
  createWecomCorp,
  deleteWecomCorpSecret,
  setWecomCorpSecret,
  updateWecomCorp,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { WecomCorp } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const BIND_MODES = [
  { value: 'auto_phone', label: '自动（手机号精确匹配）' },
  { value: 'manual_only', label: '仅人工绑定' },
  { value: 'disabled', label: '禁用（不入绑定）' },
] as const;

type BindMode = (typeof BIND_MODES)[number]['value'];

interface CorpFormValues {
  corp_id: string;
  tenant_id: string;
  name: string;
  user_bind_mode: BindMode;
  corpsecret: string;
}

const EMPTY_FORM: CorpFormValues = {
  corp_id: '',
  tenant_id: '',
  name: '',
  user_bind_mode: 'auto_phone',
  corpsecret: '',
};

function buildSchema(isEdit: boolean) {
  return z.object({
    corp_id: isEdit
      ? z.string()
      : z.string().trim().min(1, '企业 ID 必填').max(64, '企业 ID 不超过 64 字符'),
    tenant_id: z
      .string()
      .trim()
      .min(1, '租户 ID 必填')
      .regex(/^\d+$/, '租户 ID 必须是整数'),
    name: z.string().trim().max(128, '名称不超过 128 字符'),
    user_bind_mode: z.enum(['auto_phone', 'manual_only', 'disabled']),
    corpsecret: z.string().trim().max(512, 'corpsecret 不超过 512 字符'),
  });
}

export interface AgentWecomCorpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新增；非 null = 编辑该企业。 */
  corp: WecomCorp | null;
  onSaved: () => void;
}

export function AgentWecomCorpDialog({ open, onOpenChange, corp, onSaved }: AgentWecomCorpDialogProps) {
  const [form, setForm] = useState<CorpFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof CorpFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  /** 编辑态是否要清除已存密钥（默认 false，防误清）。 */
  const [clearSecret, setClearSecret] = useState(false);

  const isEdit = corp !== null;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    setClearSecret(false);
    if (corp) {
      setForm({
        corp_id: corp.corp_id,
        tenant_id: String(corp.tenant_id),
        name: corp.name,
        user_bind_mode: corp.user_bind_mode,
        corpsecret: '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, corp]);

  function patch<K extends keyof CorpFormValues>(key: K, value: CorpFormValues[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function onSubmit(): Promise<void> {
    const parsed = buildSchema(isEdit).safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof CorpFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof CorpFormValues;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    const values = parsed.data;
    setSaving(true);
    try {
      if (isEdit && corp) {
        await updateWecomCorp(corp.corp_id, {
          tenant_id: Number(values.tenant_id),
          name: values.name,
          user_bind_mode: values.user_bind_mode,
        });
        if (clearSecret) {
          await deleteWecomCorpSecret(corp.corp_id);
        } else if (values.corpsecret) {
          await setWecomCorpSecret(corp.corp_id, values.corpsecret);
        }
      } else {
        const created = await createWecomCorp({
          corp_id: values.corp_id,
          tenant_id: Number(values.tenant_id),
          name: values.name,
          user_bind_mode: values.user_bind_mode,
        });
        if (values.corpsecret) {
          await setWecomCorpSecret(created.corp_id, values.corpsecret);
        }
      }
      toast.success(isEdit ? '企业配置已保存' : '企业已创建');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(agentErrorMessage(e, '保存企业配置失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑企微企业' : '新增企微企业'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="corp-id">
                企业 ID（corp_id）{isEdit ? '' : ' *'}
              </label>
              <Input
                id="corp-id"
                value={form.corp_id}
                disabled={isEdit}
                autoComplete="off"
                placeholder="ww-xxxxxxxxxxxx"
                onChange={(e) => patch('corp_id', e.target.value)}
              />
              <p className="mt-[0.35rem] text-xs text-muted-foreground">
                企微企业 ID，是绑定表与密钥引用的键；创建后不可修改。
              </p>
              {errors.corp_id ? <p className="mt-1 text-xs text-destructive">{errors.corp_id}</p> : null}
            </div>
            <div>
              <label className={fieldLabel} htmlFor="corp-tenant">
                MIS 租户 ID *
              </label>
              <Input
                id="corp-tenant"
                value={form.tenant_id}
                inputMode="numeric"
                autoComplete="off"
                placeholder="1"
                onChange={(e) => patch('tenant_id', e.target.value)}
              />
              <p className="mt-[0.35rem] text-xs text-muted-foreground">
                手机号反查与绑定的租户隔离边界。
              </p>
              {errors.tenant_id ? <p className="mt-1 text-xs text-destructive">{errors.tenant_id}</p> : null}
            </div>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="corp-name">
              名称
            </label>
            <Input
              id="corp-name"
              value={form.name}
              autoComplete="off"
              placeholder="集团总部"
              onChange={(e) => patch('name', e.target.value)}
            />
            {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="corp-mode">
              用户绑定模式
            </label>
            <select
              id="corp-mode"
              className={selectClass}
              value={form.user_bind_mode}
              onChange={(e) => patch('user_bind_mode', e.target.value as BindMode)}
            >
              {BIND_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              「自动」仅对首次无绑定用户按手机号精确匹配一次；「仅人工」需运营台手工绑定。
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <label className={fieldLabel} htmlFor="corp-secret">
              通讯录应用 Secret（corpsecret）
            </label>
            {isEdit ? (
              <label className="mb-[0.4rem] flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  checked={clearSecret}
                  onChange={(e) => {
                    setClearSecret(e.target.checked);
                    if (e.target.checked) patch('corpsecret', '');
                  }}
                />
                清除已存密钥（谨慎：清除后该企业绑定链路会 fail-closed）
              </label>
            ) : null}
            <Input
              id="corp-secret"
              type="password"
              value={form.corpsecret}
              disabled={clearSecret}
              autoComplete="new-password"
              placeholder={
                isEdit
                  ? corp?.secret_configured
                    ? '已配置，留空 = 不修改'
                    : '尚未配置，请输入 corpsecret'
                  : '请输入企微应用 corpsecret（可不填，稍后补配）'
              }
              onChange={(e) => patch('corpsecret', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              只写不读：加密存 Vault（AES-256-GCM），接口与页面都拿不到明文；YAML 只写
              <span className="font-mono"> secret:// </span>引用。
            </p>
            {errors.corpsecret ? (
              <p className="mt-1 text-xs text-destructive">{errors.corpsecret}</p>
            ) : null}
          </div>
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

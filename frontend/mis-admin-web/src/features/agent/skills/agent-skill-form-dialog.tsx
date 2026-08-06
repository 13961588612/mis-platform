/**
 * 技能创建 / 编辑表单（UI#1 #7，§4.3 #4 建 / #5 改）。
 *
 * <p>校验用 **zod**（仓库已依赖 `zod@^3`，零新增）。不引 react-hook-form：
 * 本表单只有 5 个字段且无联动，用受控 state + 一次性 `safeParse` 更短也更好读。
 *
 * <p>**字段范围严格对齐 `SkillPayload`**（`{ id?, name, description, category?, tags? }`）——
 * 这是 §4.3 已定稿的端点签名，不在本期改动范围内。因此：
 *   - `enabled` **不在表单里**：技能启停是 #7 / #8 两个独立端点（幂等、可审计），
 *     混进 PUT 会出现"编辑名称顺带把技能停了"这种不可见副作用；
 *   - `skill_type` 后端 DTO 未定义，提交会被忽略，故不做假输入框。
 *
 * <p>`id` 仅新建时可填：它是 `ai:skill:{id}:run` 执行码的组成部分，
 * 改 id 等于让已授权的执行码全部失效，属于删旧建新而非编辑。
 */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { SubmitButton } from '@/components/common/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createSkill, updateSkill, type SkillPayload } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { Skill } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

/**
 * 表单 schema。
 *
 * <p>`id` 的字符集刻意收紧到 `[a-zA-Z0-9._-]`：它会被拼进权限码
 * `ai:skill:{id}:run`，若含 `:` 会把码切歧义，含空格 / 中文则 Java 与 Python
 * 两侧的转义处理未必一致（§10.5 要求两端生成**完全一致**的字符串）。
 */
const skillFormSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, '技能 ID 必填')
    .max(64, '技能 ID 不超过 64 字符')
    .regex(/^[a-zA-Z0-9._-]+$/, '仅允许字母、数字、点、下划线与连字符'),
  name: z.string().trim().min(1, '名称必填').max(64, '名称不超过 64 字'),
  description: z.string().trim().min(1, '描述必填').max(500, '描述不超过 500 字'),
  category: z.string().trim().max(64, '分类不超过 64 字'),
  tags: z.string().trim().max(200, '标签整体不超过 200 字'),
});

type SkillFormValues = z.infer<typeof skillFormSchema>;

const EMPTY_FORM: SkillFormValues = {
  id: '',
  name: '',
  description: '',
  category: '',
  tags: '',
};

/** 逗号 / 中文逗号 / 空格分隔 → 去重去空的标签数组。 */
function parseTags(raw: string): string[] {
  const parts = raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(parts)];
}

export interface AgentSkillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新建；非 null = 编辑该技能。 */
  skill: Skill | null;
  /** 保存成功回调（外层据此刷新列表与统计）。 */
  onSaved: () => void;
}

export function AgentSkillFormDialog({
  open,
  onOpenChange,
  skill,
  onSaved,
}: AgentSkillFormDialogProps) {
  const [form, setForm] = useState<SkillFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof SkillFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const isEdit = skill !== null;

  // 每次打开按当前对象重置，避免上一次编辑的残留串进新建表单
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    setForm(
      skill
        ? {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            category: skill.category ?? '',
            tags: (skill.tags ?? []).join(', '),
          }
        : EMPTY_FORM,
    );
  }, [open, skill]);

  function patch(key: keyof SkillFormValues, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  async function onSubmit(): Promise<void> {
    const parsed = skillFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof SkillFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in next)) {
          next[key as keyof SkillFormValues] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    const values = parsed.data;
    const payload: SkillPayload = {
      name: values.name,
      description: values.description,
      category: values.category || undefined,
      tags: parseTags(values.tags),
    };

    setSaving(true);
    try {
      if (isEdit && skill) {
        await updateSkill(skill.id, payload);
      } else {
        await createSkill({ ...payload, id: values.id });
      }
      toast.success(isEdit ? '技能已更新' : '技能已创建');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(agentErrorMessage(e, isEdit ? '更新技能失败' : '创建技能失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑技能' : '新建技能'}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          <div>
            <label className={fieldLabel} htmlFor="skill-id">
              技能 ID *
            </label>
            <Input
              id="skill-id"
              value={form.id}
              disabled={isEdit}
              placeholder="member.points-account"
              autoComplete="off"
              onChange={(e) => patch('id', e.target.value)}
            />
            <p className="mt-[0.35rem] text-xs text-muted-foreground">
              {isEdit
                ? 'ID 关联执行码 ai:skill:{id}:run，创建后不可修改。'
                : '将用于生成执行码 ai:skill:{id}:run，仅允许字母、数字、点、下划线与连字符。'}
            </p>
            {errors.id ? <p className="mt-1 text-xs text-destructive">{errors.id}</p> : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="skill-name">
              名称 *
            </label>
            <Input
              id="skill-name"
              value={form.name}
              onChange={(e) => patch('name', e.target.value)}
            />
            {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="skill-desc">
              描述 *
            </label>
            <Textarea
              id="skill-desc"
              rows={3}
              value={form.description}
              placeholder="这个技能在什么场景下被调用、能做什么"
              onChange={(e) => patch('description', e.target.value)}
            />
            {errors.description ? (
              <p className="mt-1 text-xs text-destructive">{errors.description}</p>
            ) : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="skill-category">
              分类
            </label>
            <Input
              id="skill-category"
              value={form.category}
              placeholder="如 member / order / ops"
              onChange={(e) => patch('category', e.target.value)}
            />
            {errors.category ? (
              <p className="mt-1 text-xs text-destructive">{errors.category}</p>
            ) : null}
          </div>

          <div>
            <label className={fieldLabel} htmlFor="skill-tags">
              标签
            </label>
            <Input
              id="skill-tags"
              value={form.tags}
              placeholder="逗号或空格分隔，如：查询, 只读"
              onChange={(e) => patch('tags', e.target.value)}
            />
            {errors.tags ? <p className="mt-1 text-xs text-destructive">{errors.tags}</p> : null}
          </div>

          {isEdit && skill ? (
            <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              当前状态：{skill.status === 'active' ? '已启用' : '已停用'}。
              启停请使用列表中的「启用 / 停用」操作，本表单不改变技能状态。
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

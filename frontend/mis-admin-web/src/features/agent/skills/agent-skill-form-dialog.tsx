/**
 * 技能创建 / 编辑表单（UI#1 #7，§4.3 #4 建 / #5 改）。
 *
 * <p>校验用 **zod**（仓库已依赖 `zod@^3`，零新增）。不引 react-hook-form：
 * 本表单字段少且无强联动，用受控 state + 一次性 `safeParse` 更短也更好读。
 *
 * <p>**字段范围严格对齐 `SkillPayload`**（`{ skill_id?, name, description, category?,
 * tags?, handler? }`）—— 这是 §4.3 已定稿的端点签名，不在本期改动范围内。因此：
 *   - `enabled` **不在表单里**：技能启停是 #7 / #8 两个独立端点（幂等、可审计），
 *     混进 PUT 会出现"编辑名称顺带把技能停了"这种不可见副作用；
 *   - `skill_type` 后端 DTO 未定义，提交会被忽略，故不做假输入框。
 *
 * <p>`id` 仅新建时可填：它是 `ai:skill:{id}:run` 执行码的组成部分，
 * 改 id 等于让已授权的执行码全部失效，属于删旧建新而非编辑。
 *
 * <p>本期增强（R2/R3/R6/R12/R13）：新增「粘贴 SKILL.md」模式，通过
 * `POST /agent-ops/skills/parse` 解析 Front Matter 并回填字段；新增可选的 `handler`
 * 字段（执行器标识）并做前端格式校验；文档型技能（handler 留空）仅用于语义检索与
 * Agent 上下文注入，不单独执行。
 */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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
import {
  createSkill,
  parseSkill,
  updateSkill,
  type SkillPayload,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { Skill } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

/**
 * handler 三类格式：mcp:{server}:{tool} / builtin:{name} / custom:{module}.{func}。
 * 空串 = 文档型/检索型（不单独执行）。
 */
const HANDLER_RE = /^mcp:[^:]+:[^:]+$|^builtin:[^:]+$|^custom:[^.]+\.[^.]+$/;

/**
 * 表单 schema。
 *
 * <p>`id` 的字符集刻意收紧到 `[a-zA-Z0-9._-]`：它会被拼进权限码
 * `ai:skill:{id}:run`，若含 `:` 会把码切歧义，含空格 / 中文则 Java 与 Python
 * 两侧的转义处理未必一致（§10.5 要求两端生成**完全一致**的字符串）。
 *
 * <p>`handler` 仅做长度约束；非空时的格式校验在提交前用 {@link HANDLER_RE} 单独做
 * （R12），因为空串是合法的「文档型」语义。
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
  handler: z.string().max(128, 'handler 不超过 128 字符'),
});

type SkillFormValues = z.infer<typeof skillFormSchema>;

const EMPTY_FORM: SkillFormValues = {
  id: '',
  name: '',
  description: '',
  category: '',
  tags: '',
  handler: '',
};

/** 逗号 / 中文逗号 / 空格分隔 → 去重去空的标签数组。 */
function parseTags(raw: string): string[] {
  const parts = raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(parts)];
}

/** 从解析出的 metadata 取字符串值（缺省为空串），兼容非字符串脏数据。 */
function metaStr(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  return typeof v === 'string' ? v : '';
}

/** metadata.tags 可能为字符串数组或字符串，统一摊平成逗号分隔文本。 */
function metaTags(meta: Record<string, unknown>): string {
  const v = meta['tags'];
  if (Array.isArray(v)) {
    return v.filter((t) => typeof t === 'string').join(', ');
  }
  return typeof v === 'string' ? v : '';
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
  const [mode, setMode] = useState<'manual' | 'paste'>('manual');
  const [rawContent, setRawContent] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  /** 解析成功后回填的 SKILL.md 正文（只读预览）。 */
  const [parsedBody, setParsedBody] = useState<string | null>(null);
  const isEdit = skill !== null;

  // 每次打开按当前对象重置，避免上一次编辑的残留串进新建表单
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    setMode('manual');
    setRawContent('');
    setParsing(false);
    setParseError(null);
    setParsedBody(null);
    setForm(
      skill
        ? {
            // 表单内部字段名保持 `id`，仅在提交时映射到 wire 的 `skill_id`
            id: skill.skill_id,
            name: skill.name,
            description: skill.description,
            category: skill.category ?? '',
            tags: (skill.tags ?? []).join(', '),
            handler: skill.handler ?? '',
          }
        : EMPTY_FORM,
    );
  }, [open, skill]);

  function patch(key: keyof SkillFormValues, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  /** 解析并回填：调用 POST /agent-ops/skills/parse（R2/R3）。 */
  async function onParse(): Promise<void> {
    if (rawContent.trim().length === 0) {
      setParseError('请先粘贴 SKILL.md 内容');
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const res = await parseSkill(rawContent);
      const meta = (res.metadata ?? {}) as Record<string, unknown>;
      setForm((f) => ({
        ...f,
        name: metaStr(meta, 'name') || f.name,
        description: metaStr(meta, 'description') || f.description,
        category: metaStr(meta, 'category') || f.category,
        tags: metaTags(meta) || f.tags,
        handler: metaStr(meta, 'handler') || f.handler,
      }));
      setParsedBody(res.body ?? '');
      setMode('manual');
      toast.success('已解析并回填字段');
    } catch (e) {
      // R13：解析失败友好反馈（内联错误，便于「重新粘贴」）
      setParseError(agentErrorMessage(e, '解析 SKILL.md 失败'));
    } finally {
      setParsing(false);
    }
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

    // R12：handler 非空时做格式校验，不符则内联报错并阻断提交
    const handler = parsed.data.handler.trim();
    if (handler !== '' && !HANDLER_RE.test(handler)) {
      setErrors((e) => ({
        ...e,
        handler: '格式应为 mcp:{server}:{tool} / builtin:{name} / custom:{module}.{func}',
      }));
      return;
    }

    const values = parsed.data;
    const payload: SkillPayload = {
      name: values.name,
      description: values.description,
      category: values.category || undefined,
      tags: parseTags(values.tags),
      // 与上方 R12 校验保持一致：下发前 trim，避免带首尾空格的 handler 入库
      handler: values.handler?.trim() ?? '',
    };

    setSaving(true);
    try {
      if (isEdit && skill) {
        await updateSkill(skill.skill_id, payload);
      } else {
        await createSkill({ ...payload, skill_id: values.id });
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

        {/* 模式切换：手动填写 / 粘贴 SKILL.md */}
        <div className="flex gap-1 rounded-md border bg-muted/40 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={cn(
              'flex-1 rounded px-3 py-1.5 font-medium',
              mode === 'manual' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            手动填写
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={cn(
              'flex-1 rounded px-3 py-1.5 font-medium',
              mode === 'paste' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            粘贴 SKILL.md
          </button>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-auto pr-1">
          {mode === 'paste' ? (
            <div className="space-y-3">
              <div>
                <label className={fieldLabel} htmlFor="skill-raw">
                  粘贴 SKILL.md 全文
                </label>
                <Textarea
                  id="skill-raw"
                  rows={10}
                  value={rawContent}
                  placeholder={
                    '---\nname: 会员积分查询\nhandler: mcp:crm-server:query_points\ndescription: 按会员 ID 查询积分\n---\n\n执行流程…'
                  }
                  onChange={(e) => {
                    setRawContent(e.target.value);
                    if (parseError) setParseError(null);
                  }}
                />
                {parseError ? (
                  <p className="mt-1 text-xs text-destructive">{parseError}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <SubmitButton loading={parsing} onClick={() => void onParse()}>
                  {parsing ? '解析中…' : '解析并回填'}
                </SubmitButton>
                <Button variant="ghost" disabled={parsing} onClick={() => setRawContent('')}>
                  清空
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                支持带 YAML Front Matter 的 SKILL.md；解析成功后将自动切到「手动填写」并回填字段。
                无 Front Matter 时原样返回正文。解析失败可修改后重新粘贴。
              </p>
            </div>
          ) : (
            <>
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

              <div>
                <label className={fieldLabel} htmlFor="skill-handler">
                  handler（执行器，可选）
                </label>
                <Input
                  id="skill-handler"
                  value={form.handler}
                  placeholder="留空 = 文档型/检索型；或 mcp:{server}:{tool} / builtin:{name} / custom:{module}.{func}"
                  autoComplete="off"
                  onChange={(e) => patch('handler', e.target.value)}
                />
                {form.handler.trim() === '' ? (
                  <p className="mt-[0.35rem] text-xs text-muted-foreground">
                    留空 = 文档型/检索型技能，仅用于语义检索与 Agent 上下文注入，不单独执行。
                  </p>
                ) : (
                  <p className="mt-[0.35rem] text-xs text-muted-foreground">
                    可执行技能，格式：mcp:{'{server}'}:{'{tool}'} / builtin:{'{name}'} /
                    custom:{'{module}'}.{'{func}'}。
                  </p>
                )}
                {errors.handler ? (
                  <p className="mt-1 text-xs text-destructive">{errors.handler}</p>
                ) : null}
              </div>

              {parsedBody != null ? (
                <div>
                  <label className={fieldLabel}>SKILL.md 正文（解析预览，只读）</label>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                    {parsedBody || '（正文为空）'}
                  </pre>
                  <button
                    type="button"
                    className="mt-1 text-xs text-primary hover:underline"
                    onClick={() => {
                      setParsedBody(null);
                      setMode('paste');
                    }}
                  >
                    重新粘贴
                  </button>
                </div>
              ) : null}

              {isEdit && skill ? (
                <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                  当前状态：{skill.status === 'active' ? '已启用' : '已停用'}。
                  启停请使用列表中的「启用 / 停用」操作，本表单不改变技能状态。
                </p>
              ) : null}
            </>
          )}
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

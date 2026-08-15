/**
 * 技能创建 / 编辑表单（UI#1 #7，§4.3 #4 建 / #5 改；本期增强 B-1~B-6/B-8/B-9 + C 功能）。
 *
 * <p>校验用 **zod**（仓库已依赖 `zod@^3`，零新增）。不引 react-hook-form：
 * 本表单字段少且无强联动，用受控 state + 一次性 `safeParse` 更短也更好读。
 *
 * <p>**字段范围严格对齐 `SkillPayload`**（新增 `body`）—— 这是 §4.3 已定稿的端点签名。
 * 本期增强（B-1~B-6/B-8/B-9）：
 *   - 对话框放大为双栏（左：元数据；右：SKILL.md 正文 body），同屏编辑；
 *   - 右栏正文可编辑并提交（B-8）；
 *   - 编辑态按详情回填正文，保证与列表项（无 body）一致（B-9）；
 *   - 「粘贴 SKILL.md」模式解析后同时回填元数据与正文（粘贴解析 / 直填 / 解析后改均可）。
 *
 * <p>**C 功能（AI 对话创建 Tab）**：三栏同屏——左 `SkillFormFields`、中 SKILL.md 正文、
 * 右 `SkillBuilderPanel`；回填链路复用 `parseSkill` + `applyParsedSkill`，禁止另写解析。
 *
 * <p>`id` 仅新建时可填：它是 `ai:skill:{id}:run` 执行码的组成部分，
 * 改 id 等于让已授权的执行码全部失效，属于删旧建新而非编辑。
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Upload } from 'lucide-react';
import { SubmitButton } from '@/components/common/submit-button';
import { Button } from '@/components/ui/button';
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
  getSkill,
  parseSkill,
  updateSkill,
  type SkillPayload,
} from '../api/agent-ops-api';
import {
  chatSkillBuilder,
  createChatSession,
  sendChatMessage,
} from '../api/agent-chat-api';
import {
  agentErrorMessage,
  type Skill,
  type SkillBuilderSelection,
  type SkillDetail,
  type SkillBuilderMessage,
  type SkillBuilderChatResponse,
} from '../types';
import { SkillFormFields, fieldLabel } from './skill-form-fields';
import { SkillBuilderPanel, type StagedResult } from './skill-builder-panel';
import { SkillBuilderSelector } from './skill-builder-selector';
import {
  applyParsedSkill,
  diffHighlight,
  extractSkillMd,
} from './skill-builder-utils';

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

export type SkillFormValues = z.infer<typeof skillFormSchema>;

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

export interface AgentSkillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新建；非 null = 编辑该技能。 */
  skill: Skill | null;
  /** 保存成功回调（外层据此刷新列表与统计）。 */
  onSaved: () => void;
}

/** 两态模式：手动填写 / AI 对话创建（粘贴 SKILL.md 由「导入文件」按钮替代）。 */
type SkillFormMode = 'manual' | 'ai';

export function AgentSkillFormDialog({
  open,
  onOpenChange,
  skill,
  onSaved,
}: AgentSkillFormDialogProps) {
  const [form, setForm] = useState<SkillFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof SkillFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<SkillFormMode>('manual');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** SKILL.md 正文（右栏可编辑，B-8）。 */
  const [body, setBody] = useState('');
  const isEdit = skill !== null;

  // —— AI 对话创建（C）相关 state（对话框持有：切 Tab 不丢上下文，关闭即清，满足 P2-3）——
  const [aiMessages, setAiMessages] = useState<SkillBuilderMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiSending, setAiSending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAutoRefill, setAiAutoRefill] = useState(false);
  /** 解析成功未回填时的暂存预览（P2-2）。 */
  const [aiStaged, setAiStaged] = useState<StagedResult | null>(null);
  /** 回填后发生变化的字段键集合（P1-3 高亮）。 */
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  /** T04：mis-admin-helper 真实会话 ID（懒创建，对话框关闭即清）。 */
  const aiSessionIdRef = useRef<string | null>(null);
  /** T04：内嵌选择器开关。 */
  const [selectorOpen, setSelectorOpen] = useState(false);
  /** T04：已选技能（来自选择器，待注入下一条用户消息）。 */
  const [aiSelectedSkills, setAiSelectedSkills] = useState<SkillBuilderSelection[]>([]);

  // 每次打开按当前对象重置，避免上一次编辑的残留串进新建表单
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    setMode('manual');
    setBody('');
    setAiMessages([]);
    setAiInput('');
    setAiSending(false);
    setAiError(null);
    setAiAutoRefill(false);
    setAiStaged(null);
    setHighlight(new Set());
    // T04：清理选择器与 mis-admin-helper 会话态
    setSelectorOpen(false);
    setAiSelectedSkills([]);
    aiSessionIdRef.current = null;
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
    // B-8/B-9：编辑态按详情回填正文，保证与列表项（无 body）一致
    if (skill) {
      getSkill(skill.skill_id)
        .then((detail) => setBody((detail as SkillDetail).body ?? ''))
        .catch(() => {
          /* 正文缺失不阻断编辑 */
        });
    }
  }, [open, skill]);

  function patch(key: keyof SkillFormValues, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    // 用户手改该字段即视为接受，清除其高亮
    setHighlight((h) => {
      if (!h.has(key)) return h;
      const next = new Set(h);
      next.delete(key);
      return next;
    });
  }

  /** 1.2 导入 SKILL.md 文件：读本地文件 → 复用 parseSkill 解析 → 回填表单与正文（硬约束：禁止另写解析，仍走粘贴 Tab 同一入口）。 */
  async function handleImportFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const res = await parseSkill(text);
      const before = form;
      const result = applyParsedSkill(res.metadata ?? {}, res.body ?? '', before);
      setForm(result.form);
      setBody(result.body);
      setHighlight(diffHighlight(before, result.form));
      toast.success(`已导入并回填：${file.name}`);
    } catch (err) {
      setImportError(agentErrorMessage(err, '导入并解析 SKILL.md 失败'));
    }
  }

  /**
   * T04：把已选技能拼成"参考上下文"注入下一条用户消息（选择器产物注入）。
   * 真实正文缺失的技能占位提示，避免误导模型。
   */
  function buildSelectedSkillsContext(skills: SkillBuilderSelection[]): string {
    if (skills.length === 0) return '';
    const parts = skills.map((s, i) => {
      const body = s.body?.trim() ? s.body.trim() : '（无可用正文，仅参考名称与用途）';
      return `## 参考技能 ${i + 1}：${s.name}（${s.skill_id}）\n${body}`;
    });
    return `参考以下现有技能合并/对齐生成新 SKILL.md，避免重复定义：\n\n${parts.join('\n\n')}`;
  }

  /**
   * T04：经 `mis-admin-helper` 真实会话发送一条消息并取回助手回复文本。
   * 会话 ID 懒创建并在本对话框生命周期内复用（关闭即清，见 useEffect）。
   *
   * <p>权限边界：createChatSession("mis-admin-helper") 落 `agent:skill:manage`
   * 校验（session.py 的 require_admin_helper_access），无权限会抛错、由主链路 try 捕获后回落 ephemeral。
   */
  async function sendViaAdminHelper(text: string): Promise<string> {
    if (!aiSessionIdRef.current) {
      const session = await createChatSession('mis-admin-helper');
      aiSessionIdRef.current = session.session_id;
    }
    const reply = await sendChatMessage(aiSessionIdRef.current, text);
    return reply.content;
  }

  /**
   * C：以一条组合后的用户消息发起一轮 AI 生成。
   *
   * <p>T04（R11 裁定）主链路 = `mis-admin-helper` 真实会话（createChatSession +
   * sendChatMessage），助手回复可用运营台会话机制追溯；若真实会话不可用，
   * 回落 ephemeral `chatSkillBuilder`（设计保留 fallback，不删）。无论哪条链路，
   * AI 文本都复用 stageOrRefill → 抽取 ```SKILL.md → parseSkill → 暂存/回填。
   */
  async function dispatchAiTurn(text: string): Promise<void> {
    if (aiSending) return;
    const userMsg: SkillBuilderMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      status: 'generated',
    };
    const assistantMsg: SkillBuilderMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      status: 'generating',
    };
    setAiMessages((prev) => [...prev, userMsg, assistantMsg]);
    setAiError(null);
    setAiStaged(null);
    setAiSending(true);
    try {
      const reply = await sendViaAdminHelper(text);
      setAiMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: reply, status: 'generated' } : m)),
      );
      await stageOrRefill(reply, false);
    } catch (primaryErr) {
      // 兜底：ephemeral 端点（不依赖 mis-admin-helper 会话）
      try {
        const history = [...aiMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));
        const res: SkillBuilderChatResponse = await chatSkillBuilder({
          messages: history,
          user_input: text,
          converged: false,
        });
        setAiMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: res.reply, status: res.status, converged: res.converged }
              : m,
          ),
        );
        await stageOrRefill(res.reply, res.converged);
      } catch (e) {
        setAiMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: agentErrorMessage(e, 'AI 生成失败'), status: 'error' }
              : m,
          ),
        );
        setAiError(agentErrorMessage(primaryErr, 'AI 生成失败（真实会话不可用，兜底也失败）'));
      }
    } finally {
      setAiSending(false);
    }
  }

  /** C：发送 AI 对话（把已选技能注入为上下文）。 */
  async function handleAiSend(): Promise<void> {
    const text = aiInput.trim();
    if (!text || aiSending) return;
    setAiInput('');
    const ctx = buildSelectedSkillsContext(aiSelectedSkills);
    const combined = ctx ? `${text}\n\n${ctx}` : text;
    await dispatchAiTurn(combined);
  }

  /**
   * C：抽取 + 解析 + 回填/暂存。唯一权威抽取正则见 skill-builder-utils.extractSkillMd；
   * 解析复用粘贴 Tab 同一函数 parseSkill（硬约束 C：禁止为 C 另写解析）。
   */
  async function stageOrRefill(reply: string, converged: boolean): Promise<void> {
    const skillMd = extractSkillMd(reply) ?? reply;
    if (!skillMd.trim()) {
      setAiError('AI 未返回可解析的 SKILL.md，请调整描述后重试。');
      return;
    }
    try {
      const parsed = await parseSkill(skillMd);
      const before = form;
      const result = applyParsedSkill(parsed.metadata ?? {}, parsed.body ?? '', before);
      if (aiAutoRefill) {
        setForm(result.form);
        setBody(result.body);
        setHighlight(diffHighlight(before, result.form));
        toast.success('已自动回填字段');
      } else {
        setAiStaged({ skillMd, meta: parsed.metadata ?? {}, body: parsed.body ?? '', converged });
      }
    } catch (e) {
      setAiError(agentErrorMessage(e, '解析 SKILL.md 失败'));
    }
  }

  /** C：用户点「回填到表单」→ 写回 form + body + 计算高亮。 */
  function handleAiRefill(): void {
    if (!aiStaged) return;
    const before = form;
    const result = applyParsedSkill(aiStaged.meta, aiStaged.body, before);
    setForm(result.form);
    setBody(result.body);
    setHighlight(diffHighlight(before, result.form));
    setAiStaged(null);
    setAiError(null);
    toast.success('已回填字段');
  }

  /** C：放弃暂存预览。 */
  function handleAiDiscard(): void {
    setAiStaged(null);
  }

  // —— T04：内嵌选择器回调（不离开创建流）——
  /** 选择器确认回写已选技能。 */
  function handleSkillsSelected(skills: SkillBuilderSelection[]): void {
    setAiSelectedSkills(skills);
    setSelectorOpen(false);
  }
  /** 移除某个已选技能。 */
  function handleRemoveSelected(skillId: string): void {
    setAiSelectedSkills((prev) => prev.filter((s) => s.skill_id !== skillId));
  }
  /** 清空已选技能。 */
  function handleClearSelected(): void {
    setAiSelectedSkills([]);
  }
  /** 用已选技能作为上下文发起生成（注入下一条用户消息，走主链路）。 */
  async function handleGenerateWithSelected(): Promise<void> {
    if (aiSelectedSkills.length === 0 || aiSending) return;
    const ctx = buildSelectedSkillsContext(aiSelectedSkills);
    const text = aiInput.trim() || '请基于上述参考技能生成一个新的、不重复的 SKILL.md。';
    const combined = `${text}\n\n${ctx}`;
    setAiInput('');
    await dispatchAiTurn(combined);
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
      // B-8：正文随元数据一并下发（custom 技能落盘 SKILL.md）
      body: body || undefined,
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

  const tabs: Array<{ key: SkillFormMode; label: string }> = [
    { key: 'manual', label: '手动填写' },
    { key: 'ai', label: 'AI 对话创建' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('max-h-[88vh]', mode === 'ai' ? 'max-w-6xl' : 'max-w-4xl')}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑技能' : '新建技能'}</DialogTitle>
        </DialogHeader>

        {/* 模式切换：手动填写 / AI 对话创建 */}
        <div className="flex gap-1 rounded-md border bg-muted/40 p-1 text-sm">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={cn(
                'flex-1 rounded px-3 py-1.5 font-medium',
                mode === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/*
          手动：双栏（左元数据 + 导入 / 右正文）
          AI：三栏（左元数据 / 中正文 / 右对话）
        */}
        <div
          className={cn(
            'mt-4 grid max-h-[60vh] grid-cols-1 gap-4 overflow-auto pr-1',
            mode === 'ai' ? 'lg:grid-cols-3' : 'md:grid-cols-2',
          )}
        >
          {/* 左栏：元数据 */}
          <div className="space-y-3">
            {mode === 'ai' ? (
              <SkillFormFields
                form={form}
                errors={errors}
                highlight={highlight}
                isEdit={isEdit}
                onChange={patch}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.markdown,.txt"
                    className="hidden"
                    onChange={(e) => void handleImportFile(e)}
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-1 h-4 w-4" />
                    导入 SKILL.md 文件
                  </Button>
                  {importError ? (
                    <span className="text-xs text-destructive">{importError}</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  支持带 YAML Front Matter 的 SKILL.md；导入成功后将自动回填字段与正文。
                  无 Front Matter 时原样作为正文。
                </p>
                <SkillFormFields
                  form={form}
                  errors={errors}
                  highlight={highlight}
                  isEdit={isEdit}
                  onChange={patch}
                />
              </>
            )}
          </div>

          {/* 中栏（仅 AI）/ 右栏（手动）：SKILL.md 正文 */}
          {mode === 'ai' ? (
            <div className="flex min-h-0 flex-col gap-2">
              <label className={fieldLabel} htmlFor="skill-body-ai">
                SKILL.md 正文（由 AI 回填，可编辑）
              </label>
              <Textarea
                id="skill-body-ai"
                className="min-h-[18rem] flex-1 font-mono text-xs"
                value={body}
                placeholder={'AI 回填后在此展示 / 可继续编辑技能的执行说明…'}
                onChange={(e) => setBody(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                点右侧示例模板起手；生成内容经解析后回填左侧字段与本正文。
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className={fieldLabel} htmlFor="skill-body">
                SKILL.md 正文（body）
              </label>
              <Textarea
                id="skill-body"
                className="min-h-[18rem] flex-1 font-mono text-xs"
                value={body}
                placeholder={'在此编写技能的执行说明 / 提示词正文…\n支持 Markdown。'}
                onChange={(e) => setBody(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                新建 / 编辑 custom 技能时随元数据一并保存（落盘到
                <code className="mx-1 rounded bg-muted px-1">
                  {'{SKILL_CUSTOM_STORE_DIR}/{skill_id}/SKILL.md'}
                </code>
                ）。文档型技能（handler 留空）靠正文做语义检索与上下文注入。
              </p>
            </div>
          )}

          {/* 右栏（仅 AI）：对话面板 */}
          {mode === 'ai' ? (
            <div className="flex min-h-0 flex-col">
              <SkillBuilderPanel
                messages={aiMessages}
                sending={aiSending}
                input={aiInput}
                onInputChange={setAiInput}
                onSend={() => void handleAiSend()}
                autoRefill={aiAutoRefill}
                onToggleAutoRefill={setAiAutoRefill}
                error={aiError}
                staged={aiStaged}
                onRefill={handleAiRefill}
                onDiscardStaged={handleAiDiscard}
                onOpenSelector={() => setSelectorOpen(true)}
                selectedSkills={aiSelectedSkills}
                onRemoveSelected={handleRemoveSelected}
                onGenerateWithSelected={() => void handleGenerateWithSelected()}
                onClearSelected={handleClearSelected}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="justify-center">
          <SubmitButton loading={saving} onClick={() => void onSubmit()}>
            保存
          </SubmitButton>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>

        {/* T04：内嵌技能选择器（不离开创建流，挂在对话框内作为嵌套 Dialog） */}
        <SkillBuilderSelector
          open={selectorOpen}
          onOpenChange={setSelectorOpen}
          onConfirm={handleSkillsSelected}
        />
      </DialogContent>
    </Dialog>
  );
}

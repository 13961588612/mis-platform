/**
 * 技能元数据表单字段组件（A/B/C 三 Tab 共用）。
 *
 * <p>从 `agent-skill-form-dialog.tsx` 抽出的左栏「元数据」字段，保证手动填写、
 * 粘贴回填、AI 对话创建三处复用同一套表单与校验提示。回填后命中的字段会以
 * 高亮样式（ring）呈现（P1-3 变更高亮），由 `highlight` 控制。
 *
 * <p>本组件只负责渲染与向上回调 `onChange`，所有 state 归对话框所有。
 */
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { SkillFormValues } from './agent-skill-form-dialog';

/** 字段标签通用样式（导出供对话框复用，避免重复定义）。 */
export const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

export interface SkillFormFieldsProps {
  form: SkillFormValues;
  errors: Partial<Record<keyof SkillFormValues, string>>;
  highlight: Set<string>;
  isEdit: boolean;
  onChange: (key: keyof SkillFormValues, value: string) => void;
}

/** 命中高亮字段时叠加的 ring 样式。 */
const HIGHLIGHT_CLASS = 'ring-2 ring-amber-400/70 border-amber-400/70';

/**
 * 六字段元数据表单（id / name / description / category / tags / handler）。
 */
export function SkillFormFields({
  form,
  errors,
  highlight,
  isEdit,
  onChange,
}: SkillFormFieldsProps) {
  return (
    <div className="space-y-3">
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
          className={cn(highlight.has('id') ? HIGHLIGHT_CLASS : '')}
          onChange={(e) => onChange('id', e.target.value)}
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
          className={cn(highlight.has('name') ? HIGHLIGHT_CLASS : '')}
          onChange={(e) => onChange('name', e.target.value)}
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
          className={cn(highlight.has('description') ? HIGHLIGHT_CLASS : '')}
          onChange={(e) => onChange('description', e.target.value)}
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
          className={cn(highlight.has('category') ? HIGHLIGHT_CLASS : '')}
          onChange={(e) => onChange('category', e.target.value)}
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
          className={cn(highlight.has('tags') ? HIGHLIGHT_CLASS : '')}
          onChange={(e) => onChange('tags', e.target.value)}
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
          className={cn(highlight.has('handler') ? HIGHLIGHT_CLASS : '')}
          onChange={(e) => onChange('handler', e.target.value)}
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
    </div>
  );
}

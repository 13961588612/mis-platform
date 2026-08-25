/**
 * A2uiText — A2UI 基础 `text` 组件（T06''）。
 *
 * <p>原生渲染 Gateway 下发的纯文本节点，按 `variant` 区分展示形态：
 * - `heading`：标题（加粗、较大字号）
 * - `body`：正文段落（默认）
 * - `muted`：次要说明文字（小号、弱化色）
 *
 * <p>`type` 字段兼容（`MessageProcessor.normalizeComponentNode` 已将 AG-UI 风格的
 * `type` 映射为 `component`，故此处仅消费 `component: 'text'`）。文本内容优先取
 * `content`，回落 `text` / `label` / `value`，保证不同下发口径均可渲染。
 */

import { cn } from '@/lib/utils';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

/** 渲染文本取值（多口径兼容）。 */
function resolveText(props: Record<string, unknown>): string {
  const raw = props.content ?? props.text ?? props.label ?? props.value ?? '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (raw == null) return '';
  try {
    return JSON.stringify(raw);
  } catch {
    return '';
  }
}

export function A2uiText({ props }: A2uiComponentProps) {
  const variant = typeof props.variant === 'string' ? (props.variant as string) : 'body';
  const text = resolveText(props);
  const className = typeof props.className === 'string' ? (props.className as string) : '';

  if (text.length === 0) return null;

  if (variant === 'heading') {
    const level = typeof props.level === 'number' ? (props.level as number) : 3;
    const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(Math.max(level, 1), 6) - 1];
    return (
      <Tag
        className={cn(
          'font-semibold leading-snug text-foreground',
          level <= 2 ? 'text-lg' : 'text-base',
          className,
        )}
      >
        {text}
      </Tag>
    );
  }

  if (variant === 'muted') {
    return (
      <p className={cn('text-xs leading-relaxed text-muted-foreground', className)}>{text}</p>
    );
  }

  return (
    <p className={cn('text-sm leading-relaxed text-foreground break-words', className)}>{text}</p>
  );
}

export default A2uiText;

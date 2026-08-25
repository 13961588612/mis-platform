/**
 * A2uiText — A2UI 基础 `text` 组件。
 *
 * <p>LLM 常把整段 Markdown（含 ``#`` 标题与 ``kb-sources`` 围栏）塞进 text 节点。
 * 若按纯文本 ``<p>`` 渲染会出现「# 字面量 + JSON 裸露」。对含 Markdown / 来源
 * 围栏的正文改走 {@link MarkdownView} + {@link splitKbSources}（与气泡一致）。
 *
 * <p>在 Copilot「host」模式下，来源统一由气泡底部 {@link KbChatSourceList} 渲染；
 * 本组件只出正文，并把静态「条款来源」占位隐藏，避免无法展开的死文案。
 */

import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/common/markdown-view';
import {
  KbChatSourceFigures,
  KbChatSourceList,
  isStaticKbSourceStub,
  parseStaticKbSourceStub,
  splitKbSources,
} from '@/components/common/kb-chat-sources';
import { useKbSourceHostMode } from '@/components/common/kb-source-host-context';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

/** 渲染文本取值（多口径兼容）。 */
function resolveText(props: Record<string, unknown>): string {
  const raw = props.content ?? props.text ?? props.label ?? props.value ?? '';
  if (typeof raw === 'string') return normalizeNewlines(raw);
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (raw == null) return '';
  try {
    return normalizeNewlines(JSON.stringify(raw));
  } catch {
    return '';
  }
}

/** 流式/JSON 往返后常见字面 ``\\n`` → 真换行（否则 ATX 标题与围栏匹配失败）。 */
export function normalizeNewlines(text: string): string {
  if (!text) return text;
  let out = text.replace(/\r\n/g, '\n');
  // 几乎没有真换行、却大量出现字面 \n 时再替换（避免误伤合法反斜杠路径）
  const realNl = (out.match(/\n/g) ?? []).length;
  const litNl = (out.match(/\\n/g) ?? []).length;
  if (litNl > 0 && litNl >= realNl) {
    out = out.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  return out;
}

/** 是否应按 Markdown + 来源折叠渲染（短标签/按钮文案保持纯文本）。 */
function looksLikeMarkdown(text: string): boolean {
  if (text.length < 8) return false;
  if (/```\s*kb-sources\b/i.test(text) || /\n来源：\s*\n/.test(text)) return true;
  if (/^#{1,6}\s+\S/m.test(text)) return true;
  if (/^\s*[-*+]\s+\S/m.test(text) || /^\s*\d+\.\s+\S/m.test(text)) return true;
  if (/\*\*[^*\n]+\*\*/.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text)) return true;
  return text.includes('\n') && text.length > 40;
}

export function A2uiText({ props }: A2uiComponentProps) {
  const hostMode = useKbSourceHostMode();
  const variant = typeof props.variant === 'string' ? (props.variant as string) : 'body';
  const text = resolveText(props);
  const className = typeof props.className === 'string' ? (props.className as string) : '';

  if (text.length === 0) return null;

  // 静态「条款来源 / 来源文档」：host 模式交给气泡底部折叠列表；否则本地可展开
  if (isStaticKbSourceStub(text)) {
    if (hostMode === 'host') return null;
    const stubSources = parseStaticKbSourceStub(text);
    if (stubSources.length === 0) return null;
    return (
      <div className={cn('w-full min-w-0', className)}>
        <KbChatSourceList sources={stubSources} />
      </div>
    );
  }

  // 长 Markdown / 带来源：与聊天气泡同一套渲染
  if (variant === 'body' && looksLikeMarkdown(text)) {
    const { body, sources } = splitKbSources(text);
    const showInlineSources = hostMode !== 'host' && sources.length > 0;
    if (!body.trim() && !showInlineSources) return null;
    return (
      <div className={cn('w-full min-w-0 space-y-1', className)}>
        {body.trim() ? (
          <MarkdownView content={body} className="prose prose-sm max-w-none dark:prose-invert" />
        ) : null}
        {showInlineSources ? (
          <>
            <KbChatSourceFigures sources={sources} />
            <KbChatSourceList sources={sources} />
          </>
        ) : null}
      </div>
    );
  }

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
    <p className={cn('text-sm leading-relaxed text-foreground break-words whitespace-pre-wrap', className)}>
      {text}
    </p>
  );
}

export default A2uiText;

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * 通用 Markdown 渲染（与 shadcn prose 对齐；流式累积文本也可直接传入）。
 *
 * <p>纯展示组件、无领域逻辑，置于 components/common 供各 feature 复用
 * （避免 AI 与知识库之间形成跨 feature 依赖，见架构军规1）。
 */
export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed break-words',
        '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:ml-4 [&_li]:list-disc',
        '[&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_code]:text-[0.8rem] [&_a]:text-primary [&_a]:underline',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

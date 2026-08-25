import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * 通用 Markdown 渲染（与 shadcn prose 对齐；流式累积文本也可直接传入）。
 *
 * <p>纯展示组件、无领域逻辑，置于 components/common 供各 feature 复用
 * （避免 AI 与知识库之间形成跨 feature 依赖，见架构军规1）。
 * 不依赖 @tailwindcss/typography：自带标题/列表样式，避免 prose 未启用时标题像纯文本。
 */
export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full text-sm leading-relaxed break-words',
        '[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:leading-snug',
        '[&_h2]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_h4]:mb-1 [&_h4]:mt-1.5 [&_h4]:text-sm [&_h4]:font-medium',
        '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:ml-4',
        '[&_ul>li]:list-disc [&_ol>li]:list-decimal',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        // pre 默认 white-space:pre 不换行，长 JSON/单行会撑破会话详情等窄容器
        '[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words',
        '[&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_code]:break-words [&_code]:text-[0.8rem] [&_a]:text-primary [&_a]:underline',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

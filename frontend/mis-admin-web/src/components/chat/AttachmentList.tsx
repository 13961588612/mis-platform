/**
 * AttachmentList — 消息内附件渲染（历史恢复 / 已发送消息展示，P0-1 / P0-2）。
 *
 * <p>图片类型渲染缩略图（点击新标签打开 BFF 同源代理 url）；其它类型渲染文件卡片
 * （图标 + 文件名 + 大小，可点击下载）。与待发送 {@link AttachmentChips} 区分：
 * 此处只读展示、不可删除。
 */

import { FileText, FileType, FileSpreadsheet, Image as ImageIcon, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { attachmentIcon, formatFileSize, type AttachmentIconName } from '@/lib/chat/attachment-upload';
import type { Attachment } from '@/lib/chat/types';

const ICONS: Record<AttachmentIconName, typeof FileText> = {
  image: ImageIcon,
  'file-text': FileText,
  'file-spreadsheet': FileSpreadsheet,
  'file-type': FileType,
  file: Paperclip,
};

export interface AttachmentListProps {
  attachments: Attachment[];
  className?: string;
}

export function AttachmentList({ attachments, className }: AttachmentListProps) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {attachments.map((att, index) => {
        const Icon = ICONS[attachmentIcon(att)];
        const isImage = att.mimeType.startsWith('image/');
        const href = att.url || '#';
        return (
          <a
            key={`${att.fileId}-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-[14rem] items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs hover:bg-muted/60"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-background text-muted-foreground">
              {isImage ? (
                <img src={att.url} alt={att.name} className="h-8 w-8 object-cover" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground" title={att.name}>
                {att.name}
              </div>
              <div className="text-[11px] text-muted-foreground">{formatFileSize(att.size)}</div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export default AttachmentList;

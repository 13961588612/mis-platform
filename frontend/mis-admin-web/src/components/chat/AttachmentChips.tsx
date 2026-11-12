/**
 * AttachmentChips — 待发送附件 chip 列表（P0-1）。
 *
 * <p>两个业务壳（CopilotPanel / ai-chat-panel）共用：文件名 + 图标/缩略图 + 大小
 * + 删除按钮。图片类型额外展示缩略图（走 BFF 同源代理 url，禁止直连 ai-platform）。
 * 发送态（status='uploading'）显示占位 + spinner；失败态（status='error'）显示
 * 红色感叹号 + 重试按钮。
 */

import { FileText, FileType, FileSpreadsheet, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  attachmentIcon,
  formatFileSize,
  type AttachmentIconName,
} from '@/lib/chat/attachment-upload';
import type { Attachment } from '@/lib/chat/types';

const ICONS: Record<AttachmentIconName, typeof FileText> = {
  image: ImageIcon,
  'file-text': FileText,
  'file-spreadsheet': FileSpreadsheet,
  'file-type': FileType,
  file: Paperclip,
};

export interface AttachmentChipsProps {
  /** 待发送附件列表。 */
  attachments: Attachment[];
  /** 删除某个附件（按 fileId 或本地索引）。 */
  onRemove: (index: number) => void;
  /** 重试上传失败的附件。 */
  onRetry?: (index: number) => void;
  /** 是否禁用删除（发送中）。 */
  disabled?: boolean;
  className?: string;
}

export function AttachmentChips({
  attachments,
  onRemove,
  onRetry,
  disabled,
  className,
}: AttachmentChipsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {attachments.map((att, index) => {
        const Icon = ICONS[attachmentIcon(att)];
        const isImage = att.mimeType.startsWith('image/');
        const showThumb = isImage && att.status === 'done';
        return (
          <div
            key={`${att.fileId}-${index}`}
            className={cn(
              'group flex max-w-[14rem] items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs',
              att.status === 'error' && 'border-destructive/50',
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
              {showThumb ? (
                <img src={att.url} alt={att.name} className="h-8 w-8 object-cover" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground" title={att.name}>
                {att.name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {att.status === 'uploading'
                  ? '上传中…'
                  : att.status === 'error'
                    ? '上传失败'
                    : formatFileSize(att.size)}
              </div>
            </div>
            {att.status === 'error' && onRetry ? (
              <button
                type="button"
                aria-label="重试上传"
                className="shrink-0 rounded p-0.5 text-destructive hover:bg-destructive/10"
                onClick={() => onRetry(index)}
              >
                重试
              </button>
            ) : (
              <button
                type="button"
                aria-label="移除附件"
                disabled={disabled}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                onClick={() => onRemove(index)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AttachmentChips;

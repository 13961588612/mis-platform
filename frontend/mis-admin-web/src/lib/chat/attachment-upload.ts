/**
 * attachment-upload — Copilot 附件上传工具（P0-1「先传后引」）。
 *
 * <p>职责（chat-core，无新增依赖，原生 fetch/axios + multipart）：
 * - {@link uploadAttachment}：调 BFF 薄转发 `POST /api/v1/agent-ops/files/upload`
 *   （multipart 字段名 `file`），拿回 `{fileId,name,mimeType,size,url}`。
 * - {@link validateFiles}：前端预校验类型 / 大小 / 单条数量，超限即拦截并友好提示
 *   （不下发 BFF；下游另有 `UPLOAD_MAX_BYTES` / 白名单兜底）。
 * - 下载 URL 重写为 BFF 同源代理 `/api/v1/agent-ops/files/{id}`（ai-platform 返回的
 *   `url` 是内网相对路径，禁止前端直连）。
 * - MIME → 图标映射 {@link attachmentIcon} 供 UI 展示。
 *
 * <p>设计取舍：不引入 react-dropzone，原生 dragover / onPaste / input[file] 已满足需求。
 */

import api from '@/lib/api/client';
import type { Attachment } from './types';

/** 单条消息最多附件数。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** 单文件大小上限（10MB）。 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** 允许的后缀（PRD P0-1.1 清单）。 */
const ALLOWED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'doc',
  'docx',
  'xlsx',
  'csv',
  'txt',
  'md',
]);

/** 文件校验结果。 */
export interface FileValidationResult {
  /** 通过校验、可上传的文件。 */
  valid: File[];
  /** 被拦截的文件 + 原因（用于在 UI 提示，不下发）。 */
  rejected: Array<{ file: File; reason: string }>;
}

/** 附件上传结果（BFF 透传 ai-platform 的 data 字段）。 */
interface FileUploadData {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

/** 取文件后缀（小写，不含点）。 */
function extOf(file: File): string {
  const idx = file.name.lastIndexOf('.');
  if (idx < 0 || idx === file.name.length - 1) return '';
  return file.name.slice(idx + 1).toLowerCase();
}

/** 把 ai-platform 内网相对 url 重写成 BFF 同源代理路径。 */
function rewriteUrl(url: string | undefined, fileId: string): string {
  if (url && url.startsWith('/api/v1/agent-ops/files/')) {
    return url;
  }
  return `/api/v1/agent-ops/files/${fileId}`;
}

/**
 * 前端预校验：类型白名单 + 大小上限。
 *
 * <p>不在此做「单条消息 ≤ 5 个」的数量校验——数量由调用方在选取时累计判断
 * （{@link MAX_ATTACHMENTS_PER_MESSAGE}），本函数只针对单文件本身。
 *
 * @param file 待校验文件
 * @return 通过 / 拦截原因
 */
export function validateFile(file: File): { ok: true } | { ok: false; reason: string } {
  const ext = extOf(file);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `不支持的格式：.${ext || '未知'}（仅允许图片/文档/文本）` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, reason: `文件过大：${mb}MB（上限 ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB）` };
  }
  if (file.size === 0) {
    return { ok: false, reason: '文件为空' };
  }
  return { ok: true };
}

/**
 * 批量校验（多文件选取 / 拖拽 / 粘贴共用）。
 *
 * @param files 原始文件列表
 * @return 通过列表 + 被拦截（文件,原因）列表
 */
export function validateFiles(files: File[]): FileValidationResult {
  const valid: File[] = [];
  const rejected: Array<{ file: File; reason: string }> = [];
  for (const file of files) {
    const result = validateFile(file);
    if (result.ok) {
      valid.push(file);
    } else {
      rejected.push({ file, reason: result.reason });
    }
  }
  return { valid, rejected };
}

/**
 * 上传单个附件（multipart → BFF → ai-platform）。
 *
 * @param file 已通过 {@link validateFile} 的文件
 * @return 完成态（status='done'）的 {@link Attachment}
 * @throws 上传失败（HTTP 非 0 / 网络错误），由调用方置 status='error'
 */
export async function uploadAttachment(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file);

  const res = await api.post<{ code: number; message?: string; data?: FileUploadData }>(
    '/agent-ops/files/upload',
    form,
    // 不手动设 Content-Type：axios 对 FormData 会自动带 boundary，
    // 显式写 multipart/form-data 会丢失分隔符导致后端解析失败。
  );

  if (res.data.code !== 0 || !res.data.data) {
    throw new Error(res.data.message || '附件上传失败');
  }
  const data = res.data.data;
  return {
    fileId: data.fileId,
    name: data.name || file.name,
    mimeType: data.mimeType || file.type || 'application/octet-stream',
    size: data.size ?? file.size,
    url: rewriteUrl(data.url, data.fileId),
    status: 'done',
  };
}

/** 附件展示图标（lucide 组件名，UI 层按名渲染）。 */
export type AttachmentIconName =
  | 'image'
  | 'file-text'
  | 'file-spreadsheet'
  | 'file-type'
  | 'file';

/** 按 MIME / 后缀推断展示图标。 */
export function attachmentIcon(att: Attachment): AttachmentIconName {
  const mime = att.mimeType.toLowerCase();
  const ext = extOf({ name: att.name } as File);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    return 'image';
  }
  if (ext === 'xlsx' || mime.includes('spreadsheet') || mime.includes('excel')) {
    return 'file-spreadsheet';
  }
  if (ext === 'md' || ext === 'txt' || mime.startsWith('text/')) {
    return 'file-type';
  }
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx' || mime.includes('pdf') || mime.includes('word')) {
    return 'file-text';
  }
  return 'file';
}

/** 人类可读的文件大小（如 1.2MB）。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

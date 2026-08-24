/**
 * useAttachmentComposer — 待发送附件状态管理（P0-1，两壳共用）。
 *
 * <p>管理「待发送附件」列表（本地态，上传中/完成/失败），提供：
 * - {@link addFiles}：校验 + 自动上传（先传后引），失败置 status='error'
 * - {@link removeAt}：删除
 * - {@link retryAt}：重试失败项
 * - {@link canAddMore}：是否已达单条上限（5）
 *
 * <p>上传在选取时即完成（拿回 fileId/url），发送时直接把 done 列表交给
 * {@link import('./useChat').UseChatReturn.sendMessage}。发送态/失败态在 chip 展示。
 */

import { useCallback, useRef, useState } from 'react';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  uploadAttachment,
  validateFiles,
} from './attachment-upload';
import type { Attachment } from './types';

export interface UseAttachmentComposerResult {
  /** 待发送附件（含上传中/完成/失败态）。 */
  attachments: Attachment[];
  /** 选取文件：校验 + 上传（先传后引）。 */
  addFiles: (files: File[]) => Promise<void>;
  /** 删除指定索引。 */
  removeAt: (index: number) => void;
  /** 重试上传失败的附件（重建 File 需调用方保留原始 File，这里按 index 重传保留的 FileMap）。 */
  retryAt: (index: number) => void;
  /** 是否还能继续添加。 */
  canAddMore: boolean;
  /** 是否有上传中的附件。 */
  hasUploading: boolean;
  /** 是否有失败附件。 */
  hasError: boolean;
  /** 最近一次校验被拦截的提示（UI 展示后清空）。 */
  rejectionHint: string | null;
  /** 清空（发送成功后）。 */
  clear: () => void;
  /** 显式绑定原始 File（供 UI/测试在失败重试前补存，确保 retryAt 能取回重传）。 */
  keepFile: (fileId: string, file: File) => void;
}

export function useAttachmentComposer(): UseAttachmentComposerResult {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [rejectionHint, setRejectionHint] = useState<string | null>(null);
  // fileId → 原始 File（用于失败重试，DOM File 不可序列化）。
  // 用 useRef 持久化：hook 每次渲染重建普通 Map 会丢失成功分支 set 的映射，
  // 导致 retryAt 取不到原始 File 永远停在 error 态（QA 回归发现的 P0 bug）。
  const fileMapRef = useRef<Map<string, File>>(new Map<string, File>());
  const fileMap = fileMapRef.current;
  // 同步镜像最新 attachments，供 retryAt/removeAt 同步读取（避免在 setState updater
  // 内做副作用取值，导致同步的 if (!target) 早于 updater 执行而误判 undefined）。
  const attachmentsRef = useRef<Attachment[]>(attachments);
  attachmentsRef.current = attachments;

  const canAddMore = attachments.length < MAX_ATTACHMENTS_PER_MESSAGE;

  const uploadOne = useCallback(async (file: File): Promise<Attachment> => {
    // 失败态临时键（与下方 catch 统一），先占位保留原始 File，确保失败也能取回重试。
    const pendingId = `pending-${file.name}-${file.size}`;
    // 无论成功失败都保留原始 File（DOM File 不可序列化），retryAt 据此重传。
    fileMap.set(pendingId, file);
    try {
      const att = await uploadAttachment(file);
      // 成功：用后端真实 fileId 重绑（与 pendingId 同键覆盖，保证 retryAt 命中）。
      fileMap.set(att.fileId, file);
      return att;
    } catch {
      return {
        // 失败态：fileId 用临时标记（发送前不允许下发）
        fileId: pendingId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        url: '',
        status: 'error',
      };
    }
  }, []);

  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const { valid, rejected } = validateFiles(files);
      const remaining = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
      const accepted = valid.slice(0, Math.max(0, remaining));
      const overflow = valid.length - accepted.length;
      const hints: string[] = [];
      if (rejected.length > 0) {
        hints.push(rejected.map((r) => `${r.file.name}：${r.reason}`).join('；'));
      }
      if (overflow > 0) {
        hints.push(`最多 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件，已忽略 ${overflow} 个`);
      }
      setRejectionHint(hints.length > 0 ? hints.join('；') : null);

      if (accepted.length === 0) return;
      const uploading: Attachment[] = accepted.map((f) => ({
        fileId: `pending-${f.name}-${f.size}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        size: f.size,
        url: '',
        status: 'uploading',
      }));
      setAttachments((prev) => [...prev, ...uploading]);

      const results = await Promise.all(accepted.map((f) => uploadOne(f)));
      setAttachments((prev) => {
        // 用同序映射替换 uploading 占位
        let cursor = 0;
        return prev.map((a) => {
          if (a.status !== 'uploading') return a;
          const r = results[cursor++];
          return r;
        });
      });
    },
    [attachments.length, uploadOne],
  );

  const removeAt = useCallback((index: number): void => {
    setAttachments((prev) => {
      const target = prev[index];
      if (target) fileMap.delete(target.fileId);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const retryAt = useCallback(
    async (index: number): Promise<void> => {
      // 同步读取目标（用 ref 镜像，避免 setState updater 副作用取值的时序问题）
      const target = attachmentsRef.current[index];
      if (!target) return;
      setAttachments((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        next[index] = { ...target, status: 'uploading' };
        return next;
      });
      const file = fileMap.get(target.fileId);
      if (!file) {
        // 无可重试原始文件：维持失败态
        setAttachments((prev) =>
          prev.map((a, i) => (i === index ? { ...a, status: 'error' } : a)),
        );
        return;
      }
      const result = await uploadOne(file);
      setAttachments((prev) =>
        prev.map((a, i) => (i === index ? result : a)),
      );
    },
    [uploadOne],
  );

  const clear = useCallback((): void => {
    setAttachments([]);
    setRejectionHint(null);
    fileMap.clear();
  }, []);

  // 显式绑定原始 File（QA 测试 / UI 在失败重试前补存，确保 retryAt 取回重传）。
  const keepFile = useCallback((fileId: string, file: File): void => {
    fileMap.set(fileId, file);
  }, []);

  const hasUploading = attachments.some((a) => a.status === 'uploading');
  const hasError = attachments.some((a) => a.status === 'error');

  return {
    attachments,
    addFiles,
    removeAt,
    retryAt,
    canAddMore,
    hasUploading,
    hasError,
    rejectionHint,
    clear,
    keepFile,
  };
}

export default useAttachmentComposer;

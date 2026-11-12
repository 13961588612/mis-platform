// @vitest-environment jsdom
/**
 * P0-1 待发送附件状态机单测（QA 验收）。
 *
 * 覆盖 useAttachmentComposer：
 * - addFiles：校验 + 自动上传（先传后引），上传中→完成 状态流转
 * - 数量上限：超过 5 个被忽略并给出 hint
 * - removeAt：删除指定索引
 * - retryAt：失败项重试（有原始 File 则重传为 done）
 * - canAddMore / hasUploading / hasError 派生状态
 *
 * 手法：用 vi.hoisted 持有一个可变的 postImpl，vi.mock 静态 mock 底层
 * `@/lib/api/client`（attachment-upload 经它调 BFF），跑真实
 * uploadAttachment + 真实 composer 状态机。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => {
  let postImpl: (file: File) => unknown = () => ({
    code: 0,
    message: 'ok',
    data: { fileId: 'ok', name: 'x', mimeType: 'image/png', size: 1, url: '' },
  });
  const post = vi.fn(async (_path: string, form: FormData) => {
    const file = form.get('file') as unknown as File;
    return { data: postImpl(file as File) };
  });
  return {
    setImpl: (impl: (file: File) => unknown) => {
      postImpl = impl;
    },
    post,
  };
});

vi.mock('@/lib/api/client', () => ({ default: { post: h.post } }));

function makeFile(name: string, size = 1024, type = 'image/png'): File {
  const f = new File(['x'.repeat(Math.min(size, 10))], name, { type });
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
}

beforeEach(() => {
  vi.restoreAllMocks();
  h.post.mockClear();
});

describe('useAttachmentComposer addFiles 状态机', () => {
  it('合法文件：uploading → done（先传后引）', async () => {
    h.setImpl((f) => ({
      code: 0,
      message: 'ok',
      data: {
        fileId: `ok-${f.name}`,
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        size: f.size,
        url: '/api/v1/agent-ops/files/ok',
      },
    }));
    const { useAttachmentComposer } = await import('./useAttachmentComposer');

    const { result } = renderHook(() => useAttachmentComposer());
    await act(async () => {
      await result.current.addFiles([makeFile('a.png')]);
    });

    await waitFor(() => {
      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].status).toBe('done');
      expect(result.current.hasUploading).toBe(false);
    });
  });

  it('上传失败：维持 error 态（fileId 临时标记）', async () => {
    h.setImpl(() => ({ code: 1, message: '拒绝' }));
    const { useAttachmentComposer } = await import('./useAttachmentComposer');

    const { result } = renderHook(() => useAttachmentComposer());
    await act(async () => {
      await result.current.addFiles([makeFile('bad.png')]);
    });

    await waitFor(() => {
      expect(result.current.attachments[0].status).toBe('error');
      expect(result.current.attachments[0].fileId.startsWith('pending-')).toBe(true);
      expect(result.current.hasError).toBe(true);
    });
  });

  it('超过 5 个被忽略并给出 rejectionHint', async () => {
    h.setImpl((f) => ({
      code: 0,
      message: 'ok',
      data: {
        fileId: `ok-${f.name}`,
        name: f.name,
        mimeType: f.type,
        size: f.size,
        url: '',
      },
    }));
    const { useAttachmentComposer } = await import('./useAttachmentComposer');

    const { result } = renderHook(() => useAttachmentComposer());
    const many = Array.from({ length: 8 }, (_, i) => makeFile(`f${i}.png`));
    await act(async () => {
      await result.current.addFiles(many);
    });

    await waitFor(() => {
      expect(result.current.attachments).toHaveLength(5);
      expect(result.current.canAddMore).toBe(false);
      expect(result.current.rejectionHint).toContain('最多 5 个');
    });
  });
});

describe('useAttachmentComposer removeAt / retryAt', () => {
  it('removeAt 删除指定索引', async () => {
    h.setImpl((f) => ({
      code: 0,
      message: 'ok',
      data: {
        fileId: `ok-${f.name}`,
        name: f.name,
        mimeType: f.type,
        size: f.size,
        url: '',
      },
    }));
    const { useAttachmentComposer } = await import('./useAttachmentComposer');

    const { result } = renderHook(() => useAttachmentComposer());
    await act(async () => {
      await result.current.addFiles([makeFile('a.png'), makeFile('b.png')]);
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(2));

    act(() => {
      result.current.removeAt(0);
    });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe('b.png');
  });

  // ⚠ 已知源码缺陷（P0-1）：fileMap 在 hook 体内 new Map() 每次渲染重建，
  // 且 keepFile 在业务中从未被调用 → 失败上传的原始 File 无法在 retryAt 时取回，
  // fileMap.get 恒为 undefined → 永远停在 error。本用例断言「正确行为」，
  // 当前会失败，作为路由 Engineer 的缺陷证据（非测试构造问题）。
  it('retryAt：有原始 File 则重传为 done', async () => {
    let call = 0;
    h.setImpl((f) => {
      call += 1;
      if (call === 1 && f.name === 'retry.png') {
        return { code: 1, message: '首次失败' };
      }
      return {
        code: 0,
        message: 'ok',
        data: {
          fileId: `ok-${f.name}`,
          name: f.name,
          mimeType: f.type,
          size: f.size,
          url: '',
        },
      };
    });
    const { useAttachmentComposer } = await import('./useAttachmentComposer');

    const { result } = renderHook(() => useAttachmentComposer());
    await act(async () => {
      await result.current.addFiles([makeFile('retry.png')]);
    });
    await waitFor(() => expect(result.current.attachments[0].status).toBe('error'));
    const errFileId = result.current.attachments[0].fileId;

    // 绑定原始 File 以便重试（用真实 error fileId 作为 key）
    act(() => {
      result.current.keepFile(errFileId, makeFile('retry.png'));
    });
    // 触发重试：retryAt 为异步，post-await 的 setState 在微任务中落地
    await act(async () => {
      void result.current.retryAt(0);
      // 让出事件循环，等待 uploadOne 完成 + 最终 setState 生效
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(result.current.attachments[0].status).toBe('done');
  });
});

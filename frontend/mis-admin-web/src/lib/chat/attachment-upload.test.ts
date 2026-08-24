/**
 * P0-1 附件上传工具单测（QA 验收）。
 *
 * 覆盖：
 * - 白名单校验（md/gif/webp/image 系列/pdf/txt/csv/json/office 等）
 * - 大小上限（>10MB 拦截）/ 空文件拦截
 * - 单条消息数量上限常量（MAX_ATTACHMENTS_PER_MESSAGE = 5）
 * - 批量校验 valid/rejected 分流
 * - uploadAttachment 把 ai-platform 内网 url 重写为 BFF 同源代理
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  validateFile,
  validateFiles,
  uploadAttachment,
  attachmentIcon,
  formatFileSize,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_FILE_SIZE_BYTES,
} from './attachment-upload';

/** 可变 postImpl，供 uploadAttachment 测试切换成功/失败。 */
const up = vi.hoisted(() => {
  let postImpl: () => unknown = () => ({
    code: 0,
    message: 'ok',
    data: {
      fileId: 'f-123',
      name: 's.png',
      mimeType: 'image/png',
      size: 2048,
      url: '/api/v1/files/f-123',
    },
  });
  const post = vi.fn(async () => ({ data: postImpl() }));
  return {
    setImpl: (i: () => unknown) => {
      postImpl = i;
    },
    post,
  };
});

vi.mock('@/lib/api/client', () => ({ default: { post: up.post } }));

/** 构造一个内存 File 桩（测试环境无真实 File 实现细节依赖）。 */
function makeFile(name: string, size: number, type = ''): File {
  const f = new File(['x'.repeat(Math.min(size, 10))], name, { type });
  // File.size 在部分环境只读，这里用 Object.defineProperty 覆盖以便断言
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('validateFile 白名单 + 大小', () => {
  const allowed = ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp', 'f.pdf', 'g.doc', 'h.docx', 'i.xlsx', 'j.csv', 'k.txt', 'l.md'];
  for (const name of allowed) {
    it(`允许白名单类型：${name}`, () => {
      const r = validateFile(makeFile(name, 1024));
      expect(r.ok).toBe(true);
    });
  }

  it('拒绝不在白名单的后缀（如 exe/zip）', () => {
    const r = validateFile(makeFile('virus.exe', 1024));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不支持的格式');
  });

  it('拒绝无后缀文件', () => {
    const r = validateFile(makeFile('noext', 1024));
    expect(r.ok).toBe(false);
  });

  it('拒绝超过 10MB 的文件', () => {
    const r = validateFile(makeFile('big.png', MAX_FILE_SIZE_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('文件过大');
  });

  it('拒绝刚好 10MB 的边界（不拦截）', () => {
    const r = validateFile(makeFile('edge.png', MAX_FILE_SIZE_BYTES));
    expect(r.ok).toBe(true);
  });

  it('拒绝空文件（size=0）', () => {
    const r = validateFile(makeFile('empty.txt', 0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('文件为空');
  });
});

describe('validateFiles 批量分流', () => {
  it('将合法/非法分离到 valid/rejected', () => {
    const files = [
      makeFile('ok.png', 1024),
      makeFile('bad.exe', 1024),
      makeFile('big.pdf', MAX_FILE_SIZE_BYTES + 1),
    ];
    const { valid, rejected } = validateFiles(files);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].file.name).toBe('bad.exe');
  });
});

describe('数量上限常量', () => {
  it('MAX_ATTACHMENTS_PER_MESSAGE === 5', () => {
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(5);
  });
  it('MAX_FILE_SIZE_BYTES === 10MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('uploadAttachment URL 重写', () => {
  it('把 ai-platform 内网 url 重写为 BFF 同源代理 /api/v1/agent-ops/files/{id}', async () => {
    up.setImpl(() => ({
      code: 0,
      message: 'ok',
      data: {
        fileId: 'f-123',
        name: 's.png',
        mimeType: 'image/png',
        size: 2048,
        url: '/api/v1/files/f-123',
      },
    }));
    const att = await uploadAttachment(makeFile('s.png', 2048, 'image/png'));
    expect(att.fileId).toBe('f-123');
    expect(att.url).toBe('/api/v1/agent-ops/files/f-123');
    expect(att.status).toBe('done');
  });

  it('下游 code != 0 时抛错（交由调用方置 error 态）', async () => {
    up.setImpl(() => ({ code: 1, message: '拒绝' }));
    await expect(uploadAttachment(makeFile('s.png', 2048))).rejects.toThrow('拒绝');
  });
});

describe('attachmentIcon / formatFileSize', () => {
  it('image 类返回 image 图标', () => {
    expect(attachmentIcon({ mimeType: 'image/png', name: 'a.png' } as never)).toBe('image');
  });
  it('xlsx 返回 file-spreadsheet', () => {
    expect(attachmentIcon({ mimeType: 'application/vnd.ms-excel', name: 'a.xlsx' } as never)).toBe('file-spreadsheet');
  });
  it('md/txt 返回 file-type', () => {
    expect(attachmentIcon({ mimeType: 'text/markdown', name: 'a.md' } as never)).toBe('file-type');
  });
  it('formatFileSize 人类可读', () => {
    expect(formatFileSize(512)).toBe('512B');
    expect(formatFileSize(2048)).toBe('2.0KB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0MB');
  });
});

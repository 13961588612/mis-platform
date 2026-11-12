import { describe, expect, it, vi, beforeEach } from 'vitest';
import { appendTranscript, mapMicError, transcribeSpeech } from './speech-transcribe';

const post = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({ default: { post } }));

describe('appendTranscript', () => {
  it('空输入直接用识别结果', () => {
    expect(appendTranscript('', ' 朝阳店日报 ')).toBe('朝阳店日报');
  });

  it('已有文字用空格拼接', () => {
    expect(appendTranscript('请看', '昨天销售')).toBe('请看 昨天销售');
  });
});

describe('mapMicError', () => {
  it('权限拒绝', () => {
    expect(mapMicError({ name: 'NotAllowedError', message: 'denied' })).toBe('未获得麦克风权限');
  });

  it('非安全源', () => {
    expect(mapMicError({ name: 'SecurityError', message: 'insecure' })).toContain('浏览器拦截了麦克风');
  });
});

describe('transcribeSpeech', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('成功取 text', async () => {
    post.mockResolvedValue({ data: { code: 0, data: { text: ' 周报 ' } } });
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await expect(transcribeSpeech(blob, 800)).resolves.toBe('周报');
    expect(post).toHaveBeenCalledWith('/agent-ops/speech/transcribe', expect.any(FormData));
  });

  it('业务失败抛 message', async () => {
    post.mockResolvedValue({ data: { code: 4008, message: '没有识别到文字，请再试一次' } });
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await expect(transcribeSpeech(blob, 100)).rejects.toThrow('没有识别到文字');
  });
});

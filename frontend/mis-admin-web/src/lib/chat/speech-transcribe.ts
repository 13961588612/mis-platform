/**
 * Copilot 语音转写：multipart → BFF → ai-platform ASR。
 * 不走附件上传，音频不进会话。
 */

import api from '@/lib/api/client';

export const SPEECH_MAX_SECONDS = 60;
export const SPEECH_MAX_BYTES = 2 * 1024 * 1024;

export function appendTranscript(prev: string, text: string): string {
  const t = text.trim();
  if (!t) return prev;
  const cur = prev.replace(/\s+$/, '');
  if (!cur) return t;
  return `${cur} ${t}`;
}

export function mapMicError(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '未获得麦克风权限';
  }
  if (name === 'NotFoundError') {
    return '没有找到麦克风';
  }
  if (name === 'NotSupportedError' || /getUserMedia|mediaDevices/i.test(message)) {
    return '当前浏览器无法录音';
  }
  if (/secure|insecure|https|permission/i.test(message) || name === 'SecurityError') {
    return '浏览器拦截了麦克风（内网 http://IP 时 Chrome 可能拦截，可换 https 或把本源加入不安全源白名单）';
  }
  return message || '无法开始录音';
}

export async function transcribeSpeech(blob: Blob, durationMs: number): Promise<string> {
  if (blob.size > SPEECH_MAX_BYTES) {
    throw new Error(`录音过大（上限 ${SPEECH_MAX_BYTES / 1024 / 1024}MB）`);
  }
  if (blob.size === 0) {
    throw new Error('录音为空');
  }
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `voice.${ext}`, { type: blob.type || 'audio/webm' });
  const form = new FormData();
  form.append('file', file);
  form.append('duration_ms', String(Math.round(durationMs)));

  const res = await api.post<{ code: number; message?: string; data?: { text?: string } }>(
    '/agent-ops/speech/transcribe',
    form,
  );
  if (res.data.code !== 0 || !res.data.data?.text?.trim()) {
    throw new Error(res.data.message || '没有识别到文字，请再试一次');
  }
  return res.data.data.text.trim();
}

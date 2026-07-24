/**
 * 前端脱敏工具：对传入 AI 的 selectedRows / 当前记录做兜底脱敏。
 * 注意：平台层为脱敏权威；前端仅对手机号/身份证/邮箱做最后兜底，避免明文外发。
 */

export type DesensitizeOwner = 'agent' | 'user';

const ID_RE = /\d{17}[\dXx]/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** 手机号：138****1001 */
function maskPhone(s: string): string {
  if (s.length < 7) return s;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 身份证：保留前 6 后 4，中间打码 */
function maskId(s: string): string {
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}********${s.slice(-4)}`;
}

/** 邮箱：保留首字符与域名 */
function maskEmail(s: string): string {
  const at = s.indexOf('@');
  if (at <= 1) return s;
  return `${s[0]}***${s.slice(at)}`;
}

/** 按字段名/值特征对单值脱敏 */
export function desensitizeValue(key: string, value: unknown): unknown {
  if (value == null) return value;
  const k = key.toLowerCase();
  const s = String(value);
  if (k.includes('phone') || k.includes('mobile') || k.includes('手机')) return maskPhone(s);
  if (k.includes('id_card') || k.includes('idcard') || k.includes('身份证') || ID_RE.test(s)) return maskId(s);
  if (k.includes('email') || k.includes('邮箱') || EMAIL_RE.test(s)) return maskEmail(s);
  return value;
}

/** 脱敏整条记录（仅 agent 侧前端兜底；user 侧原样返回） */
export function desensitizeRecord(
  record: Record<string, unknown>,
  owner: DesensitizeOwner = 'agent',
): Record<string, unknown> {
  if (owner !== 'agent') return record;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = desensitizeValue(k, v);
  }
  return out;
}

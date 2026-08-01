/** Agent H5（通路 B）嵌入约定：与 DEP-7 postMessage 协议对齐 */

export type AiH5ParentMessage =
  | { type: 'AUTH_TOKEN'; token: string }
  | { type: 'PAGE_CONTEXT'; context: { route: string; module: string; title?: string } };

export type AiH5ChildMessage = { type: 'AUTH_READY' };

/** 本地默认 H5 Vite 端口；生产用环境变量覆盖为 agent 子域/边缘入口 */
export function getAiH5Origin(): string {
  const fromEnv = (import.meta.env.VITE_AI_H5_ORIGIN as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://127.0.0.1:3000';
}

/** iframe 聊天地址：embed=1 启用等待父页令牌，不抢跳登录页 */
export function buildAiH5ChatUrl(origin = getAiH5Origin()): string {
  const u = new URL('/chat', origin.endsWith('/') ? origin : `${origin}/`);
  u.searchParams.set('embed', '1');
  return u.toString();
}

export function deriveModuleFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[1] : (parts[0] ?? '');
}

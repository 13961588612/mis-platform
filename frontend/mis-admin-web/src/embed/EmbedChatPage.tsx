/**
 * EmbedChatPage — /embed/chat 嵌入页（T07'）。
 *
 * <p>职责：
 * - 挂载 EmbedAuthBridge（AUTH_READY → AUTH_TOKEN / PAGE_CONTEXT）
 * - 等待 / 超时 / 拒绝错误态
 * - 鉴权通过后：hostId 前缀会话隔离 → useChat 直连 Gateway（RS256 MIS JWT）
 * - 独立最小外壳（无 admin 侧边栏 / 布局）
 *
 * <p>会话隔离（R47）：sessionId 按 hostId 分 key 存储（mis.embed.session.{hostId}），
 * 避免多宿主共用会话串扰；父页 sessionHint / 路由 :sessionId 可续接指定会话。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useChatStore } from '@/stores/chat-store';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import { EmbedAuthBridge } from './EmbedAuthBridge';
import { EmbedChatView } from './EmbedChatView';
import { useEmbedStore, type EmbedAuthState } from './embedStore';
import {
  buildEmbedSessionId,
  clearEmbedSession,
  resolveRouteSessionId,
  sanitizeHostId,
} from './embed-session';

export function EmbedChatPage() {
  const authState = useEmbedStore((s) => s.authState);
  const authError = useEmbedStore((s) => s.authError);
  const pageContext = useEmbedStore((s) => s.pageContext);
  const routeParams = useParams<{ sessionId?: string }>();

  const urlHostId = sanitizeHostId(new URLSearchParams(window.location.search).get('hostId'));
  const hostId = pageContext?.hostId || urlHostId || 'anon';
  const sessionHint = pageContext?.sessionHint ?? null;

  const [sessionId, setSessionId] = useState<string | null>(null);

  // 鉴权通过后一次性构建宿主隔离会话并注入 chat-store（useChat 据此直连 Gateway）
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const routeSid = resolveRouteSessionId(routeParams.sessionId);
    const sid = routeSid ?? buildEmbedSessionId(hostId, sessionHint);
    useChatStore.getState().setSessionId(sid);
    useChatStore.getState().setSessionState('ready');
    setSessionId(sid);
  }, [authState, hostId, sessionHint, routeParams.sessionId]);

  const handleNewSession = useCallback((): void => {
    clearEmbedSession(hostId);
    useChatStore.getState().reset();
    useSurfaceStore.getState().clear();
    const sid = buildEmbedSessionId(hostId, null);
    useChatStore.getState().setSessionId(sid);
    useChatStore.getState().setSessionState('ready');
    setSessionId(sid);
  }, [hostId]);

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <EmbedAuthBridge />
      {authState === 'authenticated' && sessionId ? (
        <EmbedChatView
          key={sessionId}
          hostId={hostId}
          sessionId={sessionId}
          onNewSession={handleNewSession}
        />
      ) : (
        <EmbedStatusView state={authState} error={authError} hostId={hostId} />
      )}
    </div>
  );
}

/** 鉴权等待 / 失败 / 超时状态视图。 */
function EmbedStatusView({
  state,
  error,
  hostId,
}: {
  state: EmbedAuthState;
  error: string | null;
  hostId: string;
}) {
  if (state === 'waiting') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在等待宿主登录态（AUTH_READY 已发出）…</p>
        <p className="text-[11px] text-muted-foreground/60">宿主：{hostId || '未指定'}</p>
      </div>
    );
  }

  const isRefreshFail = Boolean(error && error.includes('续期'));
  const title =
    state === 'timeout'
      ? '等待宿主鉴权超时'
      : isRefreshFail
        ? '需重新登录'
        : '嵌入鉴权失败';
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Alert variant="destructive" className="max-w-md rounded-md">
        <AlertTitle className="text-xs font-semibold">{title}</AlertTitle>
        <AlertDescription className="break-all text-xs">{error ?? '未知错误'}</AlertDescription>
      </Alert>
      <p className="max-w-md text-[11px] text-muted-foreground/60">
        {isRefreshFail
          ? '宿主未在时限内响应 AUTH_TOKEN_REQUEST。请在父系统重新登录后刷新本页。'
          : '请确认父页已配置 VITE_PARENT_ORIGINS（逗号分隔的父域白名单），且父页已先调 POST /api/v1/embed/identity/exchange 兑换 MIS JWT 并回传 AUTH_TOKEN。'}
        {hostId && hostId !== 'anon' ? `（宿主：${hostId}）` : null}
      </p>
    </div>
  );
}

export default EmbedChatPage;

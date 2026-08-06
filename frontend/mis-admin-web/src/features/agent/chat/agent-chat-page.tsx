/**
 * 本地对话页（UI#6，路径 `/agent/chat`，V19 菜单 `92032`）。
 *
 * <p>覆盖 §4.3 #32 建会话 / #33 发消息（两者**均已就绪**）+ #13 Agent 下拉（就绪）
 * + #29 消息回拉（就绪，**尽力而为**，见下）。
 *
 * <p>⚠️ **这是运营调试台，不是业务 Copilot**。
 * `arch/no-cross-feature` 是 error 级，本页**不 import `features/ai`** 的任何东西，
 * 对话壳由 `./chat-shell.tsx` 自建。二者定位也确实不同：
 * 业务 Copilot 面向终端用户（Markdown、引用卡片、Worker 选择），
 * 这里面向排障（看清 role / tool 调用 / 原始报错），刻意保持朴素。
 *
 * <p>**会话是懒创建的**：切换 Agent 不建会话，第一次点「发送」才调 #32。
 * 若在下拉里每选一次就建一个会话，「会话管理」页很快会被空会话淹没 ——
 * 而那些空会话还得运营手动去删。
 *
 * <p>**消息以本地乐观流为准，#29 只做尽力而为的对齐**：
 * #33 只回传"这一轮"的助手消息，中间的 tool 调用消息拿不到；
 * 因此每轮结束后再拉一次 #29 补全工具轨迹。但 #29 的权限码是 `agent:session:list`，
 * 只有 `agent:chat:use` 的用户会吃 403 —— 那属于**正常的权限差异，不是故障**，
 * 所以拉取失败只降级为「本地视图」提示，绝不打断对话、绝不弹错。
 *
 * <p>**T03 错误码对接**：发送链路上的失败统一过 `agentErrorMessage`，
 * `AI_SKILL_FORBIDDEN` → 「缺少权限码 ai:skill:{id}:run，请联系管理员」，
 * `AI_ACL_UNAVAILABLE` → 「权限服务不可用，已按最小权限拒绝」。
 * 这两类是**权限问题不是系统故障**，所以除了 toast 还在输入框上方常驻一条红条 ——
 * toast 三秒就没了，运营需要能照着上面的权限码去提工单。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, MessageSquarePlus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AgentContentState, AgentPageShell } from '../components/agent-page-shell';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { ChatShell } from './chat-shell';
import {
  createChatSession,
  listAgents,
  listSessionMessages,
  sendChatMessage,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentSummary, Session, SessionMessage } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

export function AgentChatPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [agentId, setAgentId] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  /** #29 拉取失败（多为缺 `agent:session:list`）：只提示，不当故障。 */
  const [syncBlocked, setSyncBlocked] = useState(false);

  /**
   * 本地乐观消息的自增序号。
   *
   * <p>用 ref 而不是 `Date.now()`：同一毫秒内连发两条会撞 key，React 会警告并复用
   * 错误的 DOM 节点。序号从 1 开始，配 `local-` 前缀，与服务端 id 不可能冲突。
   */
  const localSeq = useRef(0);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const list = await listAgents();
      setAgents(list);
      // 默认优先选中"运行中"的 Agent —— 选中一个已停止的再去发消息必然失败
      setAgentId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        return list.find((a) => a.state === 'running')?.id ?? list[0]?.id ?? '';
      });
    } catch (e) {
      setAgents([]);
      setAgentsError(agentErrorMessage(e, '获取 Agent 列表失败'));
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const selectedAgent = useMemo<AgentSummary | null>(
    () => agents.find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );

  /** 尽力而为地用 #29 对齐服务端消息（补 tool 轨迹）；失败只降级不报错。 */
  const syncMessages = useCallback(async (sessionId: string) => {
    try {
      const list = await listSessionMessages(sessionId);
      if (Array.isArray(list) && list.length > 0) setMessages(list);
      setSyncBlocked(false);
    } catch {
      // 403（无 agent:session:list）/ 下游未实现都走这里：保留本地流即可
      setSyncBlocked(true);
    }
  }, []);

  /** 切 Agent 等于换一个调试对象：旧会话与消息不能带过去，否则上下文错乱。 */
  function onAgentChange(nextId: string): void {
    setAgentId(nextId);
    setSession(null);
    setMessages([]);
    setSendError(null);
    setSyncBlocked(false);
  }

  /** 手动开新会话：保留当前 Agent，清空上下文。 */
  function onNewSession(): void {
    setSession(null);
    setMessages([]);
    setSendError(null);
    setSyncBlocked(false);
    setInput('');
  }

  async function handleSend(): Promise<void> {
    const content = input.trim();
    if (!content || !agentId || sending) return;

    setSending(true);
    setSendError(null);

    // ---- 第一步：确保有会话（懒创建，#32） ----
    let sid = session?.id ?? '';
    if (!sid) {
      try {
        const created = await createChatSession(agentId);
        setSession(created);
        sid = created.id;
      } catch (e) {
        const msg = agentErrorMessage(e, '创建对话会话失败');
        setSendError(msg);
        toast.error(msg);
        setSending(false);
        return;
      }
    }

    // ---- 第二步：乐观上屏用户消息，立刻清空输入框 ----
    localSeq.current += 1;
    const localUser: SessionMessage = {
      id: `local-${localSeq.current}`,
      session_id: sid,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localUser]);
    setInput('');

    // ---- 第三步：发送（#33）并回拉对齐（#29，尽力而为） ----
    try {
      const reply = await sendChatMessage(sid, content);
      setMessages((prev) => [...prev, reply]);
      await syncMessages(sid);
    } catch (e) {
      const msg = agentErrorMessage(e, '发送消息失败');
      setSendError(msg);
      toast.error(msg);
      // 回滚这条乐观消息并把草稿还给用户：留着一条"没人回"的孤儿消息更让人困惑
      setMessages((prev) => prev.filter((m) => m.id !== localUser.id));
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  const headerActions = (
    <>
      <Button size="sm" variant="outline" onClick={() => void loadAgents()} disabled={agentsLoading}>
        <RefreshCw className={cn('h-4 w-4', agentsLoading && 'animate-spin')} />
        刷新 Agent
      </Button>
      <Button size="sm" variant="outline" onClick={onNewSession} disabled={!session && messages.length === 0}>
        <MessageSquarePlus className="h-4 w-4" />
        新建会话
      </Button>
    </>
  );

  const hintParts: string[] = [];
  if (session) hintParts.push(`会话 ${session.id}`);
  else hintParts.push('尚未创建会话，发送首条消息时自动创建');
  if (syncBlocked) hintParts.push('当前仅显示本地消息流（无会话读取权限，工具调用轨迹不可见）');

  return (
    <AgentPageShell
      title="本地对话"
      description="与指定 Agent 的会话式调试。"
      permission="agent:chat:use"
      actions={headerActions}
      loading={agentsLoading && agents.length === 0}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ---------------- 顶部工具条：Agent 选择器 + 运营调试角标 ---------------- */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
          <div className="w-64">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">调试对象</label>
            <select
              className={selectClass}
              value={agentId}
              onChange={(e) => onAgentChange(e.target.value)}
              disabled={agents.length === 0}
            >
              {agents.length === 0 ? <option value="">暂无可用 Agent</option> : null}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 pb-1">
            {selectedAgent ? (
              <>
                <AgentStatusBadge kind="agentState" value={selectedAgent.state} />
                <AgentStatusBadge kind="agentRole" value={selectedAgent.role} />
                <span className="text-xs text-muted-foreground">
                  已启用技能 {selectedAgent.enabled_skill_count ?? 0}
                </span>
              </>
            ) : null}
            <Badge
              variant="warning"
              title="本页对话会真实调用所选 Agent 的模型与技能，并产生可在「会话管理」中查看的会话记录。"
            >
              运营调试
            </Badge>
          </div>

          <div className="ml-auto pb-1 text-xs text-muted-foreground">
            {messages.length > 0 ? `本轮已渲染 ${messages.length} 条消息` : '尚无消息'}
          </div>
        </div>

        {/* Agent 未运行时的前置提醒：比让用户发一条再吃报错友好 */}
        {selectedAgent && selectedAgent.state !== 'running' ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-xs text-foreground">
            <AlertTriangle className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              该 Agent 当前不是运行中状态，对话可能失败。可前往「Agent 总览」启动后再调试。
            </span>
          </div>
        ) : null}

        {/* 发送失败常驻红条：权限码类报错需要能被抄下来提工单，不能只靠 toast */}
        {sendError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
            <AlertTriangle className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="flex-1 break-words text-destructive">{sendError}</span>
            <button
              type="button"
              aria-label="关闭提示"
              className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setSendError(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {/* ---------------- 对话区：Agent 列表的三态落在这里，工具条常驻 ---------------- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentContentState
            loading={agentsLoading && agents.length === 0}
            error={agentsError}
            onRetry={() => void loadAgents()}
            empty={!agentsLoading && agentsError === null && agents.length === 0}
            emptyText="暂无可调试的 Agent"
            emptyHint="请先在「Agent 总览」中确认已有 Agent 注册并处于可用状态。"
          >
            <ChatShell
              messages={messages}
              input={input}
              onInputChange={setInput}
              onSend={() => void handleSend()}
              sending={sending}
              disabled={!agentId}
              hint={hintParts.join(' · ')}
            />
          </AgentContentState>
        </div>
      </div>
    </AgentPageShell>
  );
}

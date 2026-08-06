/**
 * Agent 详情壳（ui.md §4）：头部 + 五 Tab。
 *
 * ```text
 * 头部：display_name | role 徽章 | state 徽章 | 启停按钮
 * Tabs: 概览 | 可用技能(#5) | 人设与配置(#9) | 调度配置 C–W(#10) | 健康
 * ```
 *
 * <p>**Tab 与路由的关系**（本期只认既有 4 条路由，不新增）：
 *   - `skills` / `config` / `coordination` → `navigate()` 到 `/agent/agents/:id/{suffix}`，
 *     这三条在 V19 中是 `type=2 + visible=0` 的真实菜单节点，permission 生效；
 *   - `overview` / `health` → **纯前端内部态**，URL 停在 `/agent/agents/:id`。
 *     刻意不为它们造路由：造了就要同步改 agent-nav / keep-alive-outlet / router / V19 种子
 *     四处（§10.1 约定 2），而这两个 Tab 没有独立的权限语义，不值这个成本。
 *
 * <p>启停按钮调 #15–#18，统一包 `agent:agent:manage`（§5.3 92053），
 * 且一律走 `AgentConfirmDialog` —— 停止一个正在跑的 coordinator 会中断在途会话。
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pause, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { pauseAgent, resumeAgent, startAgent, stopAgent } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentDetail } from '../types';
import { AgentStatusBadge } from './agent-status-badge';
import { AgentConfirmDialog } from './agent-confirm-dialog';

/** 路由后缀；`''` 表示详情根路径（承载「概览」与「健康」两个内部 Tab）。 */
export type AgentDetailSuffix = '' | 'skills' | 'config' | 'coordination';

/** Tab 键：三个带路由 + 两个内部态。 */
export type AgentDetailTab = 'overview' | 'skills' | 'config' | 'coordination' | 'health';

const TAB_ITEMS: Array<{ value: AgentDetailTab; label: string }> = [
  { value: 'overview', label: '概览' },
  { value: 'skills', label: '可用技能' },
  { value: 'config', label: '人设与配置' },
  { value: 'coordination', label: '调度配置' },
  { value: 'health', label: '健康' },
];

/** 带独立路由的 Tab 集合（其余为前端内部态）。 */
const ROUTED_TABS = new Set<AgentDetailTab>(['skills', 'config', 'coordination']);

export interface AgentDetailShellProps {
  agentId: string;
  /** 详情数据；加载中可为 null，此时头部只显示 id。 */
  agent: AgentDetail | null;
  /** 当前 URL 后缀，由 `agent-detail-route.tsx` 解析后传入。 */
  suffix: AgentDetailSuffix;
  /** 启停成功后回调，供外层重新拉取详情。 */
  onStateChanged?: () => void;
  /** 按 Tab 渲染的内容。 */
  children: (tab: AgentDetailTab) => ReactNode;
}

/**
 * 启停动作定义：文案 + 接口 + 是否危险。
 *
 * <p>**T05 批 3 起对外导出**：Agent 总览列表页（`agents/agent-list-page.tsx`）
 * 的行内启停按钮必须与详情头部按同一张表决定「露出哪些动作」。
 * 各写一份的后果是两处对 `error` 态该不该给「停止」的判断悄悄分叉，
 * 而这种分叉不会报错、只会让运营在列表页点不到某个按钮。
 */
export interface LifecycleAction {
  key: 'start' | 'resume' | 'pause' | 'stop';
  label: string;
  icon: typeof Play;
  danger: boolean;
  run: (id: string) => Promise<void>;
  confirmTitle: string;
  confirmText: string;
}

const ACTIONS: Record<LifecycleAction['key'], LifecycleAction> = {
  start: {
    key: 'start',
    label: '启动',
    icon: Play,
    danger: false,
    run: startAgent,
    confirmTitle: '启动 Agent',
    confirmText: '启动后该 Agent 将开始接收调度与会话请求。',
  },
  resume: {
    key: 'resume',
    label: '恢复',
    icon: Play,
    danger: false,
    run: resumeAgent,
    confirmTitle: '恢复 Agent',
    confirmText: '恢复后该 Agent 将继续处理排队中的请求。',
  },
  pause: {
    key: 'pause',
    label: '暂停',
    icon: Pause,
    danger: false,
    run: pauseAgent,
    confirmTitle: '暂停 Agent',
    confirmText: '暂停后不再接收新请求，在途请求仍会执行完毕。',
  },
  stop: {
    key: 'stop',
    label: '停止',
    icon: Square,
    danger: true,
    run: stopAgent,
    confirmTitle: '停止 Agent',
    confirmText: '停止会中断该 Agent 的在途会话与在途调度任务，且不会自动恢复。',
  },
};

/** 依当前 state 决定露出哪些生命周期按钮（不可用的直接不渲染，不置灰）。 */
export function actionsFor(state: AgentDetail['state'] | undefined): LifecycleAction[] {
  switch (state) {
    case 'running':
      return [ACTIONS.pause, ACTIONS.stop];
    case 'paused':
      return [ACTIONS.resume, ACTIONS.stop];
    case 'stopped':
      return [ACTIONS.start];
    case 'error':
      return [ACTIONS.start, ACTIONS.stop];
    default:
      return [];
  }
}

export function AgentDetailShell({
  agentId,
  agent,
  suffix,
  onStateChanged,
  children,
}: AgentDetailShellProps) {
  const navigate = useNavigate();
  /** 详情根路径下在「概览 / 健康」之间切换用的内部态。 */
  const [rootTab, setRootTab] = useState<AgentDetailTab>('overview');
  const [pending, setPending] = useState<LifecycleAction | null>(null);

  const activeTab: AgentDetailTab = suffix === '' ? rootTab : suffix;

  const onTabChange = useCallback(
    (value: string) => {
      const next = value as AgentDetailTab;
      if (ROUTED_TABS.has(next)) {
        navigate(`/agent/agents/${encodeURIComponent(agentId)}/${next}`);
        return;
      }
      // 概览 / 健康：先把 URL 收回详情根路径，再切内部态
      setRootTab(next);
      if (suffix !== '') navigate(`/agent/agents/${encodeURIComponent(agentId)}`);
    },
    [agentId, navigate, suffix],
  );

  const lifecycleActions = useMemo(() => actionsFor(agent?.state), [agent?.state]);

  async function runPending(): Promise<void> {
    if (!pending) return;
    try {
      await pending.run(agentId);
      toast.success(`已${pending.label}`);
      setPending(null);
      onStateChanged?.();
    } catch (e) {
      toast.error(agentErrorMessage(e, `${pending.label} Agent 失败`));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate text-lg font-semibold leading-tight">
            {agent?.display_name ?? agentId}
          </h2>
          {agent ? <AgentStatusBadge kind="agentRole" value={agent.role} /> : null}
          {agent ? <AgentStatusBadge kind="agentState" value={agent.state} /> : null}
          <span className="font-mono text-xs text-muted-foreground">{agentId}</span>
        </div>
        {lifecycleActions.length > 0 ? (
          <PermissionGate permission="agent:agent:manage">
            <div className="flex items-center gap-2">
              {lifecycleActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Button
                    key={action.key}
                    size="sm"
                    variant={action.danger ? 'destructive' : 'outline'}
                    onClick={() => setPending(action)}
                  >
                    <Icon className="h-4 w-4" />
                    {action.label}
                  </Button>
                );
              })}
            </div>
          </PermissionGate>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          {TAB_ITEMS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/*
          刻意不用 <TabsContent>：三个带路由的 Tab 内容由 keep-alive 的不同页面实例承载，
          塞进 TabsContent 会让「切 Tab = 换路由 = 换实例」与 Radix 的内部显隐打架。
          这里只按 activeTab 渲染一份内容。
        */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col">{children(activeTab)}</div>
      </Tabs>

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger={pending?.danger ?? false}
        title={pending?.confirmTitle ?? ''}
        description={pending?.confirmText}
        confirmText={pending?.label ?? '确认'}
        onConfirm={runPending}
      />
    </div>
  );
}

/**
 * Agent 详情路由分发器（`/agent/agents/:id[/skills|config|coordination]`）。
 *
 * <p>承载 V19 中 `type=2 + visible=0` 的三条详情子路由 —— 它们不进侧栏
 * （`agent-nav.ts` 刻意不含），但 permission 仍生效；`keep-alive-outlet` 的
 * `DYNAMIC_PAGES`（`prefix: '/agent/agents/'`, `maxSegments: 2`）为其提供 Tab 标题。
 *
 * <p>⚠️ **为什么把 pathname 冻结在 `useState` 里**（本文件最容易被"优化"掉的一行）：
 * `KeepAliveOutlet` 把每个已打开 Tab 的页面实例**常驻**（仅切换显隐，不卸载），
 * 且渲染时**不传任何 props**。若这里直接用 `useLocation().pathname` 参与渲染，
 * 那么当用户切到另一个 Agent 的 Tab 时，**所有**缓存实例都会跟着新 location 重渲染 ——
 * 表现为「Tab A 里显示的是 Tab B 的 agent，标题也串了」。
 * 组件实例与路径是 1:1 的（keep-alive 以 path 为 key），所以挂载时快照一次即为正解。
 *
 * <p>导出符号 `AgentAgentDetailPage` **必须保留**：`keep-alive-outlet.tsx` 直接引用该名字。
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { DetailDefList } from '@/components/common/detail-def-list';
import { Card, CardContent } from '@/components/ui/card';
import { AgentPageShell } from '../components/agent-page-shell';
import {
  AgentDetailShell,
  type AgentDetailSuffix,
  type AgentDetailTab,
} from '../components/agent-detail-shell';
import { AgentSkillsPage } from './agent-skills-page';
import { AgentConfigPage } from './agent-config-page';
import { AgentCoordinationPage } from './agent-coordination-page';
import { getAgent } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { AgentDetail } from '../types';

/** 合法后缀集合；未登记的后缀（如手敲的 /agent/agents/7/foo）按详情根处理。 */
const VALID_SUFFIXES: AgentDetailSuffix[] = ['skills', 'config', 'coordination'];

/** 后缀 → 页面标题（进 PageHeader 与面包屑）。 */
const SUFFIX_TITLES: Record<AgentDetailSuffix, string> = {
  '': 'Agent 详情',
  skills: '技能绑定',
  config: '配置文件',
  coordination: '调度配置',
};

/** 后缀 → 页面级权限码（ui.md §2.2 / impl-plan §5.2 92043–92045）。 */
const SUFFIX_PERMISSIONS: Record<AgentDetailSuffix, string> = {
  '': 'agent:agent:list',
  skills: 'agent:agent:skills',
  config: 'agent:agent:config',
  coordination: 'agent:agent:coordination',
};

const PREFIX = '/agent/agents/';

interface ParsedPath {
  agentId: string;
  suffix: AgentDetailSuffix;
}

/** 从冻结的 pathname 解析出 agentId 与后缀。 */
function parsePath(pathname: string): ParsedPath {
  const rest = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : '';
  const [rawId = '', rawSuffix = ''] = rest.split('/');
  const suffix = (VALID_SUFFIXES as string[]).includes(rawSuffix)
    ? (rawSuffix as AgentDetailSuffix)
    : '';
  return { agentId: decodeURIComponent(rawId), suffix };
}

/**
 * 尚未接入的 Tab 占位（明确写清后续批次，避免被当成"坏了"）。
 *
 * <p>批 3 后仅「健康」Tab 仍在用它：健康探针（#19）需要轮询能力，
 * 按 impl-plan §10.1 约定 4 那是 react-query 的场景，留到后续批次统一做，
 * 不在本批用 `setInterval` 凑合（凑合出来的轮询没有并发去重与失活暂停，
 * 会在多 Tab keep-alive 下持续压下游）。
 */
function TabPlaceholder({ label }: { label: string }) {
  return (
    <Card className="flex flex-1 items-center justify-center border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Construction className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          该 Tab 的真实内容在后续批次接入；当前详情壳、路由与启停已可用。
        </p>
      </CardContent>
    </Card>
  );
}

/** Agent 详情（路由分发 + 详情数据加载）。 */
export function AgentAgentDetailPage() {
  const { pathname } = useLocation();
  // 挂载时快照一次；后续 location 变化不影响本实例（见文件头注释）
  const [frozenPath] = useState(pathname);
  const [{ agentId, suffix }] = useState<ParsedPath>(() => parsePath(frozenPath));

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) {
      setError('URL 中缺少 Agent id');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setAgent(await getAgent(agentId));
    } catch (e) {
      setError(agentErrorMessage(e, '获取 Agent 详情失败'));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderTab = useCallback(
    (tab: AgentDetailTab) => {
      if (tab === 'overview') {
        return (
          <Card>
            <CardContent className="py-5">
              <DetailDefList
                items={[
                  { label: 'Agent ID', value: agent?.id ?? agentId },
                  { label: '显示名', value: agent?.display_name },
                  { label: '角色', value: agent?.role === 'coordinator' ? '协调者' : '执行者' },
                  { label: '模型', value: agent?.model },
                  { label: '工作目录', value: agent?.workspace },
                  { label: '已启用技能数', value: agent?.enabled_skill_count ?? 0 },
                  { label: '更新时间', value: formatTime(agent?.updated_at) },
                  { label: '描述', value: agent?.description },
                ]}
              />
            </CardContent>
          </Card>
        );
      }
      if (tab === 'health') return <TabPlaceholder label="健康探针" />;
      // 以下三个 Tab 各自承载一条独立路由与页面级权限，内容组件自带三态与 501 容错
      if (tab === 'skills') return <AgentSkillsPage agentId={agentId} />;
      if (tab === 'config') return <AgentConfigPage agentId={agentId} />;
      return <AgentCoordinationPage agentId={agentId} />;
    },
    [agent, agentId],
  );

  return (
    <AgentPageShell
      title={SUFFIX_TITLES[suffix]}
      description="Agent 实例的明细配置。"
      permission={SUFFIX_PERMISSIONS[suffix]}
      loading={loading && agent === null}
      error={error}
      onRetry={() => void load()}
    >
      <AgentDetailShell
        agentId={agentId}
        agent={agent}
        suffix={suffix}
        onStateChanged={() => void load()}
      >
        {renderTab}
      </AgentDetailShell>
    </AgentPageShell>
  );
}

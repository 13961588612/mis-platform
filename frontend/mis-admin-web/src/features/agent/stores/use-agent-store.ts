/**
 * 智能体运营控制台的跨页面 UI 状态（Zustand）。
 *
 * <p>只放**跨页面共享**的轻量状态：当前选中的 Agent、列表筛选、轮询开关。
 * 服务端数据不进这里 —— 那是 `@tanstack/react-query` 的职责（仓库已依赖，零新增）。
 * 把响应缓存塞进 Zustand 会同时失去缓存失效与并发去重，是 `features/kb` 已踩过的坑。
 *
 * <p>本 store 刻意**不做持久化**：选中的 Agent / 筛选条件跨会话保留会造成
 * "打开页面看到的是上周的筛选结果"这种误导，运营场景下宁可每次重置。
 */
import { create } from 'zustand';
import { todayLocalDate } from '@/lib/utils';
import type { AgentState, SessionChannel, SkillStatus } from '../types';

/** 会话列表筛选条件（对应 UI#4 的筛选区）。 */
export interface SessionFilter {
  agentId: string;
  channel: SessionChannel | 'all';
  keyword: string;
  from: string;
  to: string;
}

/** 技能池列表筛选条件（对应 UI#1 的筛选区）。 */
export interface SkillFilter {
  keyword: string;
  status: SkillStatus | 'all';
  category: string;
}

/** 默认筛选：起止日期均为当天（重置时重新取「今天」，避免跨日仍停在旧日期）。 */
function defaultSessionFilter(): SessionFilter {
  const today = todayLocalDate();
  return {
    agentId: '',
    channel: 'all',
    keyword: '',
    from: today,
    to: today,
  };
}

const EMPTY_SKILL_FILTER: SkillFilter = {
  keyword: '',
  status: 'all',
  category: '',
};

interface AgentStoreState {
  /** 当前在详情页查看的 Agent id；列表页为 ''。 */
  selectedAgentId: string;
  /** Agent 总览的状态筛选。 */
  agentStateFilter: AgentState | 'all';
  sessionFilter: SessionFilter;
  skillFilter: SkillFilter;
  /**
   * 监控/健康类页面的自动刷新开关。
   *
   * <p>默认 **false**：这些接口会穿透 BFF 打到 ai-platform 与各 LLM provider，
   * 默认开启轮询等于让每个打开页面的运营都在持续压下游。由用户显式开启。
   */
  pollingEnabled: boolean;
  /** 轮询间隔（毫秒），下限 5s，避免手滑设成 100ms 打爆下游。 */
  pollingIntervalMs: number;

  setSelectedAgentId: (id: string) => void;
  setAgentStateFilter: (state: AgentState | 'all') => void;
  setSessionFilter: (patch: Partial<SessionFilter>) => void;
  resetSessionFilter: () => void;
  setSkillFilter: (patch: Partial<SkillFilter>) => void;
  resetSkillFilter: () => void;
  setPollingEnabled: (enabled: boolean) => void;
  setPollingIntervalMs: (ms: number) => void;
}

/** 轮询间隔下限（毫秒）。 */
const MIN_POLLING_INTERVAL_MS = 5_000;

export const useAgentStore = create<AgentStoreState>((set) => ({
  selectedAgentId: '',
  agentStateFilter: 'all',
  sessionFilter: defaultSessionFilter(),
  skillFilter: EMPTY_SKILL_FILTER,
  pollingEnabled: false,
  pollingIntervalMs: 15_000,

  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setAgentStateFilter: (state) => set({ agentStateFilter: state }),
  setSessionFilter: (patch) =>
    set((s) => ({ sessionFilter: { ...s.sessionFilter, ...patch } })),
  resetSessionFilter: () => set({ sessionFilter: defaultSessionFilter() }),
  setSkillFilter: (patch) => set((s) => ({ skillFilter: { ...s.skillFilter, ...patch } })),
  resetSkillFilter: () => set({ skillFilter: EMPTY_SKILL_FILTER }),
  setPollingEnabled: (enabled) => set({ pollingEnabled: enabled }),
  setPollingIntervalMs: (ms) =>
    set({ pollingIntervalMs: Math.max(MIN_POLLING_INTERVAL_MS, Math.floor(ms)) }),
}));

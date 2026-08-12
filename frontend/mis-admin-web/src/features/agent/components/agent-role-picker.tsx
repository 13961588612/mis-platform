/**
 * 按目标 App 选择 `sys_role` 的多选器（UI#2 核心组件）。
 *
 * <p>技能执行码 `ai:skill:{id}:run` 挂在哪个 App 下，决定了它在哪个 App 的 JWT 上下文里生效。
 * 所以授权前必须先选「目标 App」，再在该 App 的角色集合里挑角色 —— 这两步不能合并成一个下拉。
 *
 * <p>**为什么用原生 `<select>` / `<input type="checkbox">`**：`components/ui/` 只有 13 个原语，
 * 没有 select / checkbox 组件。仓库既有做法（`features/kb`）就是原生元素 + `selectClass` 常量，
 * 本组件保持一致，不引入新依赖（impl-plan §2.1 零新框架）。
 *
 * <p>角色数据来自 IAM（Java 侧 `sys_role`），字段是 **camelCase**（`AgentRoleOption`），
 * 与本 feature 其余 snake_case DTO 不同，这是 wire format 的真实差异，勿加映射层。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { listGrantableRoles } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentRoleOption, SkillGrant } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 可选的目标 App（与 `SkillGrant['target_app_code']` 同集合）。 */
const APP_OPTIONS: Array<{ value: SkillGrant['target_app_code']; label: string; hint: string }> = [
  { value: 'system', label: 'system（业务入口）', hint: '默认值：业务系统内调用该技能时生效。' },
  { value: 'agent', label: 'agent（运营台调试）', hint: '仅在本运营控制台的调试对话里生效。' },
];

export interface AgentRolePickerProps {
  /** 当前目标 App。 */
  appCode: SkillGrant['target_app_code'];
  onAppCodeChange: (appCode: SkillGrant['target_app_code']) => void;
  /** 已选角色 id。 */
  selectedRoleIds: number[];
  onSelectedRoleIdsChange: (roleIds: number[]) => void;
  /** 只读模式（无 grant 权限时）。 */
  disabled?: boolean;
  /**
   * 锁定目标 App：隐藏 App 切换与跨 App 说明，角色列表改用固定最大高度。
   * MCP 工具执行码恒挂 system，嵌在底部授权条时避免与工具表抢垂直空间。
   */
  lockApp?: boolean;
}

export function AgentRolePicker({
  appCode,
  onAppCodeChange,
  selectedRoleIds,
  onSelectedRoleIdsChange,
  disabled = false,
  lockApp = false,
}: AgentRolePickerProps) {
  const [roles, setRoles] = useState<AgentRoleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRoles(await listGrantableRoles(appCode));
    } catch (e) {
      setRoles([]);
      toast.error(agentErrorMessage(e, '获取角色列表失败'));
    } finally {
      setLoading(false);
    }
  }, [appCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return roles;
    return roles.filter(
      (r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw),
    );
  }, [roles, keyword]);

  const selectedSet = useMemo(() => new Set(selectedRoleIds), [selectedRoleIds]);

  function toggleRole(id: number): void {
    if (disabled) return;
    const next = selectedSet.has(id)
      ? selectedRoleIds.filter((x) => x !== id)
      : [...selectedRoleIds, id];
    onSelectedRoleIdsChange(next);
  }

  /** 全选/取消只作用于**当前筛选结果**，避免搜索状态下误操作看不见的角色。 */
  function toggleVisible(checked: boolean): void {
    if (disabled) return;
    const visibleIds = filtered.map((r) => r.id);
    if (checked) {
      const merged = new Set(selectedRoleIds);
      visibleIds.forEach((id) => merged.add(id));
      onSelectedRoleIdsChange([...merged]);
    } else {
      const drop = new Set(visibleIds);
      onSelectedRoleIdsChange(selectedRoleIds.filter((id) => !drop.has(id)));
    }
  }

  const allVisibleChecked = filtered.length > 0 && filtered.every((r) => selectedSet.has(r.id));
  const activeAppHint = APP_OPTIONS.find((o) => o.value === appCode)?.hint ?? '';

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {lockApp ? (
        <p className="text-xs text-muted-foreground">
          目标 App：<span className="font-mono text-foreground">{appCode}</span>
          （MCP 工具执行码固定，不可切换）
        </p>
      ) : (
        <>
          <div>
            <label className="mb-[0.4rem] block text-sm font-medium text-foreground">目标 App</label>
            <select
              className={selectClass}
              value={appCode}
              disabled={disabled}
              onChange={(e) => onAppCodeChange(e.target.value as SkillGrant['target_app_code'])}
            >
              {APP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-[0.35rem] text-xs text-muted-foreground">{activeAppHint}</p>
          </div>

          {/* impl-plan §5.4：跨 App 语义必须写在页面上，否则会被当缺陷提报。措辞保持中性。 */}
          <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
            <p className="leading-relaxed">
              同一用户在不同 App 下的可用角色相互独立，此为预期设计。
              权限判定取的是<span className="font-medium text-foreground">当前登录 App</span>
              下该用户角色所聚合的权限码集合：
              在 <span className="font-mono">system</span> 下授权的技能，不会自动在
              <span className="font-mono"> agent</span> 运营台的调试对话中生效，反之亦然。
              若两处都要能跑，需在两个 App 下各授权一次。
            </p>
          </div>
        </>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="搜索角色名称或编码"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-primary"
            checked={allVisibleChecked}
            disabled={disabled || filtered.length === 0}
            onChange={(e) => toggleVisible(e.target.checked)}
          />
          全选当前结果
        </label>
        <span>已选 {selectedRoleIds.length} 个角色</span>
      </div>

      <div
        className={
          lockApp
            ? 'max-h-40 min-h-[8rem] overflow-auto rounded-md border'
            : 'min-h-[10rem] flex-1 overflow-auto rounded-md border'
        }
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载角色…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {roles.length === 0 ? `App「${appCode}」下暂无可授权角色` : '没有匹配的角色'}
          </p>
        ) : (
          <ul className="divide-y">
            {filtered.map((role) => (
              <li key={role.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={selectedSet.has(role.id)}
                    disabled={disabled}
                    onChange={() => toggleRole(role.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{role.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {role.code}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

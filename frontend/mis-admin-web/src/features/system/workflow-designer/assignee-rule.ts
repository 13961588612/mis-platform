/**
 * 审批人规则 JSON ↔ 表单模型（与后端 AssignmentResolver 对齐）。
 *
 * <p>存储仍是节点上的 `assigneeRule` 字符串；本模块只负责解析/序列化，供鼠标配置 UI 使用。
 *
 * <p>{@code USER_LIST} 效果说明：
 * 引擎会为列表中每人各建一条待办。
 * <b>普通审批（APPROVAL）节点</b>：任一人通过即推进（其余待办不会自动作废）。
 * <b>会签/路由（ROUTING）节点</b>：由节点「会签策略」决定——`ALL_PASS` 全部通过才推进，
 * `ANY_PASS` 任一人通过即可（并作废其余待办）。
 */

export type AssigneeRuleType =
  | 'SELF'
  | 'FIXED'
  | 'USER_LIST'
  | 'SUPERVISOR'
  | 'ROLE'
  | 'DEPT_LEADER'
  | 'ORG_POST';

/** 设计器可选的审批人规则（已下线 FIXED / ROLE，旧定义仍可解析展示）。 */
export const ASSIGNEE_RULE_OPTIONS: { value: AssigneeRuleType; label: string; hint: string }[] = [
  { value: 'SELF', label: '发起人本人', hint: '任务分配给流程发起人' },
  {
    value: 'USER_LIST',
    label: '指定人员列表',
    hint: '为每人各建待办。普通审批：任一人通过即推进；会签/路由节点：看「会签策略」（全部通过 / 任一通过）',
  },
  { value: 'SUPERVISOR', label: '上级主管', hint: '按发起人组织关系解析上级' },
  { value: 'DEPT_LEADER', label: '部门负责人', hint: '指定部门的负责人' },
  {
    value: 'ORG_POST',
    label: '公司 + 部门 + 岗位',
    hint: '按组织、部门、岗位解析任职人员作为审批人（可多选岗位）',
  },
];

const LEGACY_RULE_LABELS: Partial<Record<AssigneeRuleType, string>> = {
  FIXED: '指定人员（已停用）',
  ROLE: '指定角色（已停用）',
};

export interface OrgPostValue {
  orgId: string;
  deptId: string;
  postId: string;
  /** 展示用（可选，序列化时不落库） */
  orgName?: string;
  deptName?: string;
  postName?: string;
  postCode?: string;
}

export interface ParsedAssigneeRule {
  type: AssigneeRuleType;
  /** FIXED / DEPT_LEADER 用单值；USER_LIST / ROLE 用多值（字符串化的 id）。 */
  ids: string[];
  /**
   * ORG_POST：组织 / 部门 / 岗位列表。
   * 兼容旧数据：历史上 value 为单对象时也会解析成单元素数组。
   */
  orgPosts?: OrgPostValue[];
}

const TYPE_SET = new Set<string>([
  ...ASSIGNEE_RULE_OPTIONS.map((o) => o.value),
  'FIXED',
  'ROLE',
]);

function asId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function parseOrgPostItem(value: unknown): OrgPostValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const orgId = asId(o.orgId);
  const deptId = asId(o.deptId);
  const postId = asId(o.postId);
  if (!orgId || !deptId || !postId) return null;
  return { orgId, deptId, postId };
}

function parseOrgPosts(value: unknown): OrgPostValue[] {
  if (Array.isArray(value)) {
    return value.map(parseOrgPostItem).filter((x): x is OrgPostValue => !!x);
  }
  const single = parseOrgPostItem(value);
  return single ? [single] : [];
}

export function orgPostKey(p: Pick<OrgPostValue, 'orgId' | 'deptId' | 'postId'>): string {
  return `${p.orgId}:${p.deptId}:${p.postId}`;
}

/** 解析节点上的 assigneeRule JSON；非法时回退 SELF。 */
export function parseAssigneeRule(raw: string | null | undefined): ParsedAssigneeRule {
  const blank: ParsedAssigneeRule = { type: 'SELF', ids: [], orgPosts: [] };
  if (!raw || !raw.trim() || raw.trim() === '{}') return blank;
  try {
    const obj = JSON.parse(raw) as { type?: unknown; value?: unknown };
    const typeRaw = typeof obj.type === 'string' ? obj.type.toUpperCase() : 'SELF';
    const type = (TYPE_SET.has(typeRaw) ? typeRaw : 'SELF') as AssigneeRuleType;
    const value = obj.value;
    if (type === 'SELF' || type === 'SUPERVISOR') return { type, ids: [], orgPosts: [] };
    if (type === 'ORG_POST') {
      return { type, ids: [], orgPosts: parseOrgPosts(value) };
    }
    if (type === 'FIXED' || type === 'DEPT_LEADER') {
      const id = asId(value);
      return { type, ids: id ? [id] : [], orgPosts: [] };
    }
    // USER_LIST / ROLE：value 为数组；兼容误写成单值
    if (Array.isArray(value)) {
      return { type, ids: value.map(asId).filter((x): x is string => !!x), orgPosts: [] };
    }
    const single = asId(value);
    return { type, ids: single ? [single] : [], orgPosts: [] };
  } catch {
    return blank;
  }
}

/** 序列化为后端可识别的 JSON 字符串。 */
export function serializeAssigneeRule(rule: ParsedAssigneeRule): string {
  const { type, ids, orgPosts } = rule;
  if (type === 'SELF' || type === 'SUPERVISOR') {
    return JSON.stringify({ type });
  }
  if (type === 'ORG_POST') {
    const list = (orgPosts ?? []).filter((p) => p.orgId && p.deptId && p.postId);
    if (list.length === 0) return JSON.stringify({ type });
    return JSON.stringify({
      type,
      value: list.map((p) => ({
        orgId: Number(p.orgId),
        deptId: Number(p.deptId),
        postId: Number(p.postId),
      })),
    });
  }
  if (type === 'FIXED' || type === 'DEPT_LEADER') {
    const n = ids[0] ? Number(ids[0]) : NaN;
    if (!Number.isFinite(n)) return JSON.stringify({ type });
    return JSON.stringify({ type, value: n });
  }
  // USER_LIST / ROLE
  const nums = ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
  return JSON.stringify({ type, value: nums });
}

/** 画布节点角标等短文案。 */
export function assigneeRuleLabel(raw: string | null | undefined): string {
  const parsed = parseAssigneeRule(raw);
  return (
    ASSIGNEE_RULE_OPTIONS.find((o) => o.value === parsed.type)?.label ??
    LEGACY_RULE_LABELS[parsed.type] ??
    parsed.type
  );
}

/** 是否为已从设计器下线、仅兼容旧数据的规则类型。 */
export function isLegacyAssigneeRuleType(type: AssigneeRuleType): boolean {
  return type === 'FIXED' || type === 'ROLE';
}

/** 配置是否完整到可保存（审批节点校验用）。与后端「`{}` / 空串视为未配置」对齐。 */
export function isAssigneeRuleConfigured(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim() || raw.trim() === '{}') return false;
  const parsed = parseAssigneeRule(raw);
  if (parsed.type === 'SELF' || parsed.type === 'SUPERVISOR') return true;
  if (parsed.type === 'ORG_POST') return (parsed.orgPosts?.length ?? 0) > 0;
  if (parsed.type === 'FIXED' || parsed.type === 'DEPT_LEADER') return parsed.ids.length === 1;
  return parsed.ids.length > 0;
}

import type { DeptNode, DeptPierceNode } from '@/types/api';

/**
 * 部门树统一渲染行（D1）。
 *
 * <p>同一棵递归树需同时承载两类数据：
 * <ul>
 *   <li>本地部门（{@link DeptNode}）——可编辑，`readOnly = false`，`node` 字段回填原始节点；</li>
 *   <li>穿透部门（{@link DeptPierceNode}）——只读，`readOnly = true`，`pierce` 字段回填原始节点。</li>
 * </ul>
 * 渲染层只依赖本类型，不再区分数据来源；写操作前通过 `readOnly` / `node` 做守卫。
 */
export interface DeptTreeRow {
  /** 渲染唯一键（穿透行带 `pierce:${orgId}:` 前缀，避免与本地部门 id 在 expandedIds 中撞键）。 */
  id: string;
  /** 后端原始部门 id（本地行等于 `id`；穿透行为去前缀后的 id）。 */
  rawId: string;
  /** 该行所属组织 id。 */
  orgId: string;
  /** 部门编码（可能为空）。 */
  code: string | null;
  /** 部门名称。 */
  name: string;
  /** 排序值（缺省 0）。 */
  sort: number;
  /** 状态：1=启用 / 0=禁用。 */
  status: number;
  /** 链接（对应）组织 id，非空表示可 inline 穿透下钻。 */
  linkedOrgId: string | null;
  /** 链接（对应）组织名。 */
  linkedOrgName: string | null;
  /** 部门类型 id（本地行来自 DeptNode.deptTypeId；穿透行来自 DeptPierceNode.deptTypeId）。 */
  deptTypeId: string | null;
  /** 部门类型名（本地行有值；穿透 VO 经 Part1 修复后同样携带，渲染「—」仅当真为 null）。 */
  deptTypeName: string | null;
  /** 编制数（仅本地行有值；穿透行 null → 渲染「—」）。 */
  establishmentCount: number | null;
  /** 是否末级：1=末级 / 0=非末级（仅本地行有值；穿透行 null → 渲染「—」）。 */
  isLeaf: number | null;
  /** 穿透行的来源组织名（D7：只读行「对应组织」列展示该值）；本地行为 null。 */
  sourceOrgName: string | null;
  /** 是否只读行（穿透而来）：true 时隐藏全部操作按钮（D3）。 */
  readOnly: boolean;
  /** 根 → 本行的祖先组织链，用于防循环校验（D9）。 */
  orgChain: string[];
  /** 同组织内的下级行（穿透 forest 已全深度嵌套，本地树同理）。 */
  children: DeptTreeRow[];
  /** 本地行原始节点（只读行为 null），供编辑/删除等写操作使用。 */
  node: DeptNode | null;
  /** 只读行原始穿透节点（本地行为 null）。 */
  pierce: DeptPierceNode | null;
}

/** 穿透行 id 前缀，保证跨组织同名 id 不冲突。 */
export const PIERCE_ID_PREFIX = 'pierce';

/** 生成穿透行渲染 id：`pierce:${orgId}:${deptId}`。 */
export function pierceRowId(orgId: string, deptId: string): string {
  return `${PIERCE_ID_PREFIX}:${orgId}:${deptId}`;
}

/**
 * 追加组织到祖先链（幂等：已存在则原样返回，避免重复入链）。
 *
 * @param chain 当前祖先组织链
 * @param orgId 待追加的组织 id
 */
export function buildOrgChain(chain: string[], orgId: string | null | undefined): string[] {
  if (!orgId) return chain;
  return chain.includes(orgId) ? chain : [...chain, orgId];
}

/** 判断目标组织是否已在祖先链中（D9 防循环）。 */
export function isOrgInChain(chain: string[], orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  return chain.includes(orgId);
}

/**
 * 本地部门节点 → 统一渲染行（可编辑，`readOnly = false`）。
 *
 * @param node  后端部门树节点
 * @param chain 祖先组织链（顶层传空数组，内部自动并入 `node.orgId`）
 */
export function normalizeDeptNode(node: DeptNode, chain: string[] = []): DeptTreeRow {
  const orgChain = buildOrgChain(chain, node.orgId);
  return {
    id: node.id,
    rawId: node.id,
    orgId: node.orgId,
    code: node.code ?? null,
    name: node.name,
    sort: node.sort ?? 0,
    status: node.status,
    linkedOrgId: node.linkedOrgId ?? null,
    linkedOrgName: node.linkedOrgName ?? null,
    deptTypeId: node.deptTypeId ?? null,
    deptTypeName: node.deptTypeName ?? null,
    establishmentCount: node.establishmentCount ?? null,
    isLeaf: node.isLeaf ?? null,
    sourceOrgName: null,
    readOnly: false,
    orgChain,
    children: normalizeDeptNodes(node.children ?? [], orgChain),
    node,
    pierce: null,
  };
}

/** 本地部门 forest → 统一渲染行数组。 */
export function normalizeDeptNodes(nodes: DeptNode[], chain: string[] = []): DeptTreeRow[] {
  return nodes.map((n) => normalizeDeptNode(n, chain));
}

/**
 * 穿透部门节点 → 统一渲染行（只读，`readOnly = true`）。
 *
 * @param node  穿透 VO 节点
 * @param chain 祖先组织链（调用方传 `[...parentRow.orgChain, linkedOrgId]`）
 */
export function normalizePierceNode(node: DeptPierceNode, chain: string[]): DeptTreeRow {
  const orgChain = buildOrgChain(chain, node.orgId);
  return {
    id: pierceRowId(node.orgId, node.id),
    rawId: node.id,
    orgId: node.orgId,
    code: node.code ?? null,
    name: node.name,
    sort: node.sort ?? 0,
    status: node.status,
    linkedOrgId: node.linkedOrgId ?? null,
    linkedOrgName: node.linkedOrgName ?? null,
    // 穿透 VO 经 Part1 修复后携带部门类型（deptTypeId/deptTypeName），仅真为 null 时渲染「—」
    deptTypeId: node.deptTypeId ?? null,
    deptTypeName: node.deptTypeName ?? null,
    establishmentCount: null,
    isLeaf: null,
    sourceOrgName: node.orgName ?? null,
    readOnly: true,
    orgChain,
    children: normalizePierceForest(node.children ?? [], orgChain),
    node: null,
    pierce: node,
  };
}

/** 穿透 forest → 只读渲染行数组（全深度递归，共享同一祖先组织链）。 */
export function normalizePierceForest(nodes: DeptPierceNode[], chain: string[]): DeptTreeRow[] {
  return nodes.map((n) => normalizePierceNode(n, chain));
}

/**
 * 下钻穿透 forest → 只读渲染行，但压平「对端组织顶级部门」这一层。
 *
 * <p>用户诉求：下钻时不显示对应组织的顶级部门（parentId=0 的根部门），直接展示其下级部门。
 * 仅对传入的 forest 根（即顶级部门）做条件跳过：
 * <ul>
 *   <li>顶级部门自身无 linkedOrgId → 不渲染该行，用 {@link normalizePierceForest} 将其 children 提升为直接子行；</li>
 *   <li>顶级部门自身 linkedOrgId 非空（罕见：根部门还链接更深组织）→ 保留该行，避免丢失继续下钻入口。</li>
 * </ul>
 * 第二层及更深层用现有 {@link normalizePierceForest}/{@link normalizePierceNode} 正常保留，不再跳过。
 */
export function normalizePierceForestSkipTopLevel(nodes: DeptPierceNode[], chain: string[]): DeptTreeRow[] {
  const rows: DeptTreeRow[] = [];
  for (const top of nodes) {
    if (!top.linkedOrgId) {
      // 跳过顶级部门行，提升其子部门为下钻入口的直接子行
      rows.push(...normalizePierceForest(top.children ?? [], buildOrgChain(chain, top.orgId)));
    } else {
      rows.push(normalizePierceNode(top, chain));
    }
  }
  return rows;
}

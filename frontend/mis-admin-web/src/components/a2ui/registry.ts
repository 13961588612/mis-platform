/**
 * A2UI 组件注册表 — 单前端一份（T06'）。
 *
 * <p>D5 双层声明（docs/ai-fusion/a2ui/03-permission-design.md §4）：
 * - 前端 registry：声明 requiredPermission + actionApiMap（UX 层，可篡改仅影响显示）
 * - Gateway `SHARED_CATALOG`（catalog.ts）：权威源（防伪造，下发以 Gateway 为准）
 * - BFF `sys_api` 表：写操作最终权威（deny-unmapped=true fail-closed）
 *
 * <p>catalogId 锚点：`mis-a2ui-catalog-v1`（资产 major ↔ Gateway catalog major 必须匹配）。
 */

import { A2UI_CATALOG_ID, KNOWN_A2UI_COMPONENTS, type A2uiActionApiBinding, type A2uiComponentName, type A2uiRegistryEntry } from '@/lib/a2ui/types';
import { ApprovalCard } from './components/ApprovalCard';
import { DataTable } from './components/DataTable';
import { FormSheet } from './components/FormSheet';
import { EntitySelect } from './components/EntitySelect';

/** 协议版本锚点（与 Gateway A2UIMiddlewareConfig.defaultCatalogId 对齐）。 */
export const A2UI_CATALOG = A2UI_CATALOG_ID;

/**
 * 单前端注册表（与 Gateway SHARED_CATALOG 严格对齐；不一致时 Gateway 权威优先）。
 *
 * <p>approval-card 写端点统一为真实后端 `/api/v1/push/approvals/{id}/respond`
 * （ai-platform push.py，Obs-1 修复——旧 `/api/v1/approval/decide` 为文档时序图口径，
 * 真实后端不存在，走默认 binding 会 404）。`{id}` 占位符由 bff-actions
 * `resolveBindingUrl` 从 payload.approvalId 插值；payload.action（approved/rejected）
 * 映射为后端 decision 字段。
 */
export const A2UI_REGISTRY: A2uiRegistryEntry[] = [
  {
    name: 'approval-card',
    component: ApprovalCard,
    requiredPermission: 'approval:view',
    actionApiMap: {
      approve: { method: 'POST', path: '/api/v1/push/approvals/{id}/respond', permissionCode: 'approval:decide' },
      reject: { method: 'POST', path: '/api/v1/push/approvals/{id}/respond', permissionCode: 'approval:decide' },
    },
    deniedText: '无权限访问此卡片（缺少权限码：approval:view）',
  },
  {
    name: 'data-table',
    component: DataTable,
    // 未声明 requiredPermission → 默认可见（02 文档 §4 组件名口径）
  },
  {
    name: 'form-sheet',
    component: FormSheet,
    actionApiMap: {
      submit: { method: 'POST', path: '/api/v1/dynamic/submit', permissionCode: 'form:submit' },
    },
  },
  {
    name: 'entity-select',
    component: EntitySelect,
    // 操作经 Gateway dispatchAction 回传 Agent，非 BFF 写操作
  },
];

/** 组件名 → 注册条目（未知返回 undefined，渲染层回退占位）。 */
export function getA2uiRegistryEntry(name: string): A2uiRegistryEntry | undefined {
  return A2UI_REGISTRY.find((entry) => entry.name === name);
}

/** 取组件；未知返回 undefined。 */
export function getA2uiComponent(name: string): A2uiRegistryEntry['component'] | undefined {
  return getA2uiRegistryEntry(name)?.component;
}

/** 判断组件名是否登记。 */
export function isKnownA2uiComponent(name: string): boolean {
  return KNOWN_A2UI_COMPONENTS.has(name) && A2UI_REGISTRY.some((entry) => entry.name === name);
}

/** 取操作 → BFF API 绑定（actionApiMap）。 */
export function getActionBinding(
  name: A2uiComponentName | string,
  action: string,
): A2uiActionApiBinding | undefined {
  return getA2uiRegistryEntry(name)?.actionApiMap?.[action];
}

export default A2UI_REGISTRY;

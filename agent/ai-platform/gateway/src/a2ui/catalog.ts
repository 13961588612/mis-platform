/**
 * catalog.ts — SHARED_CATALOG（A2UI 组件权威源）
 *
 * D5：前端 registry 仅 UX 层（可篡改仅影响显示），Gateway catalog 为权威源
 * （防伪造，下发以 Gateway 为准）。本文件是 A2UI 渲染权限的**权威声明**，
 * SurfacePermissionFilter 以本 catalog 的 requiredPermission / actions 为准过滤
 * （不读前端注册表）。
 *
 * 口径（02-task-breakdown.md §4）：
 * - catalogId：mis-a2ui-catalog-v1
 * - 组件名：approval-card / data-table / form-sheet / entity-select
 *   - approval-card：渲染 approval:view，操作 approve/reject → approval:decide
 *   - data-table：默认可见
 *   - form-sheet：默认可见，操作 submit → form:submit
 *   - entity-select：默认可见，操作 confirm 经 Gateway dispatchAction 回传 Agent
 *
 * @module a2ui/catalog
 */

import {
  A2UI_CATALOG_ID,
  PERMISSION_APPROVAL_DECIDE,
  PERMISSION_APPROVAL_VIEW,
  PERMISSION_FORM_SUBMIT,
} from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * A2UI 组件规范（Gateway 权威声明）。
 *
 * 与前端 mis-admin-web `registry.ts` 的 ComponentSpec 对齐
 * （组件名 / requiredPermission / actionApiMap 严格一致，不一致时 Gateway 权威优先）。
 */
export interface A2UIComponentSpec {
  /** 组件名（协议标识，如 approval-card） */
  name: string;
  /** 组件用途描述（注入 LLM 指南） */
  description: string;
  /** props JSON Schema（LLM 可见的组件定义；A2UIMiddlewareConfig.schema 用） */
  propsSchema: Record<string, unknown>;
  /** 渲染权限码；未声明 = 默认可见（降低接入成本） */
  requiredPermission?: string;
  /** 操作 → 操作权限码映射（供前端 actionApiMap 参考；BFF 校验以 sys_api 表为准） */
  actions?: Record<string, string>;
  /** 是否为容器根组件：无权限时整卡降级（而非组件级占位） */
  isContainerRoot?: boolean;
}

/**
 * A2UIMiddlewareConfig.schema 格式（LLM 可见组件定义）。
 *
 * ```ts
 * {
 *   catalogId: 'mis-a2ui-catalog-v1',
 *   components: { 'approval-card': {...propsSchema}, ... },
 * }
 * ```
 */
export interface A2UIInlineCatalogSchema {
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
}

// ============================================================================
// 组件 propsSchema
// ============================================================================

/** approval-card props（审批详情 + 决策按钮） */
const APPROVAL_CARD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    approvalId: { type: 'string', description: '审批单 ID' },
    title: { type: 'string', description: '审批标题' },
    description: { type: 'string', description: '审批描述' },
    status: { type: 'string', description: '审批状态（pending/approved/rejected）' },
    applicant: { type: 'string', description: '申请人' },
    submittedAt: { type: 'string', description: '提交时间（ISO 8601）' },
    detail: { type: 'object', description: '审批详情字段' },
  },
  required: ['approvalId', 'title'],
};

/** data-table props（只读数据表） */
const DATA_TABLE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '表格标题' },
    columns: {
      type: 'array',
      description: '列定义',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          header: { type: 'string' },
          dataType: { type: 'string', enum: ['string', 'number', 'date', 'boolean'] },
        },
        required: ['key', 'header'],
      },
    },
    rows: {
      type: 'array',
      description: '行数据（对象数组，key 与 columns.key 对应）',
      items: { type: 'object' },
    },
  },
  required: ['columns', 'rows'],
};

/** form-sheet props（表单填写/提交） */
const FORM_SHEET_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '表单标题' },
    fields: {
      type: 'array',
      description: '表单字段',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: ['text', 'number', 'select', 'date', 'textarea'] },
          required: { type: 'boolean' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'select 类型候选',
          },
        },
        required: ['name', 'label', 'type'],
      },
    },
    submitLabel: { type: 'string', description: '提交按钮文案' },
    data: { type: 'object', description: '表单默认值' },
  },
  required: ['title', 'fields'],
};

/** entity-select props（实体选择回传 Agent） */
const ENTITY_SELECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '选择器标题' },
    placeholder: { type: 'string', description: '占位提示' },
    entities: {
      type: 'array',
      description: '候选实体',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id', 'label'],
      },
    },
    multiple: { type: 'boolean', description: '是否多选' },
  },
  required: ['title', 'entities'],
};

// ============================================================================
// SHARED_CATALOG（权威源）
// ============================================================================

/** A2UI 组件权威 catalog（Gateway 侧唯一事实源） */
export const SHARED_CATALOG: A2UIComponentSpec[] = [
  {
    name: 'approval-card',
    description:
      '审批卡片：展示审批详情，提供通过/驳回按钮。需要 approval:view 权限才能渲染。',
    propsSchema: APPROVAL_CARD_SCHEMA,
    requiredPermission: PERMISSION_APPROVAL_VIEW,
    actions: {
      approve: PERMISSION_APPROVAL_DECIDE,
      reject: PERMISSION_APPROVAL_DECIDE,
    },
    isContainerRoot: true,
  },
  {
    name: 'data-table',
    description: '数据表格：只读展示结构化数据（列 + 行），默认可见。',
    propsSchema: DATA_TABLE_SCHEMA,
  },
  {
    name: 'form-sheet',
    description: '表单面板：收集用户输入并提交，默认可见；提交操作由 BFF 校验 form:submit。',
    propsSchema: FORM_SHEET_SCHEMA,
    actions: {
      submit: PERMISSION_FORM_SUBMIT,
    },
  },
  {
    name: 'entity-select',
    description: '实体选择器：选择候选实体并回传 Agent 继续对话，默认可见。',
    propsSchema: ENTITY_SELECT_SCHEMA,
  },
];

// ============================================================================
// 查询与转换工具
// ============================================================================

/**
 * 按组件名查询组件规范。
 *
 * @param name - 组件名（如 approval-card）
 * @returns 组件规范；未知组件返回 undefined（Gateway 不认 → 不下发）
 */
export function getComponentSpec(name: string): A2UIComponentSpec | undefined {
  return SHARED_CATALOG.find((c) => c.name === name);
}

/**
 * 将 SHARED_CATALOG 转换为 A2UIMiddlewareConfig.schema 格式（LLM 可见）。
 *
 * 只暴露 propsSchema（组件结构），requiredPermission / actions 为 Gateway 内部
 * 权威元数据（SurfacePermissionFilter 消费），不注入 LLM 提示。
 *
 * @param catalog - 组件规范数组（默认 SHARED_CATALOG）
 * @returns 中间件 schema
 */
export function toMiddlewareSchema(
  catalog: A2UIComponentSpec[] = SHARED_CATALOG,
): A2UIInlineCatalogSchema {
  const components: Record<string, Record<string, unknown>> = {};
  for (const spec of catalog) {
    components[spec.name] = spec.propsSchema;
  }
  return {
    catalogId: A2UI_CATALOG_ID,
    components,
  };
}

/**
 * 校验 A2UI 组件树中的组件名是否都属于 catalog。
 *
 * 用于过滤链路：未知组件名（LLM 幻觉 / 伪造）不注入 schema、不下发。
 *
 * @param componentNames - 待校验组件名数组
 * @returns 未知组件名数组（空 = 全部合法）
 */
export function findUnknownComponents(componentNames: string[]): string[] {
  const known = new Set(SHARED_CATALOG.map((c) => c.name));
  return [...new Set(componentNames)].filter((name) => !known.has(name));
}

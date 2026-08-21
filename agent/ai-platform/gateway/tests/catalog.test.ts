/**
 * catalog.test.ts — SHARED_CATALOG 权威源单测（tsx 直跑）。
 *
 * 验证口径（02 §4）：catalogId=mis-a2ui-catalog-v1、4 组件名、
 * approval-card requiredPermission=approval:view / actions=approval:decide、
 * form-sheet actions=form:submit、data-table/entity-select 默认可见。
 *
 * 运行：node_modules/.bin/tsx tests/catalog.test.ts
 */

import {
  SHARED_CATALOG,
  getComponentSpec,
  toMiddlewareSchema,
  findUnknownComponents,
} from '../src/a2ui/catalog.js';
import { A2UI_CATALOG_ID } from '../src/a2ui/types.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function main(): void {
  // ---- 4 组件 ----
  const names = SHARED_CATALOG.map((c) => c.name).sort();
  check(
    'catalog 恰为 4 组件',
    names.length === 4 &&
      names[0] === 'approval-card' &&
      names[1] === 'data-table' &&
      names[2] === 'entity-select' &&
      names[3] === 'form-sheet',
    JSON.stringify(names),
  );

  // ---- approval-card ----
  const approval = getComponentSpec('approval-card');
  check('approval-card requiredPermission=approval:view', approval?.requiredPermission === 'approval:view');
  check(
    'approval-card actions approve/reject=approval:decide',
    approval?.actions?.['approve'] === 'approval:decide' && approval?.actions?.['reject'] === 'approval:decide',
    JSON.stringify(approval?.actions),
  );
  check('approval-card 为容器根组件（整卡降级）', approval?.isContainerRoot === true);

  // ---- 默认可见组件 ----
  check('data-table 未声明 requiredPermission（默认可见）', getComponentSpec('data-table')?.requiredPermission == null);
  check('entity-select 未声明 requiredPermission（默认可见）', getComponentSpec('entity-select')?.requiredPermission == null);
  check(
    'form-sheet 渲染默认可见、操作 form:submit',
    getComponentSpec('form-sheet')?.requiredPermission == null &&
      getComponentSpec('form-sheet')?.actions?.['submit'] === 'form:submit',
  );

  // ---- 未知组件 ----
  check('未知组件返回 undefined', getComponentSpec('hacker-card') == null);
  check(
    'findUnknownComponents 检出未知组件',
    JSON.stringify(findUnknownComponents(['approval-card', 'hacker-card'])) === '["hacker-card"]',
  );

  // ---- toMiddlewareSchema ----
  const schema = toMiddlewareSchema();
  check('schema.catalogId = mis-a2ui-catalog-v1', schema.catalogId === A2UI_CATALOG_ID);
  check('schema.components 4 键', Object.keys(schema.components).length === 4);
  check(
    'schema.components.approval-card 为 JSON Schema（含 properties）',
    typeof schema.components['approval-card']?.['properties'] === 'object',
  );

  console.log(`\ncatalog: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

/**
 * DEP-10 前端 A2UI 渲染冒烟（vitest 缺失，用 tsx + react-dom/server 直跑）。
 *
 * 验证（网关/前端无 jest/vitest 运行器，故用最小独立 SSR 冒烟）：
 *  - 组件注册表：approval-card / data-table / form-sheet 均映射到 React 组件，
 *    未知组件返回 undefined（安全回退路径）。
 *  - ApprovalCardView 真实渲染 props（标题/审批ID/同意/拒绝按钮），且不使用
 *    dangerouslySetInnerHTML（XSS 安全）。
 *  - A2uiRenderer 端到端：ui.render {component,props} → 经注册表渲染出对应组件，
 *    props 文本由 React 转义（注入 <script> 不执行）。
 *
 * 运行（在 frontend 目录，复用网关的 tsx 二进制以解析 react 依赖）：
 *   ../gateway/node_modules/.bin/tsx tests/a2ui.render.smoke.tsx
 * 退出码：0=全部通过，1=存在失败。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KNOWN_A2UI_COMPONENTS,
  getA2uiComponent,
  isKnownA2uiComponent,
} from "../src/components/a2ui/registry";
import { ApprovalCardView } from "../src/components/a2ui/ApprovalCardView";
import { A2uiRenderer } from "../src/components/a2ui/A2uiRenderer";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

console.log("\n[注册表] component 名 → React 组件映射");
check("approval-card 已登记", typeof getA2uiComponent("approval-card") === "function");
check("data-table 已登记", typeof getA2uiComponent("data-table") === "function");
check("form-sheet 已登记", typeof getA2uiComponent("form-sheet") === "function");
check("未知组件 -> undefined", getA2uiComponent("nonexistent") === undefined);
check("isKnown approval-card", isKnownA2uiComponent("approval-card") === true);
check("KNOWN 集合含 3 个", KNOWN_A2UI_COMPONENTS.size === 3);

console.log("\n[渲染] ApprovalCardView 渲染 props（无 dangerouslySetInnerHTML）");
const html = renderToStaticMarkup(
  React.createElement(ApprovalCardView, {
    props: { title: "报销审批", approvalId: "ap-001", description: "金额 1200" },
    actions: undefined,
  }),
);
check("渲染标题", html.includes("报销审批"));
check("渲染审批ID", html.includes("ap-001"));
check("渲染同意按钮", html.includes("同意"));
check("渲染拒绝按钮", html.includes("拒绝"));
check("未使用 dangerouslySetInnerHTML", !html.toLowerCase().includes("dangerouslysetinnerhtml"));

console.log("\n[端到端] A2uiRenderer 经注册表渲染 ui.render + XSS 转义");
const full = renderToStaticMarkup(
  React.createElement(A2uiRenderer, {
    render: { component: "approval-card", props: { title: "XSS-<script>test", approvalId: "ap-002" } },
  }),
);
check("ui.render -> 组件渲染(含同意按钮)", full.includes("同意"));
check("props 文本被 HTML 转义(无原始 <script>)", !full.includes("<script>test</script>"));
check("props 文本转义为实体", full.includes("XSS-&lt;script&gt;test"));

console.log(`\nA2UI 渲染冒烟结果：${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

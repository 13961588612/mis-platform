# ADR-004: 前端采用 shadcn/ui

## 状态
提议中

## 日期
2026-06-23

## 背景

企业管理系统需要一致、现代、可定制的 UI。需在 Ant Design、MUI、shadcn/ui 等方案中选择。

## 决策

采用 **shadcn/ui + Tailwind CSS**：

- 组件源码复制到项目 `components/ui/`，完全可控
- 基于 Radix UI 原语，无障碍良好
- 与 Tailwind 设计系统一致，易于定制企业品牌色

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. shadcn/ui（选定） | 可定制、现代、无黑盒 | 需自己拼业务组件 |
| B. Ant Design Pro | 后台模板多 | 风格固定、包体积大 |
| C. MUI | 生态成熟 | 风格偏 Material，定制成本高 |

## 后果

### 正面
- 视觉现代，支持亮/暗主题
- 无 npm 黑盒组件库版本锁定
- 与 Vite/React 18 配合良好

### 负面
- DataTable、Tree 等需基于 TanStack Table 等自行封装
- 团队需熟悉 Tailwind

## 待确认

- [ ] 是否抽取内部包 `@mis/ui` 跨项目复用
- [ ] 是否 Phase 1 引入 i18n 文案外置

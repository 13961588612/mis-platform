# 侧边栏恢复 + 表头强化 — 概述

## 做了什么
根据用户三条反馈，对 `frontend/mis-admin-web` 做三处调整（紧接 §21.11 专业中性灰重构）：

1. **侧边栏恢复浅色**：撤销上一轮的深 slate 侧栏（`222 47% 11%`），恢复为与页面同源 `214` 色相的浅色 `--sidebar` 系 token（浅色 `214 32% 90%` / 暗色 `217 33% 14%`）。页面背景仍是 `220` 中性灰，侧栏 `214` 蓝灰两者饱和度都低、差异极小，视觉协调。
2. **表头与表主体区分**：表头底色 `--table-header` 从 `220 14% 96%` 调深到 `92%`，与表格容器 `--table-surface 98%` 拉开约 6% 明度，形成清晰的「表头浅灰带」。数据行仍以纯白 / 99% 微灰为主，层次为「深一档表头带 → 白底数据区」。
3. **表头加高 + 分隔线**：
   - 在 `globals.css` 给 `thead th` 统一追加 `padding-top/bottom: 0.75rem !important`，覆盖各组件行内 `py-1.5 / py-2`，全站表头垂直内边距统一 12px（水平 padding 仍由各表自定）。
   - 所有 `<thead>` 的 `border-b` 升级为 `border-b-2 border-foreground/20`（2px + 前景色 20% 透明线），与数据区形成明显分界，sticky 滚动时始终可见。

## 涉及文件
- `globals.css`（sidebar 恢复 + table-header 调深 + thead th padding）
- thead 分隔线：`tree-table.tsx`、`list-page-skeleton.tsx`、`dashboard-page.tsx`、`log-pages.tsx`(×2)、`module-manage-page.tsx`、`org-list-page.tsx`、`role-list-page.tsx`、`dict-manage-page.tsx`
- `admin-list-page.tsx`、`user-list-page.tsx` 的表头已同步改，但两文件携带此前刻意未提交的 AI 表单 UI WIP，**未纳入提交**，仅保留工作区改动（故 admin/user 表头分隔线暂为 1px，待 WIP 处理后再统一）。

## 验证
- `npm run typecheck`：0 错误。
- 本地提交 `1f29b35`，未推远端。

## 后续
- 刷新后确认侧栏、表头层次与分隔线效果。
- admin/user 表格配色改动需等 AI 表单 WIP 处理后再统一提交。

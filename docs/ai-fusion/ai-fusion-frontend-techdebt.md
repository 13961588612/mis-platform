# 技术债登记：前端 H5 容器构建门禁放宽（跳过 tsc）

> 关联决策文档：`docs/ai-fusion/ai-fusion-deploy-decision.md` §5「风险与开放问题」
> 关联部署任务：DEP-6（共享边缘 nginx 托管 H5 静态）
> 登记原因：开放问题 #1（部署阻断项）已核实、用户拍板「放宽构建门禁」

---

## 1. 背景

融合部署 DEP-6 的 H5 通路依赖 `edge-nginx` 拉起 `ai-platform-frontend` 构建容器
（`ai-platform-frontend` 仅构建静态产物写入 `ai-h5-static` 卷，无 H5 常驻容器）。

原构建调用链为 `npm run build`（`package.json` 中即 `tsc -b && vite build`）：

- `tsc -b` 在类型检查阶段因 **13 处既有类型错误** 退出非 0；
- 容器 `command` 中 `npm run build` 失败 → 容器退出非 0；
- `edge-nginx` 以 `service_completed_successfully` 依赖 `ai-platform-frontend`，
  故 **H5 通路在 `docker compose up` 时无法拉起**。

经核对，这 13 处错误 **全部位于融合代码之外**，与本次 MIS × ai-platform 融合改动无关，
属前端仓库既有技术债。

---

## 2. 已落地的决策（开放问题 #1）

用户拍板「放宽构建门禁」：

- **容器内构建跳过 `tsc`，直接 `vite build`**（vite 不做类型检查，正常产出 `dist/`）；
- **本地 `package.json` 的 `build` 脚本保持 `tsc -b && vite build` 不变**，
  以便本地 IDE / 类型检查仍能暴露这 13 处错误，不被静默掩盖。

即：**部署产物用 `vite build`（放行），类型门禁由本地 / CI 的 `npm run build` 承担**。

---

## 3. 改动点（门禁放宽）

| 文件 | 位置 | 原值 | 现值 |
|---|---|---|---|
| `deploy/docker-compose.ai.yml` | `ai-platform-frontend` service `command` | `npm run build` | `npx vite build` |
| `agent/ai-platform/infra/Dockerfile.frontend` | `builder` stage | `RUN npm run build` | `RUN npx vite build` |

> `package.json` 的 `"build": "tsc -b && vite build"` **未改动**。

---

## 4. 既有 13 处类型错误清单（待后续排期修复）

| # | 文件:行 | 错误 | 类型 | 建议修法 |
|---|---|---|---|---|
| 1 | `src/components/markdownComponents.tsx:5,44` | `react-syntax-highlighter` 缺类型声明（implicitly any） | TS7016 | `npm i -D @types/react-syntax-highlighter`，或加 `declare module` 声明 |
| 2 | `src/components/markdownComponents.tsx:6,25` | `react-syntax-highlighter/dist/esm/styles/prism` 缺类型声明 | TS7016 | 同上（含子路径） |
| 3 | `src/pages/ApprovalCenterPage.tsx:17,23` | `useEffect` 导入未使用 | TS6133 | 删除未用导入 |
| 4 | `src/pages/SkillManagePage.tsx:82,22` | `number` → `Record<string, number>` 强转可能失误 | TS2352 | 经 `unknown` 中转或修正目标类型 |
| 5 | `src/pages/SkillManagePage.tsx:83,12` | 同上 | TS2352 | 同上 |
| 6 | `src/pages/SkillManagePage.tsx:85,20` | 同上 | TS2352 | 同上 |
| 7 | `src/pages/SkillManagePage.tsx:86,12` | 同上 | TS2352 | 同上 |
| 8 | `src/store/approvalStore.ts:120,9` | `ApprovalRecord` 缺索引签名，`.map` 回调类型不兼容 | TS2345 | 给 `ApprovalRecord` 加 `[key: string]: unknown` 索引签名，或修正回调参数类型 |
| 9 | `src/utils/cardAdapter.ts:106,15` | `RawAgentEvent` → `Record<string, unknown>` 强转 | TS2352 | 经 `unknown` 中转：`as unknown as Record<string, unknown>` |
| 10 | `src/utils/cardAdapter.ts:107,24` | 同上 | TS2352 | 同上 |
| 11 | `src/utils/cardAdapter.ts:111,15` | 同上 | TS2352 | 同上 |
| 12 | `src/utils/cardAdapter.ts:112,22` | 同上 | TS2352 | 同上 |
| 13 | `src/utils/markdownNormalize.test.ts:1,38` | 找不到 `vitest` 类型声明 | TS2307 | `npm i -D vitest`（或确认 devDependencies 安装） |

---

## 5. 影响与风险

- 跳过 `tsc` 后，**类型错误会推迟到运行时才暴露**（真正的类型不匹配可能导致崩溃）；
- 若 CI 仅跑 `vite build` 作为门禁，将漏掉类型回归。
- **缓解建议**：本地开发 / CI 仍运行 `npm run build`（或 `npx tsc -b --noEmit`）作为独立的类型门禁 job；
  仅「产出部署静态产物」这一步使用 `vite build`。

---

## 6. 跟进建议

- **归属**：前端（H5）负责人。
- **优先级**：中（不阻塞当前融合交付，但累积技术债会掩盖真实类型问题，建议尽快排期）。
- **排期**：单独建前端类型健康专项，按上表 1–13 逐条修复。
- **回滚条件**：待 13 处错误清零后，将 `deploy/docker-compose.ai.yml` 与
  `agent/ai-platform/infra/Dockerfile.frontend` 中的 `npx vite build` 还原为 `npm run build`
  （或改由 CI 的 `tsc -b` 作为唯一卡点，部署产物保持 `vite build`）。

---

> 本文件为技术债登记，不含架构决策；架构结论以 `ai-fusion-deploy-decision.md` 为准。

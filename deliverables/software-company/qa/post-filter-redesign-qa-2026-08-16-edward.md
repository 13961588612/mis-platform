# QA 回归报告 — 岗位管理查询/表单筛选器改版（Request B）

- 验证人：Edward（QA 工程师，software-qa-engineer-2）
- 日期：2026-08-16
- 范围：`frontend/mis-admin-web`（无单测框架，门禁 = tsc/vite build + eslint + 定向代码审查）
- 基线：HEAD `23815c0 feat(org): 岗位管理查询条件 UI 重构——组织下拉多选 + 部门下拉树`（工作区未提交改动）

## 一、结论摘要

| 项 | 结果 |
| --- | --- |
| `npm run typecheck`（tsc --noEmit, strict + noUnusedLocals） | **PASS，0 错误** |
| `npm run build`（tsc --noEmit && vite build） | **PASS**，2288 modules transformed，`built in 39.07s`（整体 1m42s） |
| `npx eslint`（本次改动文件） | dept-tree-select.tsx **0 问题**；admin-list-page.tsx 5 error + 2 warning **均为未触及行的历史问题** |
| 四条需求验收 | **4/4 PASS** |
| 智能路由判定 | **NoOne（无需返工）** |
| IS_PASS | **YES** |

变更面（`git diff --stat HEAD -- src`）：
```
dept-tree-multi.tsx   | 256 --------  (deleted)
dept-tree-select.tsx  | 392 +++++---
admin-list-page.tsx   | 151 +++---
page-defs.ts          |   3 +-
4 files changed, 379 insertions(+), 423 deletions(-)
```

## 二、四条需求逐条验收

### 需求 1：查询栏「岗位名称」与「状态」筛选框同宽 — PASS

- `page-defs.ts:240` `{ key:'name', label:'岗位名称', type:'text', col:4 }`
- `page-defs.ts:244` `{ key:'status', label:'状态', type:'select', col:4 }`（diff 显示由 `col:2` → `col:4`，并附注释 L243）
- 栅格容器 `admin-list-page.tsx:1139` `grid grid-cols-1 ... md:grid-cols-12`，`col:4` 映射 `md:col-span-4`（L1143–1151 的 col 分支，default 即 col-span-4）。
- 结论：name/deptIds/orgIds 各占 4 列铺满第一行 12 列，status 落到第二行同样 4 列 → 与「岗位名称」等宽成立。

### 需求 2：部门/组织多选已选项不换行、超出隐藏、不撑高不滚动 — PASS

- 部门（`dept-tree-multi` → DeptTreeSelect multiple）chip 容器：`dept-tree-select.tsx:269`
  `flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden`；chip 自身 L278 `inline-flex shrink-0 ... whitespace-nowrap`。
- 组织（`multiselect` → FilterMultiSelect）chip 容器：`admin-list-page.tsx:561` 同样 `flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden`；chip L568 `shrink-0 whitespace-nowrap`。
- 触发器高度：`dept-tree-select.tsx:9-10` / `admin-list-page.tsx:309` `fieldInputClass = 'h-auto min-h-9 ...'`；因内层 nowrap + overflow-hidden，不会换行 → 高度恒定 min-h-9，不撑高。
- 无 `overflow-x-auto` / 无 `flex-wrap` 出现在上述两个 chip 容器（Grep 命中的 L97/388/1088/1428/1755 均为其它区域：表格标签、表单 multiselect 复选区、卡片头/分页栏，非本需求对象）。

### 需求 3：新增岗位表单「部门」复用查询树形下拉但为单选、选中即关闭 — PASS

- 表单字段：`page-defs.ts:254` `{ key:'deptId', label:'所属部门', type:'dept-tree', col:6, required:true, placeholder:'请选择部门（树形·单选）' }`
- 接线：`admin-list-page.tsx:427-437` `field.type==='dept-tree'` → `<DeptTreeSelect value=... onChange={(v)=>onChange(v==null?'':v)} />`（不传 multiple → 单选分支）。
- 单选行为：`dept-tree-select.tsx:165-171` `handleNodeClick` 中 `if(!multiple){ emit([node.id]); setOpen(false); return; }` → 选中即关弹层；`emit` L99-106 单选回传标量（空→null）。
- 单选无全选/清空：L300-321 仅 multiple 渲染「全选/清空」，单选渲染标题「选择部门（单选）」；复选框 L223 仅 multiple 出现。
- 触发器显示部门名：L252 `singleName`、L286-295 单值 `truncate` 文案分支。
- 复用同一组件（与查询栏 `dept-tree-multi` 同一 `DeptTreeSelect`）✔；组织 `<select>` 已移除（全文件无 `<select>`，`listOrgs` 仅用于 L122-153 聚合跨组织森林）；森林中 org 节点 `selectable:false`（L138）、dept 节点 `selectable:true`（L28）；默认全折叠 `useState<Set<string>>(new Set())`（L88，注释 L87）。

### 需求 4：单选/多选由参数控制以复用，删除冗余 dept-tree-multi.tsx — PASS

- 可辨识联合：`DeptTreeSelectSingleProps`（L43，`multiple?: false`）/ `DeptTreeSelectMultipleProps`（L54，`multiple: true`）/ `export type DeptTreeSelectProps`（L63）；运行时 `const multiple = props.multiple === true`（L82）。
- `FilterMultiSelect` 同构支持：`admin-list-page.tsx:516-526` 新增 `multiple?: boolean`（默认 `= true`，兼容 orgIds 现有接线）；L539-547 `pick` 单选 `onChange(v)+setOpen(false)`、多选增删；L548-549 全选/清空仅多选区渲染（L589-607）。
- 全部接线点核对：filter `dept-tree-multi`→L1177-1187 `multiple`；filter `dept-tree`→L1188-1193 单选；form `dept-tree`→L427；form `dept-tree-multi`→L440-452 `multiple`；AssignmentEditor→L198-201 单选（`handleDeptChange` L134-160 接收单值）。
- 旧文件删除：`git status` 显示 `D src/components/common/dept-tree-multi.tsx`，`ls src/components/common/` 已无该文件。
- 残留引用：`Grep "DeptTreeMulti"` 于 `src` 全目录 **No matches**；`import { DeptTreeSelect }` 保留于 L24（diff 显示被删的是 HEAD L25 的 `import { DeptTreeMulti }`）。
- 类型 token 保留：`features/system/types.ts:1` FieldType 仍含 `'dept-tree' | 'dept-tree-multi'`（页面定义 DSL 需要，非冗余）。

## 三、门禁明细

1. `npm run typecheck` → `tsc --noEmit` 无任何输出，退出 0 → **0 错误**（strict + noUnusedLocals 下 `AssignmentEditor` 保留但未用的 `deptOptions?` 属性不触发报错，因其为可选 props 成员而非未用局部变量）。
2. `npm run build` → `✓ 2288 modules transformed`、`✓ built in 39.07s`；产物 `index-DPIqYwJb.js 2,084.47 kB (gzip 528.14 kB)`、`index-ffGNoKH-.css 53.61 kB`。chunk >500kB 提示为项目历史既有告警，与本次改动无关。
3. `npx eslint src/components/common/dept-tree-select.tsx src/features/system/admin-list-page.tsx src/features/system/page-defs.ts`
   - dept-tree-select.tsx：**0**
   - page-defs.ts：**0**
   - admin-list-page.tsx：`42:27 / 43:31 / 44:27 / 45:23 / 50:8 arch/no-cross-feature`（AI 模块跨 feature import）+ `739:6`、`916:9` react-hooks/exhaustive-deps 警告。
     判定为历史遗留：本次 diff 触及行为 24、445-446、509-650、1178-1194（`git diff -U0` hunk 头），不含 42-50/739/916；且 `git show HEAD` 中原 L43-51 即为同样的 `@/features/ai/**` import（本次仅因删掉一行 import 使行号整体 -1）。

## 四、观察项（非阻塞，不影响验收，供后续迭代参考）

1. 单选形态无「清空」入口：再次点击已选部门不会取消选中（`handleNodeClick` L167-170 直接覆盖为同一 id）。当前表单 `deptId` 为 `required:true`，业务上不需要清空，故不构成缺陷；若将来出现可选的单选部门字段需补清空能力。
2. 首帧文案：`idToName` 依赖森林加载完成（L109-119），若表单回填/筛选回填在 `listOrgs+fetchDeptTree` 返回前，单选触发器暂显 placeholder、多选 chip 暂显原始 id（L280 `idToName.get(key) ?? key`）。加载完成后自动纠正，属可接受的瞬时态。
3. 筛选栏未渲染 `hint`（`page-defs.ts:241/242` 的 hint 文案在 L1140-1201 的筛选区未被使用，仅表单区渲染 hint）。属改版前既有行为，非本次回归项。

## 五、智能路由判定

- 源码 Bug：**无**（未发现验收点不成立或门禁失败项）。
- 测试/审查自身问题：无（审查口径已按新文件 `dept-tree-select.tsx` 校正）。
- **Send To: NoOne** — 全部通过，无需工程师返工。
- 本轮为 Round 1 即通过，未进入 Round 2。

# 增量架构设计：部门类型 + 编制数 + 是否末级

> 面向工程师的实现设计文档（仅设计 + 任务分解，不含实现代码）。
> 项目：`D:\code\mis-platform`；技术栈：前端 React+TS+Vite+MUI+shadcn/Zustand；后端 Spring Boot（mis-org / mis-admin-bff）；PostgreSQL 16；Flyway 只追加。
> 唯一门禁：`npm run typecheck`（tsc --noEmit, strict + noUnusedLocals）。

---

## 0. 阅读结论（关键事实确认）

| 项 | 结论 |
|---|---|
| `sys_post_type` 真实字段 | `id, tenant_id, code, name, sort, status, parent_id, is_leaf, created_at, updated_at`（**无** ancestors / level / org_id）。`sys_dept_type` 必须**精确对齐**此结构，不要自创字段。 |
| 最新迁移 | **V53**（`V53__add_post_quota.sql`）。新增迁移编号 = **V54**。 |
| 部门类型 ≠ 部门分类 | `sys_dept.category_id`（部门分类）与新增「部门类型」是**两个独立概念**，不复用 category，新建 `sys_dept_type` 表。 |
| TAB 落点 | 「岗位类型」是「岗位管理」的**子 Tab**（`PostManagePage` + `PostSubTabs`，`keep-alive-outlet` 中 `/system/post → PostManagePage`）。新增「部门类型」应作为「部门管理」的子 Tab，模式一致。 |
| BFF 透传模式 | BFF `PostController` 同时挂 `/api/v1/posts` 与 `/api/v1/post-types`；`OrgFacadeService`+`OrgWebClient` 桥接到 mis-org `/internal/v1/post-types`。部门类型同理：加进 BFF `DeptController` + `OrgFacadeService` + `OrgWebClient`。 |
| 编制数语义 | V53 给 `sys_post` 加 `quota INT NULL DEFAULT 0`（岗位编制/计划人数）。部门「编制数」= 部门级 headcount 配额，同义命名为 `establishment_count INT NULL DEFAULT 0`。 |
| `isLeaf` 在 post_type 中是**显式可写字段**（不按子节点推导）；`SysDept` 当前**没有** leaf 概念，部门的「是否末级」需另行计算（见 §1.2）。 |

---

## 1. 增量架构设计

### 1.1 数据模型

#### 1.1.1 新表 `sys_dept_type`（精确对齐 `sys_post_type` 实际字段）

```sql
CREATE TABLE sys_dept_type (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    sort        INT          NOT NULL DEFAULT 0,
    status      SMALLINT     NOT NULL DEFAULT 1,
    parent_id   BIGINT       NOT NULL DEFAULT 0,   -- 0 = 根级
    is_leaf     SMALLINT     NOT NULL DEFAULT 1,   -- 1=末级(可被部门选用) / 0=分类(可挂子类型)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_dept_type_tenant_code UNIQUE (tenant_id, code)
);
```

#### 1.1.2 `sys_dept` 加列

```sql
-- 部门类型 id（存量全量回填为「默认」子类型 id=1002）；应用层必填
ALTER TABLE sys_dept ADD COLUMN dept_type_id BIGINT NULL;
-- 编制数（部门 headcount 配额）；可空，默认 0
ALTER TABLE sys_dept ADD COLUMN establishment_count INT NULL DEFAULT 0;
```

> 不建外键（与 `sys_post.post_type_id` 处理一致，表间用逻辑 BIGINT 关联，降低迁移耦合）。

#### 1.1.3 种子数据（租户 1，固定 id，便于前端硬编码默认常量）

```sql
INSERT INTO sys_dept_type (id, tenant_id, code, name, sort, status, parent_id, is_leaf, created_at, updated_at)
VALUES
  (1001, 1, 'system',  '系统', 1, 1, 0,    0, NOW(), NOW()),  -- 分类(非末级)
  (1002, 1, 'default', '默认', 1, 1, 1001, 1, NOW(), NOW());  -- 末级（部门默认类型）
```

#### 1.1.4 存量 `sys_dept` 初始化

```sql
-- 存量部门全部初始化为「默认」末级类型(id=1002)
UPDATE sys_dept SET dept_type_id = 1002 WHERE dept_type_id IS NULL;
```

#### 1.1.5（可选）`sys_api` 登记（供 API 审计测试 `BffApiRegistryDiffSurveyTest`）

新增 5 个端点需在 `sys_api` 登记（沿用 V49 风格：固定 id + `WHERE NOT EXISTS` 幂等守卫）。若 CI 不跑该审计测试可跳过，但建议登记以防红灯：

```
GET  /api/v1/dept-types
GET  /api/v1/dept-types/tree
POST /api/v1/dept-types
PUT  /api/v1/dept-types/{id}
DELETE /api/v1/dept-types/{id}
```

---

### 1.2 「是否末级」实现方式决策

**结论：后端 `DeptService` 计算 `isLeaf`（无子部门 = 末级），不在前端按 `children` 推导。**

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 后端计算 isLeaf（选定）** | 单一真源；`tree()` / `getById()` / 未来扁平接口都能拿到；与「岗位类型显式 isLeaf」风格呼应；前端仅渲染 `node.isLeaf` | 需透传字段（mis-org DeptVO → BFF DeptVO → 前端 DeptNode），但本任务已在透传 deptTypeId/establishmentCount，边际成本低 |
| B. 前端按 children 推导 | 零后端改动 | 仅 tree 响应含 children 时有效；`getById`/扁平接口无法推导；懒加载/过滤场景下易误判（如子部门全禁用时） |

**计算规则**（与 post_type 末级语义区分：部门末级是**结构性的「有无子部门」**，非显式字段）：
- `tree()` / `pierce()`：用已加载集合的 `parentMap` 判定——`parentMap.getOrDefault(dept.id, []).isEmpty() ? 1 : 0`。
- `getById()`：`deptRepository.existsByOrgIdAndParentId(dept.orgId, dept.id) ? 0 : 1`。
- 计入 `DeptVO.deptTypeId / deptTypeName / establishmentCount / isLeaf` 四个新增字段。

---

### 1.3 「编制数」字段

- DB：`establishment_count INT NULL DEFAULT 0`（见 §1.1.2）。
- 含义：部门计划编制 / headcount 配额（整数，可编辑）。
- 表单：部门新增/编辑表单增加「编制数」数字输入框，默认 0。
- 透传：`DeptCreateRequest`/`DeptUpdateRequest`（mis-org 与 BFF）增加 `establishmentCount`；`DeptService.create/update` 写入实体；`DeptVO` 返回。

---

### 1.4 后端 mis-org 设计

**新增实体 `SysDeptType`（镜像 `SysPostType`，`@Table("sys_dept_type")`）**
字段：`id, tenantId, code, name, sort, status, parentId, isLeaf, createdAt, updatedAt`（getter/setter 全量）。

**新增 `SysDeptTypeRepository`（镜像 `SysPostTypeRepository`）**
方法：`findByTenantIdAndStatus`、`findByTenantId`、`findByTenantIdAndId`、`findByTenantIdAndCode`、`findByTenantIdAndParentId`、`existsByTenantIdAndParentId`。

**`SysDeptRepository` 扩展**
新增 `long countByDeptTypeId(Long)` 与 `boolean existsByDeptTypeId(Long)`（部门类型引用计数 / 删除拦截用）。

**`SysDept` 实体扩展**
增加 `deptTypeId`（Long）、`establishmentCount`（Integer）字段 + getter/setter。

**新增 DTO（mis-org，镜像 post-type 系列）**
- `DeptTypeVO(id, tenantId, code, name, sort, status, referenceCount, parentId, isLeaf)`
  - `referenceCount` = 引用该类型的部门数（`deptRepository.countByDeptTypeId`）。
- `DeptTypeTreeNodeVO(id, code, name, sort, status, isLeaf, referenceCount, parentId, children)`
- `DeptTypeCreateRequest(tenantId, code, name, sort, status, parentId, isLeaf)`（`@NotNull tenantId`、`@NotBlank code/name`）
- `DeptTypeUpdateRequest(name, sort, status, parentId, isLeaf)`（`code` 不可编辑）

**`DeptVO`（mis-org）扩展**（record 增加 4 字段）
`deptTypeId: String`、`deptTypeName: String`、`establishmentCount: Integer`、`isLeaf: Integer`。

**`DeptCreateRequest` / `DeptUpdateRequest`（mis-org）扩展**
各增加 `Long deptTypeId`、`Integer establishmentCount`（`deptTypeId` 在 create 中 `@NotNull`）。

**新增 `DeptTypeService`（镜像 `PostService` 的 type 方法）**
- `listTypes(tenantId, status)` → `List<DeptTypeVO>`（含 referenceCount）
- `listTypeTree(tenantId, status)` → `List<DeptTypeTreeNodeVO>`（按 parentId 递归组装）
- `createType(req)` → 校验 code 租户内唯一；`parentId` 默认 0；父须为非末级（分类）才可挂子（`requireParentAllowsChildren`）；`isLeaf` 归一化（默认 1）
- `updateType(id, req)` → 可选 `parentId` 防环（`isDescendant`）；`isLeaf` 变更约束（有子不可改末级、被部门引用不可改分类）
- `deleteType(id)` → 仅末级（`isLeaf==1`）可删；有子/被部门引用硬拦截
- 私有辅助：`buildTypeTree`、`toTypeVo`、`normalizeIsLeaf`、`requireParentAllowsChildren`、`requireCanMarkAsLeaf`、`requireCanMarkAsNonLeaf`、`isDescendant`

**`DeptService` 扩展**
- 注入 `SysDeptTypeRepository`。
- `toVo(dept, parentMap, orgNames, deptTypeNameMap)`：写入 `deptTypeId`（`String.valueOf`）、`deptTypeName`（由 map 解析）、`establishmentCount`、`isLeaf`（tree/pierce 用 parentMap 判定；getById 用 exists 判定）。
- `tree()` / `pierce()`：先收集 `all` 中 distinct `deptTypeId` → `deptTypeRepository.findAllById` → 构建 `deptTypeNameMap`；再递归组装并算 isLeaf。
- `create()` / `update()`：写入 `deptTypeId`、`establishmentCount`。

**`DeptController`（mis-org）扩展**
注入 `DeptTypeService`，新增区块（镜像 `PostController` 的 post-types 段）：
- `GET /internal/v1/dept-types?tenantId&status`
- `GET /internal/v1/dept-types/tree?tenantId&status`
- `POST /internal/v1/dept-types`
- `PUT /internal/v1/dept-types/{id}`
- `DELETE /internal/v1/dept-types/{id}`

---

### 1.5 BFF 透传设计（mis-admin-bff）

**`client/model/DeptVO` 扩展**（record 增加 4 字段，使 `OrgWebClient` JSON 反序列化自动捕获）：`deptTypeId, deptTypeName, establishmentCount, isLeaf`。

**`dto/DeptCreateRequest` / `dto/DeptUpdateRequest` 扩展**
各加 `Long deptTypeId`（`@NotNull` in create）、`Integer establishmentCount`。

**新增 BFF 模型/DTO（镜像 post-type）**
- `client/model/DeptTypeVO`、`client/model/DeptTypeTreeNodeVO`
- `dto/DeptTypeCreateRequest`、`dto/DeptTypeUpdateRequest`

**`OrgFacadeService` 扩展**
- `createDept` / `updateDept`：body 增加 `deptTypeId`、`establishmentCount`。
- 新增 `listDeptTypes(status)`、`listDeptTypeTree(status)`、`createDeptType(req)`、`updateDeptType(id, req)`、`deleteDeptType(id)`（镜像 post-type 方法，tenantId 经 `RequestContext.requireTenantId()` 注入）。

**`OrgWebClient` 扩展**
新增 5 个方法，桥接 `/internal/v1/dept-types*`（`listDeptTypes`、`listDeptTypeTree`、`createDeptType(body)`、`updateDeptType(id, body)`、`deleteDeptType(id)`），复用既有的 `POST_TYPE*` 类型引用模式（新增 `DEPT_TYPE` / `DEPT_TYPE_LIST` / `DEPT_TYPE_TREE_LIST` `ParameterizedTypeReference`）。

**`controller/DeptController`（BFF）扩展**
新增 `/api/v1/dept-types` 系列端点（镜像 `PostController.post-types` 段），委托 `OrgFacadeService`。

---

### 1.6 前端设计（frontend/mis-admin-web）

**`src/types/api.ts`**
- `DeptNode` 扩展：`deptTypeId?: string | null; deptTypeName?: string | null; establishmentCount?: number | null; isLeaf?: number | null;`
- 新增 `DeptTypeItem`（镜像 `PostTypeItem`）、`DeptTypeTreeNode`（镜像 `PostTypeTreeNode`）。

**`src/lib/api/depts.ts`**
- `createDept` / `updateDept` body 类型增加 `deptTypeId?: number; establishmentCount?: number;`。

**`src/lib/api/dept-types.ts`**（新建，镜像 `post-types.ts`）
- `listDeptTypes(status?)`、`listDeptTypeTree(status?)`、`createDeptType(body)`、`updateDeptType(id, body)`、`deleteDeptType(id)`；路径 `/dept-types[/tree]`。

**`src/components/common/dept-type-tree-select.tsx`**（新建，镜像 `post-type-tree-select.tsx`）
- 用 `listDeptTypeTree`；props 含 `selectMode: 'leaf' | 'non-leaf' | 'any'`、`excludeId`、`placeholder`；部门表单用 `selectMode="leaf"`（仅末级可选）。

**`src/features/system/dept/dept-type-version-store.ts`**（新建，镜像 `post-type-version-store.ts`）
- zustand store：`deptTypeVersion` + `bumpDeptTypeVersion()`，用于类型变更后刷新部门树（作 `key`）。

**`src/features/system/dept/dept-type-manage-page.tsx`**（新建，镜像 `post-type-manage-page.tsx`）
- 树表列：名称（缩进/展开）/ 编码 / 层级 / 末级 / 排序 / 状态 / 操作（仅非末级可「子类型」，末级可删）。
- 表单：上级类型（DeptTypeTreeSelect, non-leaf）、编码(新建必填)、名称、是否末级、排序、状态。
- 保存调用 `createDeptType` / `updateDeptType`；成功后 `bumpDeptTypeVersion()`。
- 接收 `headerExtra`（子 Tab）以嵌入「部门树 / 部门类型」切换。

**`src/features/system/dept/dept-manage-page.tsx`**（新建，镜像 `post-manage-page.tsx`）
- 内部 `tab: 'tree' | 'types'` + `DeptSubTabs`（部门树 / 部门类型）。
- `tab==='types'` → `<DeptTypeManagePage headerExtra={subTabs}/>`；否则 `<DeptTreePage headerExtra={subTabs} key={deptTypeVersion}/>`。
- 路由接入：`keep-alive-outlet.tsx` 将 `'/system/dept': DeptTreePage` 改为 `'/system/dept': DeptManagePage`。

**`src/features/system/dept/dept-tree-page.tsx`**（修改）
- 新增可选 `headerExtra?: ReactNode` 并传入 `PageHeader` 的 `actions`（承载子 Tab）。
- 列定义（`columns`）在「编码」后插入三列：**编制数 / 部门类型 / 是否末级**（保持 `useColumnWidths` 存储键不变或顺延）。
- `renderNodes` 渲染：
  - 编制数：`node.establishmentCount ?? 0`
  - 部门类型：`node.deptTypeName ?? '—'`
  - 是否末级：`node.isLeaf === 1 ? 末级(badge) : 非末级(badge)`
- 表单（`Sheet`）新增：
  - 「部门类型」→ `DeptTypeTreeSelect`（`selectMode="leaf"`，新建默认 `DEFAULT_DEPT_TYPE_ID = 1002`，硬编码常量，对齐既有 `DEFAULT_CATEGORY_ID = 3` 模式）
  - 「编制数」→ 数字输入框，默认 0
- `onSave`：`createDept`/`updateDept` 携带 `deptTypeId`、`establishmentCount`。

**`src/components/layout/keep-alive-outlet.tsx`**（修改）
- `import { DeptManagePage }` 替换 `DeptTreePage`；路由表 `'/system/dept'` 指向 `DeptManagePage`。

---

## 2. 依赖包 / 迁移文件清单

### 2.1 第三方依赖
本次为**纯增量、复用既有技术栈**，**无新增第三方依赖**：
- 前端：React / TS / Vite / MUI / shadcn / Zustand / lucide-react（均已在工程内）。
- 后端：Spring Boot / Spring Data JPA / WebClient（BFF）/ Flyway（均已在工程内）。
- 如需类型安全增强，可后续补，但本期不引入。

### 2.2 Flyway 迁移文件（**新增唯一文件**）
| 文件 | 内容要点 |
|---|---|
| `backend/mis-migrator/src/main/resources/db/migration/V54__dept_type_and_dept_fields.sql` | ① `CREATE TABLE sys_dept_type`（对齐 sys_post_type 实际字段）；② `ALTER TABLE sys_dept ADD COLUMN dept_type_id BIGINT NULL` + `establishment_count INT NULL DEFAULT 0`；③ 种子：系统(1001, parent=0, is_leaf=0) / 默认(1002, parent=1001, is_leaf=1)；④ `UPDATE sys_dept SET dept_type_id=1002 WHERE dept_type_id IS NULL`；⑤（可选）`sys_api` 登记 5 个 dept-types 端点（幂等守卫）。 |

---

## 3. 任务列表（有序、含依赖、文件相对路径 + 改动要点）

> 共 5 个任务，按实现顺序线性依赖（T1→T2→T3→T4→T5）。每个任务文件数 ≥3，符合「按层分组、不单文件拆分」；T1 为地基（数据库迁移）。

### T01 · 数据库迁移（Flyway V54） — P0
- **文件**：`backend/mis-migrator/src/main/resources/db/migration/V54__dept_type_and_dept_fields.sql`（新建）
- **改动要点**：按 §1.1 落地 DDL + 种子 + 存量初始化（+ 可选 sys_api 登记）。
- **依赖**：无。

### T02 · 后端 mis-org 数据层（实体 / Repository / DTO + SysDept 字段） — P0
- **文件**：
  - `backend/mis-org/src/main/java/com/mis/org/domain/entity/SysDeptType.java`（新建）
  - `backend/mis-org/src/main/java/com/mis/org/domain/repository/SysDeptTypeRepository.java`（新建）
  - `backend/mis-org/src/main/java/com/mis/org/domain/repository/SysDeptRepository.java`（改：加 `countByDeptTypeId`/`existsByDeptTypeId`）
  - `backend/mis-org/src/main/java/com/mis/org/domain/entity/SysDept.java`（改：加 `deptTypeId`/`establishmentCount` 字段+getter/setter）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptTypeVO.java`（新建）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptTypeTreeNodeVO.java`（新建）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptTypeCreateRequest.java`（新建）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptTypeUpdateRequest.java`（新建）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptVO.java`（改：加 4 字段）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptCreateRequest.java`（改：加 `deptTypeId`/`establishmentCount`）
  - `backend/mis-org/src/main/java/com/mis/org/dto/DeptUpdateRequest.java`（改：加 `deptTypeId`/`establishmentCount`）
- **依赖**：T01。

### T03 · 后端 mis-org 服务与路由（DeptTypeService + DeptService 扩展 + DeptController） — P0
- **文件**：
  - `backend/mis-org/src/main/java/com/mis/org/service/DeptTypeService.java`（新建，镜像 PostService type 方法）
  - `backend/mis-org/src/main/java/com/mis/org/service/DeptService.java`（改：注入 DeptTypeRepository；toVo 加 deptTypeId/deptTypeName/establishmentCount/isLeaf；create/update 写字段）
  - `backend/mis-org/src/main/java/com/mis/org/controller/DeptController.java`（改：注入 DeptTypeService；加 `/internal/v1/dept-types*` 5 端点）
- **依赖**：T02。

### T04 · BFF 透传层（部门字段透传 + 部门类型端点） — P0
- **文件**：
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/model/DeptVO.java`（改：加 4 字段）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/DeptCreateRequest.java`（改：加 `deptTypeId`/`establishmentCount`）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/DeptUpdateRequest.java`（改：加 `deptTypeId`/`establishmentCount`）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/model/DeptTypeVO.java`（新建）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/model/DeptTypeTreeNodeVO.java`（新建）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/DeptTypeCreateRequest.java`（新建）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/dto/DeptTypeUpdateRequest.java`（新建）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/service/OrgFacadeService.java`（改：dept 请求体加字段 + 5 个 dept-type 方法）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/OrgWebClient.java`（改：5 个 dept-type WebClient 方法）
  - `backend/mis-admin-bff/src/main/java/com/mis/adminbff/controller/DeptController.java`（改：加 `/api/v1/dept-types*` 5 端点）
- **依赖**：T02、T03（合约对齐）。

### T05 · 前端实现（API / 组件 / 页面 / 集成） — P0
- **文件**：
  - `frontend/mis-admin-web/src/types/api.ts`（改：DeptNode 扩展 + 新建 DeptTypeItem/DeptTypeTreeNode）
  - `frontend/mis-admin-web/src/lib/api/depts.ts`（改：createDept/updateDept 加 deptTypeId/establishmentCount）
  - `frontend/mis-admin-web/src/lib/api/dept-types.ts`（新建）
  - `frontend/mis-admin-web/src/components/common/dept-type-tree-select.tsx`（新建）
  - `frontend/mis-admin-web/src/features/system/dept/dept-type-version-store.ts`（新建）
  - `frontend/mis-admin-web/src/features/system/dept/dept-type-manage-page.tsx`（新建）
  - `frontend/mis-admin-web/src/features/system/dept/dept-manage-page.tsx`（新建）
  - `frontend/mis-admin-web/src/features/system/dept/dept-tree-page.tsx`（改：headerExtra + 三列 + 表单加部门类型/编制数）
  - `frontend/mis-admin-web/src/components/layout/keep-alive-outlet.tsx`（改：`/system/dept` → DeptManagePage）
- **依赖**：T04。

---

## 4. 待明确事项 / 假设（不阻塞开工，先给推荐方案）

1. **「编制数」业务含义**：按 V53 的 `quota`（岗位编制/计划人数）同义处理为部门级 headcount 配额；若实际含义是「已有人数」或「编制上限」需另行约定——当前按「计划编制数（可编辑整数，默认 0）」实现。
2. **「是否末级」实现方式**：已选定**后端计算 isLeaf**（§1.2），不依赖前端 children 推导，保证多消费方一致。
3. **TAB 落点**：作为「部门管理」的**子 Tab**（镜像「岗位类型」之于「岗位管理」），不新建菜单项。若希望是顶层独立菜单，需额外在 `system-nav.ts` 与路由注册——本期按子 Tab 处理。
4. **存量部门默认类型**：全部初始化为「默认」(id=1002)；前端硬编码 `DEFAULT_DEPT_TYPE_ID = 1002`（对齐既有 `DEFAULT_CATEGORY_ID = 3` 模式）。若种子 id 调整需同步前端常量。
5. **新建部门表单「部门类型」默认**：默认预选「默认」(1002)，用户可改选其它末级类型；后端 create 请求 `@NotNull deptTypeId` 强制必填。
6. **`sys_api` 登记**：新增 5 个 dept-types 端点是否要登记依赖 API 审计测试（`BffApiRegistryDiffSurveyTest`）是否纳入 CI。推荐登记以防红灯；若确认不跑可省。
7. **部门类型是否可删除/引用的强约束**：镜像 post-type——仅末级可删、有子/被部门引用拦截。删除「默认」会被存量部门引用拦截（符合预期，避免误删）。
8. **`DeptPierceVO`**：组织穿透视图本次不强制加新字段（仅部门树表需求）；如穿透视图也需展示类型/编制，可后续补，本设计不含。

---

## 5. 共享约束（Shared Knowledge，供工程师）

- 统一响应 `code=0` 为成功；mis-org 内部前缀 `/internal/v1`，BFF 对外前缀 `/api/v1`。
- Flyway **只追加**：新表/新列/种子一律新迁移（V54），**不修改** V1–V53 任何文件。
- **部门类型 ≠ 部门分类**：`sys_dept_type` 与 `sys_dept.category_id` 独立，勿复用。
- 前端唯一门禁 `npm run typecheck`（strict + `noUnusedLocals`）：新文件不得出现未使用变量/导入；新增 TS 类型需与后端 VO 字段名一致（camelCase 对齐）。
- `arch/no-cross-feature` lint：新功能放进各自 feature 目录（`features/system/dept/`），公共组件放 `components/common/`，API 放 `lib/api/`，不跨域耦合。
- `isLeaf` 为后端计算（无子部门 = 末级），前端只读 `node.isLeaf`。
- id 生成沿用 `IdGenerator.nextId()`（mis-org）或固定种子 id（迁移）。
- WebClient 类型引用：新增 `DEPT_TYPE` / `DEPT_TYPE_LIST` / `DEPT_TYPE_TREE_LIST` `ParameterizedTypeReference` 复用既有 `POST_TYPE*` 写法。

---

## 6. 图示

- 类图：`docs/dept-type-class-diagram.mermaid`
- 时序图（部门树加载 + 部门类型创建）：`docs/dept-type-sequence-diagram.mermaid`

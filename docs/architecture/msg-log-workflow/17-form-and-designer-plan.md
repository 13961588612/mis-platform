# 17 · 业务表单机制 + 流程编排改造方案

> **作者**：高见远（Gao）· 架构师
> **委托**：齐活林 · 交付总监
> **日期**：2026-10-09
> **范围**：`form_definition` 建表 / 表单组件注册表 / ProcessShell 审批套壳 / 流程编排改全屏 Dialog
> **状态**：待主理人拍板（见文末 §6）

---

## 0. 先说事实核对：主理人描述里需要修正的 6 处

以下 6 点是我实际读代码后与来件描述不一致的地方，**方案按修正后的结论走**，请主理人确认。

| # | 来件描述 | 实际情况（已核实） | 影响 |
|---|---|---|---|
| 1 | `process-shell.tsx:140-152` 是「4 个固定字段」 | 文件实际在 `frontend/mis-admin-web/src/features/taskflow/process-shell.tsx`（**不是** `system/workflow-designer/` 下）。4 个 `ReadOnlyField` 在 **196-209 行**；`:136` 附近没有布局代码，`lg:grid-cols-3` 在 **193 行** | Q3 全部行号需替换，路径需纠正 |
| 2 | `supported_form_codes TEXT[]`（未提版本） | `wf_definition` 唯一索引是 `uk_wf_def_tenant_code_ver (tenant_id, code, version) WHERE deleted=0`（V121:26）⇒ **同 code 可多版本并存**，「取消发布」不能删定义，只能改 `status` | Q1 表设计要区分「软删可复用 code」与「版本」两个语义 |
| 3 | `form_data JSONB` 已参与分支判断 | 确认。但 **`ProcessDetailVO` / `WfInstanceVO` 根本没有 `formData` 字段**（`WfInstanceVO.java:5-22` 共 16 个 record 分量，无 formData）⇒ 套壳拿不到数据，**后端必须扩 VO** | 这是本方案最大的隐藏工作量，Q3 单列 |
| 4 | 迁移最后是 V127 | 确认。但 **`sys_api` 段位 95049 已被 V125 注释预订但未占用，95045-95048 已占**；新端点须从 **95050** 起 | Q1 段位规划 |
| 5 | `components/ui/` 缺 date/number/checkbox 等 | 确认（仅 alert/badge/button/card/collapsible/dialog/input/label/popover/select/sheet/skeleton/table/tabs/textarea）。但 **`@radix-ui/react-checkbox` 已在 package.json（1.3.8）** ⇒ 无需新装依赖 | Q2 控件补齐成本下降 |
| 6 | 编排页 `navigate('/system/workflow/designer')` 有 3 处 | 确认 `definitions-page.tsx:75 / 97 / 151`。**另外 `keep-alive-outlet.tsx:149` 注册了 `/system/workflow/designer` 路由，`lib/nav/system-nav.ts:67` 有侧栏项，`V123:44` 有 sys_menu 95007** ⇒ 改 Dialog 后这三处都要处理，否则侧栏点「流程编排」会打开一个空画布 | Q4 范围扩大 |

**额外发现（来件未提，但是关键）**：`designer-page.tsx:161-172` 的保存流程是
`POST /workflow/definitions`（新建）→ `POST /{id}/activate`。
它**从不调用** `PUT /workflow/definitions/{id}`，且 **`PUT` 端点未登记 `sys_api`**（V123 只登记了 GET/POST/activate 三个）。
⇒ 「编辑已有定义」这条路今天就是 403。凡是本方案要支持编辑的，**必须补登记 `PUT`**。

---

## Q1 · `form_definition` 表设计

### 1.1 建模决策：分类树用哪种？

**结论：单表自引用 `parent_id`（邻接表），不建独立 `form_category` 表。**

理由（按权重排序）：

| 维度 | 单表自引用 | 独立 `form_category` 表 |
|---|---|---|
| 交付量 | 1 张表 + 1 套 CRUD | 2 张表 + 2 套 CRUD + 1 套关联维护 |
| 分类树深度 | 需求上限 2-3 层（业务域/分组 → 表单） | 同 |
| 事务一致性 | 单表事务，无跨表 | 删分类要校验子表单，跨表事务 |
| 迁移风险 | 1 个新表 | 2 个新表 + 未来若合表要再迁移 |
| 扩展性 | 若日后要「分类级权限/分类级表单模板」，`form_category` 独立更从容 | 更从容 |

**判断依据**：本仓库既有的树形参照物是 `sys_menu`（自引用 `parent_id` + `uk_menu_app_code`）与 `kb_category`（`parent_id BIGINT NULL`，V12:12-23）。两者都是**单表自引用**，没有「分类独立成表」的先例。表单分类的语义复杂度远低于菜单（不需要 `type`/`permission`/`api` 三态），拆表带来的收益不足以抵消交付成本。

**层级收敛**：用 `CHECK` 限死深度不可行（PG CHECK 不能跨行），改用**应用层限制**：`新增/移动分类` 时若 `parent_id != 0` 且父节点已有父节点 ⇒ 拒绝。理由见 §6 拍板点 3。

### 1.2 DDL（V128 迁移骨架）

```sql
-- V128__form_definition_and_unpublish.sql
-- 业务表单注册表（form_definition）+ 流程「取消发布」端点登记
-- PostgreSQL 16 | 幂等：IF NOT EXISTS / NOT EXISTS / ON CONFLICT DO NOTHING
-- 段位：sys_menu 95010-95011 空闲；sys_api 95050-95056 空闲；sys_menu_api 95050-95056 空闲

-- ---------------------------------------------------------------------------
-- 1) 业务表单注册表
--    一条记录 = 一个 formCode = 前端注册表里的一个组件。
--    后台管「哪个 formCode 存在、归哪一类、启用没有」；前端管「它长什么样」。
--    刻意不存 schema：不做低代码设计器（用户 2026-10-09 裁决）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_definition (
    id                BIGINT PRIMARY KEY,
    tenant_id         BIGINT       NOT NULL,
    parent_id         BIGINT       NOT NULL DEFAULT 0,   -- 0=根分类；自引用
    code              VARCHAR(64)  NOT NULL,             -- = 前端注册表 key，精确匹配（大小写敏感）
    name              VARCHAR(128) NOT NULL,             -- 中文名，后台展示用
    description       TEXT         NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'ENABLED',  -- ENABLED/DISABLED
    sort_order        INT          NOT NULL DEFAULT 0,
    config            JSONB        NOT NULL DEFAULT '{}'::jsonb, -- 预留：图标/分组/排序权重
    deleted           SMALLINT     NOT NULL DEFAULT 0,
    created_by        BIGINT       NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- code 是身份：软删后**不允许**复用（历史实例的 started_form_code 会指向新表单 ⇒ 审批页显示错数据）
    CONSTRAINT uk_form_def_tenant_code UNIQUE (tenant_id, code)
);

-- 分类树下钻（管理界面左侧树）
CREATE INDEX IF NOT EXISTS idx_form_def_tree    ON form_definition (tenant_id, parent_id, sort_order) WHERE deleted = 0;
-- 「哪些流程用了这个表单」反查（编排弹窗禁用已引用项）
CREATE INDEX IF NOT EXISTS idx_form_def_status  ON form_definition (tenant_id, status) WHERE deleted = 0;
```

**⚠️ 关于 `uk_form_def_tenant_code` 不带 `WHERE deleted = 0`（与 `wf_definition` 不同）**：

`wf_definition` 用 `uk ... (tenant_id, code, version) WHERE deleted = 0` ⇒ 软删后 code+version 可复用。
但 `form_definition.code` **不能复用**——`wf_instance.started_form_code` 是**字符串软引用**（无外键），
历史实例里存着 `'PUR_FORM'`，若该 code 被软删又新建了同名不同实现的表单，
老实例的审批页会渲染出新组件 ⇒ **审批人看到的是错的业务数据**。
这是数据正确性问题，不是洁癖。

> 处置：删除 `form_definition` 时**必须**先检查 `wf_definition.supported_form_codes @> ARRAY[code]`
> 与 `wf_instance.started_form_code = code`，有引用则拒绝删除（返回业务异常，提示先改流程白名单）。
> 见 §5 任务 T3.3。

### 1.3 索引清单（对齐项目「tenant_id + deleted」惯例）

| 索引 | 用途 | 覆盖查询 |
|---|---|---|
| `PRIMARY KEY (id)` | 点查/关联 | `getById` |
| `uk_form_def_tenant_code (tenant_id, code)` **UNIQUE** | 按 code 精确取（含软删行，用于冲突判定） | 白名单校验、删除前引用检查 |
| `idx_form_def_tree (tenant_id, parent_id, sort_order) WHERE deleted=0` | 分类树一层下钻 | `listChildren(tenantId, parentId)` |
| `idx_form_def_status (tenant_id, status) WHERE deleted=0` | 编排弹窗拉「可选表单」清单 | `listEnabled(tenantId)` |

**不建** `(tenant_id, deleted)` 单列索引——现有查询都带更左前缀的 `tenant_id` + 具体列，
单列索引只增写放大。若实测 `EXPLAIN` 走全表再补（不在本次范围）。

### 1.4 是否挂 `sys_menu`

**结论：要挂。** 不挂就没有侧栏入口，等于让管理员靠手输 URL 维护——不可接受。

挂载位置：**挂「系统管理」(id=200) 下新目录「表单管理」**，与既有「流程中心」(V123 建在 200 下) 平级。
不进「流程中心」的原因：表单注册是**跨流程的公共资产**（采购/报销/请假都用），挂在流程中心下面暗示从属关系。

#### V128 的 `sys_menu` 登记（第三次踩坑，必须写全）

```sql
-- 2) 菜单：表单管理目录 + 页面（挂「系统管理」200 下）
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95010, 1, 1, 200, 'biz-form-defs', '表单管理', 1, '/system/forms',      NULL, NULL,                     'FileStack', 22, 1, 1, NOW(), NOW()),
  (95011, 1, 1, 95010, 'biz-form-list', '表单注册', 2, '/system/forms',    NULL, 'biz:form:list',         'ListTree', 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code);
```

⚠️ **目录（type=1）的 `permission` 必须为 NULL**——`uk_menu_app_permission` 是
`(app_id, permission) WHERE status=1 AND permission IS NOT NULL` 的部分唯一索引（V1:269-270），
且 V17 已用血写下教训：**同一 app 下两行不能共用同一 permission**。
目录行给了 permission 就必须与页面行的 `biz:form:list` 不同，徒增冲突面 ⇒ 置 NULL。

⚠️ **不能建「按钮节点」复用 `biz:form:list`**（V17 结论，本仓库「一码一功能」）。
需要更细的权限时只能新增独立 code 的按钮行，且**不得与任何已有行重复**。

#### V128 的 `sys_api` 登记（deny-unmapped 的第三次拦截）

```sql
-- 3) sys_api：表单注册 CRUD + 取消发布 + 补登记缺失的 PUT
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95050, 95010, 95010, '00950050', 'api'::sys_api_node_type, '取消发布流程定义','POST','/api/v1/workflow/definitions/{id:[0-9]+}/deactivate', 50, 1, NOW(), NOW()),
  (95051, 95010, 95010, '00950051', 'api'::sys_api_node_type, '更新流程定义',  'PUT', '/api/v1/workflow/definitions/{id:[0-9]+}',            51, 1, NOW(), NOW()),
  (95052, 95010, 95010, '00950052', 'api'::sys_api_node_type, '表单列表',      'GET', '/api/v1/workflow/forms',                                   52, 1, NOW(), NOW()),
  (95053, 95010, 95010, '00950053', 'api'::sys_api_node_type, '表单详情',      'GET', '/api/v1/workflow/forms/{id:[0-9]+}',                        53, 1, NOW(), NOW()),
  (95054, 95010, 95010, '00950054', 'api'::sys_api_node_type, '新建表单',      'POST','/api/v1/workflow/forms',                                   54, 1, NOW(), NOW()),
  (95055, 95010, 95010, '00950055', 'api'::sys_api_node_type, '更新表单',      'PUT', '/api/v1/workflow/forms/{id:[0-9]+}',                        55, 1, NOW(), NOW()),
  (95056, 95010, 95010, '00950056', 'api'::sys_api_node_type, '删除表单',      'DELETE','/api/v1/workflow/forms/{id:[0-9]+}',                      56, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );
```

⚠️ **95051（`PUT /workflow/definitions/{id}`）是补登记**——端点已存在于
`WfDefinitionController.java:38-44`，但 V123 漏了，本次一并补齐。
不改这一行，「编辑已有定义」必 403。

#### V128 的 `sys_menu_api` 绑定

```sql
-- 4) 菜单 ⇄ API 绑定
--    取消发布 / PUT 更新 → 挂「流程编排」(95007，permission=workflow:definition:edit)
--    表单 CRUD          → 挂「表单注册」(95011，permission=biz:form:list)
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95050, 95007, 95050, 3, NOW()),  -- 取消发布
  (95051, 95007, 95051, 4, NOW()),  -- PUT 更新定义
  (95052, 95011, 95052, 1, NOW()),  -- 表单列表
  (95053, 95011, 95053, 2, NOW()),  -- 表单详情
  (95054, 95011, 95054, 3, NOW()),  -- 新建表单
  (95055, 95011, 95055, 4, NOW()),  -- 更新表单
  (95056, 95011, 95056, 5, NOW())   -- 删除表单
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- 5) 内置租户管理员（role_id=1）菜单授权
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.* FROM (VALUES
  (95010, 1, 'menu'::sys_perm_type, 95010, NOW()),
  (95011, 1, 'menu'::sys_perm_type, 95011, NOW())
) AS v(id, role_id, perm_type, target_id, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp WHERE rp.role_id = v.role_id AND rp.perm_type = v.perm_type AND rp.target_id = v.target_id)
  AND EXISTS (SELECT 1 FROM sys_role WHERE id = v.role_id);
```

**⚠️ 表单管理属「管理工作」⇒ 保留 `permission` 校验**（V127 原则：只有 `/task/*` 个人事务置 NULL）。
`biz:form:list` 挂在页面行上，走 `MenuService.permissionCodes()`（`MenuService.java:85-92`，不过滤 type）
⇒ 用户权限码集合里会出现 `biz:form:list`，前端 `PermissionGate` 直接可用。

**⚠️ V128 不得触碰 V127 的 `/task/*` 菜单**（95001-95005 的 `permission` 必须保持 NULL）。
若有人「顺手统一」把 `workflow:definition:view` 也置 NULL，个人事务与管理工作就混了。

---

## Q2 · 组件契约与注册表

### 2.1 目录布局（落地位置：`features/biz/forms/`）

```
frontend/mis-admin-web/src/features/biz/forms/
├── types.ts                    # FormProps / FormFieldSchema / FormRegistryEntry
├── registry.ts                 # 注册表（Map + 增删查 + 订阅）
├── registry.test.ts            # 单测：注册/重复注册/未知 code 兜底
├── form-shell.tsx              # 套壳渲染器（只读态分发 + 兜底）
├── form-shell.test.tsx
├── fields/                     # 通用字段渲染器（只读态专用）
│   ├── read-only-text.tsx      # 文本/长文本
│   ├── read-only-number.tsx    # 数值千分位
│   ├── read-only-date.tsx      # 日期中文格式化
│   ├── read-only-select.tsx    # 单选 → 标签
│   ├── read-only-multi.tsx     # 多选 → 标签组
│   ├── read-only-bool.tsx      # 是/否 徽标
│   └── index.ts
├── forms/                      # 具体业务表单组件（一个 formCode 一个文件）
│   ├── pur-order-form.tsx      # PUR_ORDER
│   └── ...
└── pages/
    ├── form-registry-page.tsx  # 表单注册管理页（树 + 表格 + 抽屉）
    └── form-registry-page.test.tsx
```

**为什么单独开 `biz/` 域**：现有 `features/` 下是 `system`（平台管理）/ `taskflow`（流程）/ `kb`（知识库）/ `finance`（业务）。
表单注册是**平台能力但服务业务**，塞进 `system/` 会让 `system/` 继续膨胀；`biz/` 是天然的归属。

### 2.2 `FormProps` 契约

```ts
// features/biz/forms/types.ts

/** 表单值的原子类型：表单数据是**扁平**的（见 §2.5）。 */
export type FormScalar = string | number | boolean | null;

/** 表单数据 = 扁平键值对。键即 fieldKey，供 conditionExpr 引用。 */
export type FormData = Record<string, FormScalar>;

/** 字段描述：只读态渲染 + 表单管理页展示用，不参与录入校验。 */
export interface FormFieldSchema {
  key: string;
  label: string;
  /** 决定只读态用哪个渲染器。缺省 'text'。 */
  type?: 'text' | 'textarea' | 'number' | 'date' | 'datetime'
      | 'select' | 'multi' | 'bool';
  /** select/multi 的候选：value → label。只读态显示 label，不显示 value。 */
  options?: Array<{ value: string; label: string }>;
  /** 数字字段的展示单位，如 '元' / '%'。 */
  unit?: string;
  /** 多选字段是否在只读态折叠（默认展示前 3 个 + 「等 N 项」）。 */
  collapseInReadonly?: boolean;
}

export interface FormProps {
  /** 本表单的 code。与后端 form_definition.code 精确一致。 */
  formCode: string;
  /** 当前数据。只读态恒有值（可能为空对象）。 */
  value: FormData;
  /**
   * 只读态开关（受控）。
   *
   * 决策记录见 §2.4：**用 prop，不用 ref 命令式方法**。
   */
  readOnly: boolean;
  /** 字段 schema，供套壳在未知字段/无 schema 时降级为 JSON 兜底。 */
  fields: FormFieldSchema[];
  /** 流程实例 ID（只读态用；录入态 undefined）。便于组件按实例取额外信息。 */
  instanceId?: string;
  /** 业务对象 ID（只读态用）。 */
  businessId?: string;
  /** 录入态的值变更回调。只读态下组件**不得**调用。 */
  onChange?: (next: FormData) => void;
}

export type FormComponent = React.ComponentType<FormProps>;

/** 注册表条目：组件 + 自描述元信息。 */
export interface FormRegistryEntry {
  formCode: string;
  name: string;
  component: FormComponent;
  /** 字段 schema 也登记在组件上，供管理页与「后台定义 vs 前端注册」一致性检查用。 */
  fields: FormFieldSchema[];
  /** 该表单依赖的前端特性包标识，用于排查「后台有、前端没有」。 */
  bundle?: string;
}
```

**设计要点**：

| 字段 | 为什么要有 |
|---|---|
| `formCode` | 组件自己声明身份。注册表按它索引；套壳按它查。避免「注册时的 key」和「组件内部认的 key」漂移。 |
| `readOnly` **受控 prop** | 见 §2.4。 |
| `fields` | **只读渲染的依据**。若只靠 `value` 猜类型，`amount: 50000` 会被当文本渲染（无千分位）、`2026-10-09` 无法中文化。 |
| `onChange` **可选** | 只读态组件不必实现它。类型上可选 = 编译期提醒「你少写了」。 |
| 不含 `tenantId` | 租户是**数据隔离**维度，不是表单维度。别把它泄漏进每个业务组件的 props。 |
| 不含 `mode` | `mode`（EDIT/REVIEW）会被 `readOnly` 完全决定，加了就是冗余状态。 |

### 2.3 注册表文件与组织

```ts
// features/biz/forms/registry.ts —— 只做「注册 + 查询」，不含 UI，不含业务

const entries = new Map<string, FormRegistryEntry>();
const listeners = new Set<() => void>();

/** 注册一个表单。重复 code 抛错（开发期立即暴露，避免静默覆盖）。 */
export function registerForms(list: readonly FormRegistryEntry[]): void;

/** 批量注册（测试用：重置注册表）。 */
export function __resetRegistryForTest(): void;

/** 按 code 取组件；未注册返回 null（**不抛异常**，交由套壳兜底）。 */
export function resolveForm(formCode: string | null | undefined): FormRegistryEntry | null;

/** 是否已注册。 */
export function isFormRegistered(formCode: string | null | undefined): boolean;

/** 全部已注册 code（管理页一致性检查用）。 */
export function listRegisteredCodes(): string[];

/** 订阅注册表变化（管理页在「新增表单」时刷新「前端已注册」列）。 */
export function subscribeRegistry(fn: () => void): () => void;
```

**组织约定**：

- **注册表是纯 Map + 纯函数**，不 import 任何 React 组件 ⇒ 可在 `node` 环境单测（vitest 默认 `environment: 'node'`）。
- **具体表单组件的注册放在 `forms/index.ts`**（barrel），由管理页/套壳在**运行时**动态 `import()` 拉取：

  ```ts
  // features/biz/forms/forms/index.ts
  // 动态 import：表单实现不进主 chunk，只在真正渲染时加载
  ```

  ⚠️ **不要用静态 import 把所有表单打进主 bundle**——主 bundle 已经不小，
  且这会让「注册了但没人用」的表单也付出下载成本。

- 每个表单组件文件用 `import { registerForms } from '../registry'` 自注册（模块副作用），
  或由 barrel 显式收集。**推荐 barrel 显式收集**（无副作用、可 tree-shake、可测）。

### 2.4 ⚠️ 关键：怎么防「后台定义了 formCode 但前端没注册」

这是双保险，两道都必须在。

#### 保险 A · 保存时（前端，发起侧拦截）

流程定义保存前，把 `supportedFormCodes` 里每个 code 过 `isFormRegistered()`：

```
未注册 → 阻断保存 → toast.error("表单 PUR_ORDER 未在前端注册，请先发布前端代码")
```

放在 `designer-page.tsx` 的 `handleSave` **最前面**（在 `validateWorkflow` 之前），
因为「表单不存在」比「流程结构不合法」更致命。

同时在 `property-panel.tsx` 的「表单白名单」输入框旁加一个**下拉建议器**：
只列 `listRegisteredCodes()` ∩ `后端 enabled 表单`，引导编排者只选交集。
（现在那个 `supportedFormCodes` 是**逗号分隔自由文本**，`property-panel.tsx:52-59`，
必须改成受控多选 + 「自定义输入」兜底，否则「保存时拦截」会变成纯运气。）

#### 保险 B · 运行时（后端 + 渲染，双层兜底）

| 层 | 行为 |
|---|---|
| **后端启动/保存时** | `WfDefinitionService.create/update` 增校验：每个 `supportedFormCodes` 必须在 `form_definition` 中存在且 `status='ENABLED'` 且 `deleted=0`。违反抛 `BusinessException(VALIDATION_ERROR, "表单 X 未注册或已停用")`。**这是权威校验**——前端校验只是提效。 |
| **前端渲染时** | 套壳 `resolveForm(code)` 返回 null ⇒ 渲染 `FormMissing` 兜底卡（见 §3.4），**不白屏、不抛异常**。 |

#### 为什么必须是两道而不是一道

- 只有 A：有人绕过前端直调 API（Postman/脚本/其他客户端）就能存进脏数据。
- 只有 B：用户配完才在**审批时**发现，白填一场，返工成本高。

**附加：一致性巡检**。表单注册管理页提供一行「一致性检查」：
`后端 enabled 的 code 集合 − 前端 registered 的 code 集合` 非空时显示黄色横幅
「以下表单后台已登记但前端未注册：X、Y」。这是把「配错」从「审批时炸」提前到「管理时看见」。

### 2.5 ⚠️ `readOnly` 用 prop 还是 `ref.setReadonly()`？

**我的判断：用受控 prop，不要 `ref.setReadonly()`。**

用户原话是「提供一个设置为只读的方法」。我的处理是：**在语义上满足它，在机制上不用命令式**——
`readOnly` 是一个由父组件（套壳）传入的 prop，父组件自己持有 `useState`，
「设置只读」的能力由父组件的 `setReadOnly` 提供，并**向下透传**。

理由（这是我作为架构师必须坚持的地方）：

1. **命令式改 state 在 React 里不触发重渲染是表象，实质是「数据流分叉」**。
   如果 `setReadonly` 写在组件内部并自己 `useState`，那父组件永远不知道当前态；
   如果写在父组件而通过 ref 转发调用，那 ref 只是把 `setReadOnly` 换了个调用路径，
   **完全等价于直接传 prop，但多了一层 ref 转发 + 一个 `forwardRef` + 一个 `useImperativeHandle`**。
   收益为零，成本三份。

2. **`readOnly` 存在「非编辑期不可预知」的值吗？** 不存在。
   审批套壳里 `readOnly` 永远是 `true`；录入页永远是 `false`。
   这是一个**编译期可决定的常量**，用 prop 表达最准确。若真出现「同一实例中途切只读」
   （如：审批人补填意见后转只读），那也是父组件 state 驱动的重渲染，prop 天然覆盖。

3. **可测性**。prop 可以在测试里直接 `render(<C readOnly />)` 断言；
   ref 需要 `act()` 包一层再断言，属于给测试制造摩擦。

4. **并发渲染（React 18）下命令式写入是明确的不安全区**。`useImperativeHandle` 在并发渲染中
   可能拿到过期闭包，与本仓库已用的大量并发友好写法（如 `process-detail-page.tsx:59-63`
   pathname 挂载时快照一次）背道而驰。

**折中（如果主理人坚持要「方法」语义）**：把只读态**提升到套壳**。
套壳是唯一持有 `useState<boolean>` 的地方，业务表单组件连 `readOnly` 都收不到
（套壳在只读分支里直接走 `<fields/*>` 渲染器，压根不实例化业务组件）。
这比 `ref` 干净得多——**只读态下业务组件零渲染成本**。

> 这一点需要主理人拍板（§6 拍板点 1）。

### 2.6 表单数据序列化格式（`form_data` 存什么）

**结构：扁平 `Record<string, scalar>`，一层，不嵌套。**

```jsonc
// wf_instance.form_data 的实际内容
{
  "orderNo":  "PO-2026-0001",
  "amount":   128000,        // number，不带千分位（展示时才格式化）
  "applyDate":"2026-10-09",  // ISO 日期字符串，不存时间戳
  "priority": "HIGH",
  "urgent":   true
}
```

**为什么必须扁平**（这是硬约束，不是偏好）：

`ConditionEvaluator.resolve()`（`ConditionEvaluator.java:70-89`）做的是
`vars.get(token)` ——**只认顶层 key**。写成 `{"purchase": {"amount": 1}}`，
条件表达式里写 `${amount > 50000}` 时 `vars.get("amount")` 返回 `null`，
`compare` 对 `null` 走 `default -> false`（`ConditionEvaluator.java:93-98`）
⇒ **分支永远不命中，且不报错、静默走错分支**。

这种 bug 极难发现（流程能跑完，只是走错路），所以结构上直接禁掉。

**约定清单**：

| 项 | 约定 | 理由 |
|---|---|---|
| 键 | 扁平 camelCase，与 `fields[].key` 一致 | 条件表达式按 key 引用 |
| 数值 | JSON number，**不带单位与分隔符** | 千分位是展示层的事；`"128,000"` 参与比较会解析失败 |
| 日期 | ISO `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm:ss` | 时区歧义最少 |
| 空值 | 缺失就**不写这个 key**，不要写 `null` | `vars.get()` 对 `null` 与缺失同义，但缺字段更易读 |
| 多选 | 数组 `string[]` | `ConditionEvaluator` 取到数组时 `asText()` 得空串 ⇒ 多选字段**不能用于条件判断**，需在字段说明里注明 |
| 存储 | 整个对象 `JSON.stringify(formData)` 存进 `form_data` JSONB | 与 `StartProcessRequest.formData`（String）现状一致，**不改成 `JsonNode`**，避免动 `ProcessService.java:128` 的写入路径 |

⚠️ **写入路径不动**：`StartProcessRequest.formData` 保持 `String`，
`ProcessService.java:128` 的 `instance.setFormData(req.formData())` 一行不改。
本方案只加**读取**路径（扩 VO）。

---

## Q3 · 审批套壳怎么嵌

### 3.1 目标布局

现状（`process-shell.tsx:193-230`）：

```
┌─────────────────────────────────────────────────────────────────┐
│  PageHeader: businessId · definitionCode · 表单 startedFormCode │
├─────────────────────────────────────────────────────────────────┤
│  顶部进度条: ● 提交申请 → ● 主管审批 → ○ 归档                     │
├──────────────────────────────────┬──────────────────────────────┤
│ 业务数据（只读）          [2/3]  │ 审批历史              [1/3]   │
│  业务类型 / 业务单号              │  · SUBMIT  张三  10-09 10:00 │
│  发起人   / 当前节点              │  · APPROVE 李四  10-09 14:30 │
├──────────────────────────────────┴──────────────────────────────┤
│  底部审批栏（处理人才可见）: 同意 / 驳回                          │
└─────────────────────────────────────────────────────────────────┘
```

改造后：

```
┌─────────────────────────────────────────────────────────────────┐
│  PageHeader                                                       │
├─────────────────────────────────────────────────────────────────┤
│  顶部进度条                                                        │
├──────────────────────────────────┬──────────────────────────────┤
│ ▸ 流程信息（4 个字段，默认收起）   │ 审批历史                      │
│ ▸ 业务表单  «form_code»      [2/3]│                              │
│   ┌────────────────────────────┐ │  ← 套壳 FormShell              │
│   │ 申请金额    ¥128,000.00     │ │                              │
│   │ 申请日期    2026年10月9日    │ │                              │
│   │ 优先级      ▉高              │ │                              │
│   │ 是否加急    是               │ │                              │
│   └────────────────────────────┘ │                              │
├──────────────────────────────────┴──────────────────────────────┤
│  底部审批栏                                                       │
└─────────────────────────────────────────────────────────────────┘
```

**改动位置：`process-shell.tsx:194-210` 那个 `lg:col-span-2` 的卡片。**

**回答「替换还是保留 + 在下方加套壳」**：**替换，但在同卡片内保留那 4 个字段（折叠）。**

- 4 个字段（业务类型/业务单号/发起人/当前节点）是**流程元信息**，不是业务数据。
  业务单号已经是 `PageHeader` 的 `title`（`:151`），发起人已出现在顶部任务条（`:177`）
  ⇒ 直接删掉是信息丢失，直接顶替是语义混乱。
- 折叠（`<details>` 默认收起）放在套壳**上方**，一行摘要即可展开。
  理由：审批人 90% 的注意力在业务数据，流程元信息是查证时才看的。

**塞进哪一栏**：塞进 `lg:col-span-2` 的左栏（现在放 4 字段的那个）。
理由：业务表单字段多、需要横向空间（金额/日期/多选标签并排）；
右栏的审批历史是窄栏，1/3 宽度放不下多行文本字段。

⚠️ 布局注意：`:193` 的容器是 `grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-3`。
套壳塞进去后**必须保持单层滚动**（项目约定：表格吸顶用 `min-h-0 flex-1 overflow-auto`，
页面内不加内层 padding）。⇒ 套壳本身**不要**再套 `overflow-auto`，
让长表单跟随外层网格一起滚；若表单极长（>30 字段），改为给套壳容器 `max-h-[70vh] overflow-auto` 单层滚动。

### 3.2 ⚠️ 阻塞项：后端 VO 必须先扩

**`ProcessDetailVO` 拿不到 `form_data`。**

`ProcessDetailVO.java:8-12` = `(WfInstanceVO instance, List<WfTaskVO> tasks, List<WfHistoryVO> history)`，
而 `WfInstanceVO.java:5-22` 的 16 个 record 分量里**没有 `formData`**。

⇒ 三处改动（缺一不可）：

| # | 改动 | 文件 |
|---|---|---|
| 1 | `WfInstanceVO` 追加 `String formData` 分量（**追加在末尾**，避免破坏位置构造调用） | `dto/WfInstanceVO.java` |
| 2 | `ProcessService.toInstanceVo()`（`:513-520`）补 `i.getFormData()` | `service/ProcessService.java` |
| 3 | `workflow.ts` 的 `WfInstance` 接口加 `formData: string \| null` | `frontend/.../lib/api/workflow.ts` |

**⚠️ 为什么放末尾**：`toInstanceVo` 用的是**位置参数**构造（`:514-519`），
中间插入会让所有下游编译错位，且 `myInitiated`（`:510`）也复用它 ⇒ 列表接口也会带上 formData。
**代价评估**：`GET /workflow/instances/my`（分页 20 条）会多传 20 份表单 JSON。
若实测 payload 过大，**追加方案 B**：`WfInstanceVO` 不动，新增
`ProcessDetailVO` 的第 4 个分量 `String formData`（只在 detail 接口填）。
见 §6 拍板点 2——**我推荐直接走方案 B**，因为列表页本来不需要表单数据。

**⚠️ 前端 `form_data` 解析要容错**：`JSON.parse` 包 try/catch，
失败降级为「原始数据无法解析」提示 + `<pre>` 原文展示，不抛。

### 3.3 找不到组件时的兜底 UI（不白屏）

四级降级，**从上到下依次判定**：

```
① startedFormCode 为空/null
   → <FormMissing reason="no-code">
     图标 + 「本流程实例未记录表单编码」
     说明：可能由旧版本发起，或流程未启用业务表单
     [查看流程信息]  ← 引导去 §3.1 的折叠区

② form_data 为 null / "{}" / 空数组
   → <FormMissing reason="empty-data">
     「表单「{form_code}」已登记，但本次发起未提交任何数据」
     [展开原始数据]（若有原始串但解析出 0 键）

③ resolveForm(code) 返回 null（前端没注册）
   → <FormMissing reason="not-registered" 可重试>
     ⚠️ 黄色告警卡（非红色：不是数据错，是配置缺）
     「表单「{form_code}」尚未在前端注册」
     「该表单在后台已登记（{name}），但当前前端版本未包含对应组件」
     [重新加载]  ← 有意义：用户可能刚从发版前的页面停留至今
     [查看原始数据] ← 展开 <pre>{JSON.stringify(formData, null, 2)}</pre>

④ 组件已注册但 fields 为空或与 value 键不匹配
   → 组件正常渲染 + 末尾追加 <details>「未在 schema 中声明的字段」
     逐键以「键: JSON 值」列出（key 缺失 label 时直接显示 key）
```

**设计原则**：
- 兜底卡必须**解释原因 + 给出下一步**，不能只一句「加载失败」。
- `not-registered` 场景是**运维信号**（发版漏了），所以要显眼但不阻塞审批
  ——审批栏（同意/驳回）**必须依然可用**。这是硬要求：套壳出问题不能阻断审批。

**兜底组件归属**：`features/biz/forms/form-missing.tsx`，
由 `form-shell.tsx` 内部调用，**不导出**给业务方（防止业务方私自兜底掩盖问题）。

### 3.4 `startedFormCode` / `form_data` 各种组合的表现

| `startedFormCode` | `form_data` | 渲染 | 文案 |
|---|---|---|---|
| 非空 | 有效且有值 | 业务组件只读态 | 正常 |
| 非空 | 有效但 `{}` | `FormMissing(empty-data)` | 「已登记但未提交数据」 |
| 非空 | null | `FormMissing(empty-data)` | 同上 |
| 非空 | 非法 JSON 串 | `FormMissing(bad-json)` + `<pre>` 原文 | 「原始数据解析失败」 |
| 非空 | 有效 | `FormMissing(not-registered)` + 重试 + 原文 | 「前端未注册」 |
| null / `''` | 任意 | `FormMissing(no-code)` | 「未记录表单编码」 |
| — | 组件抛异常 | React ErrorBoundary 兜底 + 同上「原始数据」 | 「表单渲染异常」 |

**最后一行需要一个 ErrorBoundary**。业务表单组件是人工写的代码，
一定会有人写出 `value.amount.toFixed(2)` 而 `amount` 是 undefined。
没有 ErrorBoundary ⇒ 整个 ProcessShell 白屏 ⇒ **审批功能整体不可用**。
这是本方案唯一的硬性防御性要求，不可省。

⚠️ ErrorBoundary 放在 `form-shell.tsx` 与业务组件之间（只挡表单，不挡审批栏）。

### 3.5 只读态怎么呈现（不能用 `disabled`）

**核心判断：只读态不渲染业务表单组件，套壳用 `fields` 元信息直接渲染只读视图。**

理由（三条）：
1. `disabled` 的 `<input>` 是**灰底浅字**，对比度约 3:1，审批人看不清——这已被用户点名。
2. 更本质的问题：只读态下业务组件里 90% 的代码（校验、`onChange`、错误提示、联动）都不该执行。
   跑一遍再 `disabled` 是浪费且有副作用风险（某些组件 `useEffect` 会发请求）。
3. 审批人是**读者**不是**编辑者**，读者需要的是「标签 + 值」的排版，不是「看起来像不能点的输入框」。

**渲染映射表**（`fields/index.ts` 统一出口）：

| `fields[].type` | 组件 | 呈现规则 | 示例 |
|---|---|---|---|
| `text` | `ReadOnlyText` | 原样，`whitespace-pre-wrap` 可选中复制，空值显示 `-` | 供应商：华东电子 |
| `textarea` | `ReadOnlyText` | 同 text，但 `min-h` 更高、保留换行 | 申请理由…… |
| `number` | `ReadOnlyNumber` | `Intl.NumberFormat('zh-CN', {maximumFractionDigits:2})` 千分位；带 `unit` 则拼在后面 | ¥ 128,000.00 |
| `date` | `ReadOnlyDate` | `2026-10-09` → `2026年10月9日`；非法值原样 | 2026年10月9日 |
| `datetime` | `ReadOnlyDate` | `2026-10-09T14:30:00` → `2026年10月9日 14:30` | 2026年10月9日 14:30 |
| `select` | `ReadOnlyTag` | **查 `options` 把 value 翻成 label**；查不到则显示 value 并标黄色 | ▉高 |
| `multi` | `ReadOnlyMulti` | 逐项翻 label 成圆角标签；`collapseInReadonly` 且 >3 项时前 3 + `等 N 项` | ▉高 ▉紧急 ▉加急 |
| `bool` | `ReadOnlyBool` | `true` → 绿徽「是」；`false` → 灰徽「否」 | 是 |

**视觉规范**（沿用 `readonly-field.tsx:39-41` 的 `READONLY_FIELD_CLASS` 思路，但**去掉灰底**）：

```
标签：text-[12px] text-muted-foreground
值：  text-[13px] text-foreground        ← 不是 text-muted-foreground
容器：min-h-[34px] rounded border border-transparent bg-muted/40 px-3 py-1.5
      cursor-default whitespace-pre-wrap  ← 保留「可复制」，去掉「像输入框」
```

⚠️ 与现有 `READONLY_FIELD_CLASS` 的差异：现类**有 `border-transparent` + 灰底**，
是为了在旧的 4 字段区里区分输入框。新套壳里字段有明确标签列，
**可以去掉灰底**（`bg-transparent`），让数值更突出。
但 4 字段折叠区**继续用旧的** `READONLY_FIELD_CLASS`（保持现状，零改动）。

**空值统一**：所有渲染器空值输出 `-`（与 `ReadOnlyText` 现有行为一致）。

---

## Q4 · 流程编排改全屏 Dialog

### 4.1 `designer-page.tsx` 怎么改

**结论：包一层，不重构。**

```
designer-page.tsx                      ← 保留为「路由壳」，只做 3 件事
  ├── 从 useDesignerState() 取状态
  ├── <DesignerDialog open onOpenChange={...} />
  └── 加载态 / 错误态

designer-dialog.tsx（新增）             ← 真正的 Dialog 容器
  └── <Dialog open onOpenChange>
       <DialogContent className="max-w-none …">
         <DesignerBody />              ← 原 designer-page.tsx:180-243 的 JSX 原样搬入
       </DialogContent>

designer-body.tsx（新增，从 designer-page.tsx 抽出）
  └── 原 25-243 行的全部逻辑与 JSX，**一行不改**
```

**为什么不重构**：`designer-page.tsx:25-243` 是一个自洽的组件（`useUndoRedo` + 键盘快捷键 +
自动布局 + 校验 + 保存）。它**没有读取任何路由参数**（我通读了全文，零 `useParams`/`useLocation`）。
所以「包一层」是零成本的：只要把 `:180-243` 的 return JSX 抽成 `DesignerBody`，
原组件就退化成 `return <DesignerDialog …/>`。

**依赖「当前路由参数」的问题：不依赖。**（来件提问 → 已核实：无）

`designer-page.tsx` 唯一读外部状态的是 `TENANT_ID = '1'` 常量（`:23`）和 `api.post(…, {params:{tenantId, operatorId:1}})`（`:161-165`）。
所以 Dialog 化后**无需任何替代方案**。

⚠️ **但有个新问题**：「编辑已有定义」需要 `definitionId`。
现状 `definitions-page.tsx:151` 的「编排」按钮**不传任何 ID** ⇒ 点哪一行都是空白画布（现存 bug）。
改为 Dialog 后，`designer-body.tsx` 接受一个可选 prop：

```ts
interface DesignerBodyProps {
  definitionId?: string;   // 有 = 编辑模式（加载已有定义）；无 = 新建模式
  definitionCode?: string;  // 新建弹窗预填的 code（新建流程弹窗已收集，见 §4.4）
  definitionName?: string;
  /** 已选表单 code 列表（新建弹窗多选结果），预填到 FlowMeta。 */
  preselectedFormCodes?: string[];
  onSaved?: (defId: string) => void;
}
```

编辑模式加载：调 `GET /workflow/definitions/{id}?tenantId=1`（已在 V123:77 登记，无需新登记），
把 `nodes`/`edges` 还原成 `WfFlowNode`/`WfFlowEdge`（**`x`/`y` 从 `canvasX`/`canvasY` 还原**，
id 用 `n_${nodeCode}` 保证与保存时的序列化对齐），
`flowMeta` 从 DTO 直接填。⚠️ 还原逻辑要写单测（见 §5 T5.4）。

### 4.2 ⚠️ ReactFlow 宽度：Dialog 的 `max-w` 会不会压扁？

**会。必须显式覆盖。**

`dialog.tsx:45` 的默认类名里有 `w-full max-w-lg` 和
`left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`（居中定位）。
`max-w-lg` = 32rem = 512px ⇒ **三栏布局（Palette 200px + 画布 + 属性面板 280px）直接崩**：
画布只剩 512-200-280-边框 ≈ 30px。

**方案：不用 `fullscreen` 变体，用「视口内全屏」（inset 边距版）。**

理由：
- Radix 没有内置 fullscreen 变体，`DialogContent` 也没有 size prop ⇒ 要 fullscreen 得改 `dialog.tsx` 加变体。
- 真 fullscreen（`fixed inset-0 w-screen h-screen rounded-none`）会盖住最外层的
  `PageHeader` 和侧栏，审批/流程相关操作无法在同屏对照。
- 视口内全屏（`w-[calc(100vw-4rem)] h-[calc(100vh-4rem)] max-w-none`）保留 2rem 边距，
  视觉上仍是「压倒性的大」，且不越界。

**具体做法**（不改 `dialog.tsx`，靠 `className` 覆盖，因为 `cn` = `tailwind-merge`，
后写的 `max-w-*` 会赢掉前面的 `max-w-lg`）：

```tsx
<DialogContent
  className={cn(
    'max-w-none',
    'w-[calc(100vw-4rem)] h-[calc(100vh-4rem)]',
    'left-4 top-4 translate-x-0 translate-y-0',   // 覆盖 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
    'rounded-lg p-0',                             // 内容自行控制内边距
  )}
>
```

⚠️ **两个坑**：

1. **覆盖 translate 要同时给 `left-4 top-4` 和清掉两个 translate**，四个类缺一个就会错位。
2. `dialog.tsx:47` 的默认类有 `p-6`，`DialogHeader`/`DialogFooter` 用 `-mx-6 -mt-6 -mb-6`
   反向抵消来适配（`dialog.tsx:75, 86`）。**`p-0` 会让这套负边距失效** ⇒
   **不要用 `DialogHeader`/`DialogFooter`**，自己在 `DesignerBody` 里写 header/footer 并自带 padding。
   或者更省事：**保留 `p-6`**（不加 `p-0`），直接用 `DialogHeader`/`DialogFooter`。
   → **推荐保留 `p-6`**，改动更小、风险更低。

**最终 className**：

```
'max-w-none w-[calc(100vw-4rem)] h-[calc(100vh-4rem)] left-4 top-4 translate-x-0 translate-y-0'
```

**内部三栏的高度链**（照 `designer-page.tsx:219-238` 现有结构，只是外层容器变了）：

```
DialogContent (h-[calc(100vh-4rem)] flex flex-col)   ← dialog.tsx:45 已有 flex flex-col
  └─ DialogHeader                                       ← 标题 + 关闭按钮
  └─ div.flex.min-h-0.flex-1.overflow-hidden            ← 关键：min-h-0，否则画布撑破
       ├─ Palette (w-[200px] shrink-0)
       ├─ div.min-w-0.flex-1  → DesignerCanvas (h-full w-full → ReactFlow)
       └─ PropertyPanel (w-[280px] shrink-0)
  └─ DialogFooter                                       ← 撤销/重做/布局/校验/保存并发布
```

⚠️ `min-h-0` 是 flex 子项不撑破父容器的**唯一**手段（现有 `:219` 已正确使用，照搬）。
⚠️ `DesignerCanvas` 的 `wrapperRef` 容器是 `h-full w-full`（`designer-canvas.tsx:123`），
**父级链上每一环都必须是确定高度或 `flex-1 + min-h-0`**，否则 ReactFlow 高度为 0（画布一片空白）。

⚠️ **额外风险：ReactFlow 在 Dialog 内的尺寸测量**。
`@xyflow/react` v12 用 `ResizeObserver` 观测容器。Dialog 有 `data-[state=open]:animate-in zoom-in-95` 动画
⇒ **刚挂载的 200ms 内尺寸还在变**。ReactFlow v12 能处理（内部有 debounce），
但为了确定性，`<ReactFlow>` 应包一层 `key` 稳定 + `fitView` 只在初始化时调一次。
**这条需要在联调时实测**，若出现画布不铺满，在 DialogContent 上加
`data-[state=open]:animate-none` 禁掉缩放动画（`tailwindcss-animate` 已在依赖里，`animate-none` 可用）。

### 4.3 关闭后不留浏览器历史：具体做法 + `navigate(-1)` 为什么不行

#### `navigate(-1)` 的三个具体问题

1. **可能退过头。** 用户从侧栏直接进 `/system/workflow/definitions`（`app-layout` 渲染，**不产生历史条目**
   ——侧栏跳转用的是 `replace` 还是 `push` 取决于 `app-layout`）。
   此时在 designer 里 `navigate(-1)` 会退到**上一个无关页面**（如「知识库」），而不是流程定义页。
2. **多次开关会累积历史。** 打开→关闭→再打开，每次 `push` 都留一条，
   用户按一次浏览器后退只退一次，行为不可预期。
3. **与 keep-alive 冲突。** `keep-alive-outlet.tsx` 以 path 为 key 缓存页面实例；
   路由 pop 后页面可能仍被缓存，回来时状态错乱（`process-detail-page.tsx:59-66` 已经踩过
   pathname 快照的坑，注释里写得很清楚）。

#### 具体做法：**不产生任何历史**

**方案（采纳）：Dialog 状态完全由 `definitions-page` 的 `useState` 持有，不碰路由。**

```ts
// definitions-page.tsx
const [designer, setDesigner] = useState<{ open: boolean; definitionId?: string }>({ open: false });

// 打开（不 navigate！历史零变化）
<Button onClick={() => setDesigner({ open: true, definitionId: def.id })}>编排</Button>

<DesignerDialog
  open={designer.open}
  definitionId={designer.definitionId}
  onOpenChange={(open) => { if (!open) setDesigner((s) => ({ ...s, open: false })); }}
/>
```

**历史条数在整个交互中恒定 ⇒ 无论用户怎么点后退，都不会遇到「多出来的历史」。**

**⚠️ 遗留路由怎么办**（来件未提但必须处理）：

改完后 `/system/workflow/designer` 这条路由**仍然存在**（3 处）：
- `keep-alive-outlet.tsx:149` PAGE_MAP 登记
- `lib/nav/system-nav.ts:67` 侧栏项
- `V123:44` sys_menu 95007（且有 `sys_menu_api` 绑定，`:108-109`）

处理方式（三选一，**推荐 A**）：

| 方案 | 做法 | 代价 | 判断 |
|---|---|---|---|
| **A（推荐）** | 保留路由 + 侧栏项，但 `designer-page.tsx` 改为**重定向页**：`useEffect(() => navigate('/system/workflow/definitions', {replace: true}), [])` | 0 迁移、0 删数据；侧栏项保留，向后兼容 | ✅ |
| B | 保留 `designer-page.tsx` 但**包 Dialog 自动打开**（进路由即弹全屏 Dialog，关闭时 `navigate('/system/workflow/definitions', {replace:true})`） | 侧栏「流程编排」点了会「跳转+立即弹窗」，体验怪但可用 | ⚠️ |
| C | 删 sys_menu 95007 + 删侧栏项 + 删 PAGE_MAP 登记 | 需要 V128 `DELETE FROM sys_menu WHERE id=95007`，**且 `sys_role_permission` 有外键指向它** ⇒ 需先删授权再删菜单；且 `uk_menu_app_permission` 是部分唯一索引，删了才能复用该 permission 码 | ❌ 风险高，收益低 |

**选 A。** 理由：V123 已经在 95007 上绑了 4 个 `sys_menu_api`（含本次要加的取消发布和 PUT），
删菜单 ⇒ 4 个 API 全部失去权限来源 ⇒ 全部 403。**为了 UX 优化去动权限数据是本末倒置。**
A 方案下侧栏「流程编排」点进去会立刻 `replace` 回流程定义页，**行为等价于「跳到流程定义」**，可接受。

⚠️ **必须用 `replace: true`**，用 `push` 就又制造了历史条目（进一条、退一条），
虽然不至于像 `navigate(-1)` 那样退过头，但仍然是多余的条目。

### 4.4 「新增定义」弹窗的字段与校验

用 `Dialog` + `Sheet` 的组合：新增用**居中 Dialog**（字段少），编辑用**右侧 Sheet**（复用
`menu-manage-page.tsx` 的范式）。不都用 Sheet——Sheet 适合「编辑已有」，新增时右侧滑出反而啰嗦。

| # | 字段 | 控件 | 校验 | 说明 |
|---|---|---|---|---|
| 1 | 流程名称 | Input | 必填，trim 后 1-128 字符 | |
| 2 | 流程编码 | Input | 必填，`^[A-Z][A-Z0-9_]{1,63}$` | 非法则拒。前端不查重（无查询端点），**依赖后端 `uk_wf_def_tenant_code_ver` 报冲突**，但要在 V128 补登记 `PUT` 的同时，让 `POST` 的冲突错误码可读 |
| 3 | 分类 | Select | 必填，枚举 `APPROVAL` / `NOTICE` / `TASK` | 现状 `property-panel.tsx:46-48` 是自由文本 ⇒ **收敛为枚举** |
| 4 | 说明 | Textarea | 可选，≤512 | |
| 5 | 表单多选 | 可搜索多选（Checkbox 组） | 至少选 1 项 | 候选项 = `GET /workflow/forms?status=ENABLED`（后端）+ 前端 `isFormRegistered()` 过滤。**只显示交集**（决策 3：只有定义过 formCode 的表单才能被选中）。已选中但未注册的项**标红保留**（不静默丢弃用户既有配置） |
| 6 | （编辑时）版本 | 只读展示 | — | `ACTIVE` 状态不可编辑（后端 `WfDefinitionService.update:73-75` 已拦）⇒ 编辑入口对 `ACTIVE` 定义要**禁用并提示「已发布流程不可编辑，请先取消发布」** |

⚠️ **字段 5 的关键设计**：候选项来源必须**同时**满足两个条件——

```
可选项 = 后端 enabled  ∧  前端已注册
```

不是「取并集」。理由：决策 3 说「只有定义过 formCode 的表单才能在流程定义里被选中」；
而 §2.4 保险 A 说「未注册的不许保存」。取并集会让用户能选到一个保存时被拒的项。
取交集则用户在**选择时**就看不到坏选项。

⚠️ 但编辑已有定义时例外：如果该定义已含一个 `status=DISABLED` 的表单，
多选框要**显示它并标注「已停用」**（只读 tag），否则用户保存时会静默丢失该配置。

### 4.5 编辑已有定义时的差异（差异表）

| 维度 | 新增 | 编辑 |
|---|---|---|
| 打开方式 | 点「新建流程」→ 新增弹窗（填名称/编码/分类/表单）→ 保存弹窗 → 开 Dialog | 点「编排」→ 直接开 Dialog（不经过新增弹窗） |
| 编码 | 可填，校验格式 | **只读**。编码是身份，改编码等于换流程；且 `wf_instance.definition_code` 是字符串软引用，改了老实例失联 |
| 状态 | `DRAFT` → 保存时 activate | `DRAFT` 才可编辑；`ACTIVE` 时「编排」按钮**禁用**并 tooltip「已发布流程不可编辑，请先取消发布」 |
| 加载 | 空白画布 | `GET /workflow/definitions/{id}` 还原 nodes/edges/flowMeta |
| 保存动作 | `POST /workflow/definitions` + `POST /{id}/activate` | `PUT /workflow/definitions/{id}`（**本次补登记 95051**）+ 不自动 activate（已在 ACTIVE） |
| 「保存并发布」按钮文案 | 保存并发布 | DRAFT 时「保存并发布」；已 DRAFT 已存在时改为「保存」 |
| 表单多选 | 必填 | 允许增删，但**不允许删掉已被 `wf_instance.started_form_code` 用到的表单**（需后端给出引用计数）⇒ ⚠️ 见 §6 拍板点 4 |

**⚠️ 保存后关闭的联动**：`onSaved` 回调里必须 `await load()` 刷新列表
（新增后当前页可能因为分页看不到新行、编辑后状态/节点数变了），
再 `setDesigner({open:false})`。顺序不能反。

---

## Q5 · 任务分批

依赖关系（箭头 = 前者完成后后者才能开工）：

```
T1 (后端表+端点) ──┬─→ T3 (后端单测) ──┐
                   │                   ├─→ T6 (后端全量回归)
T2 (前端契约+注册表)┴─→ T4 (控件补齐) ──┴─→ T8 (前端全量回归)
                          ↓
                        T5 (套壳) ──→ T7 (编排 Dialog) ──→ T9 (联调验收)
```

### 第 1 批（后端地基，可与第 2 批并行）

| 任务号 | 内容 | 文件（精确路径） | 验收标准 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **T1.1** | 建表 DDL + 段位登记 | `backend/mis-migrator/src/main/resources/db/migration/V128__form_definition_and_unpublish.sql` | `mvn -pl mis-migrator flyway:validate` 通过；`SELECT * FROM form_definition` 存在；`sys_api` 新增 7 行（含补登记的 PUT）；`sys_menu` 新增 2 行；`sys_menu_api` 新增 7 行 | **高**（段位冲突 / `uk_menu_app_permission` 唯一索引冲突） | 1 文件 ~200 行 |
| **T1.2** | 实体 + 仓储 | `mis-taskflow/.../domain/entity/FormDefinition.java`、`.../domain/repository/FormDefinitionRepository.java` | `findByTenantIdAndCode`、`findByTenantIdAndParentIdAndDeleted`、`findByTenantIdAndStatusAndDeleted` 三个方法齐 | 低 | 2 文件 ~150 行 |
| **T1.3** | 「取消发布」服务 + 端点 | `.../service/WfDefinitionService.java`（加 `deactivate`）、`.../controller/WfDefinitionController.java`（加 `POST /{id}/deactivate`） | `ACTIVE → DRAFT`；非 `ACTIVE` 幂等返回；**已发布定义被取消后仍能编辑**（现有 `update` 拦 `ACTIVE`，`deactivate` 后放行） | 中 | 2 文件 ~60 行 |
| **T1.4** | 表单注册 CRUD | `.../service/FormDefinitionService.java`、`.../controller/FormDefinitionController.java`、`.../dto/`（3 个 DTO） | 建/改/删/查/树 全部走通；**删除时校验 `wf_definition.supported_form_codes` 与 `wf_instance.started_form_code` 引用，有引用抛业务异常** | 中 | 6 文件 ~450 行 |
| **T1.5** | 白名单强校验接入 | `WfDefinitionService.create/update` | `supportedFormCodes` 任一项未注册/已停用 ⇒ 抛 `VALIDATION_ERROR` | 中 | 1 文件 ~40 行 |
| **T1.6** | ⚠️ VO 扩（Q3.2 方案 B） | `.../dto/ProcessDetailVO.java`（加第 4 分量 `formData`）、`.../service/ProcessService.java:502` | `GET /workflow/instances/{id}` 响应含 `formData`；`GET /workflow/instances/my` **不含** | 中（`ProcessDetailVO` 位置构造需同步改） | 2 文件 ~20 行 |

小计：**14 文件 / ~920 行**，风险**高**（集中在 T1.1 一次迁移写对）

### 第 2 批（前端契约与控件）

| 任务号 | 内容 | 文件 | 验收标准 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **T2.1** | 契约 + 注册表 | `frontend/mis-admin-web/src/features/biz/forms/types.ts`、`registry.ts`、`registry.test.ts` | 单测覆盖：注册/重复注册抛错/未知 code 返回 null/`listRegisteredCodes` 排序 | 低 | 3 文件 ~250 行 |
| **T2.2** | 只读字段渲染器 | `.../forms/fields/` 下 8 个文件 + `index.ts` + `read-only.test.ts` | number 千分位、date 中文化、select/multi 翻 label、bool 是/否、日期非法值原样 | 低 | 9 文件 ~450 行 |
| **T2.3** | 兜底 + 边界 | `.../forms/form-missing.tsx`、`form-error-boundary.tsx` | 四级降级（Q3.4 表）逐条可测 | 中 | 2 文件 ~200 行 |
| **T2.4** | UI 控件补齐 | `frontend/mis-admin-web/src/components/ui/`：`checkbox.tsx`（radix 已有依赖）、`switch.tsx`、`multi-select.tsx`、`date-field.tsx`、`number-field.tsx` | 5 个控件可复用；`tsc --noEmit` 过 | 中 | 5 文件 ~400 行 |

小计：**19 文件 / ~1300 行**，风险**中**

### 第 3 批（审批套壳）

| 任务号 | 内容 | 文件 | 验收标准 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **T3.1** | `FormShell` 主体 | `.../forms/form-shell.tsx` + `form-shell.test.tsx` | 已注册→渲染字段；未注册→`FormMissing`；组件抛错→ErrorBoundary 兜底且**审批栏仍可点** | 中 | 2 文件 ~300 行 |
| **T3.2** | 接入 ProcessShell | `frontend/mis-admin-web/src/features/taskflow/process-shell.tsx:194-210` | 套壳塞进 `lg:col-span-2`；4 个字段收进 `<details>` 折叠（默认收起）；单层滚动 | **中**（`process-shell.test.tsx` 现有 5 组断言需核对是否被破坏） | 1 文件 ~120 行（改） |
| **T3.3** | `workflow.ts` 类型 | `frontend/mis-admin-web/src/lib/api/workflow.ts` | `ProcessDetail` 加 `formData: string \| null`；`JSON.parse` 容错 | 低 | 1 文件 ~20 行 |
| **T3.4** | 示例表单 | `.../forms/forms/pur-order-form.tsx` + `index.ts` + 注册示例 | `PUR_FORM`（对齐 V123:145 已有的 `ARRAY['PUR_FORM']` 演示数据）能渲染，**老的 `PURCHASE_APPROVAL_DEMO` 审批页不白屏** | 低 | 2 文件 ~180 行 |

⚠️ **T3.4 的额外价值**：V123:142-148 种了演示定义 `supported_form_codes = ['PUR_FORM']`。
若不注册 `PUR_FORM`，**这条既有演示数据在审批页会直接走 `not-registered` 兜底**。
所以 `PUR_FORM` 必须在第 3 批完成，不能拖。

小计：**6 文件 / ~620 行**，风险**中**

### 第 4 批（编排页改造）

| 任务号 | 内容 | 文件 | 验收标准 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **T4.1** | 抽 `DesignerBody` | `.../workflow-designer/designer-body.tsx`（新）+ `designer-page.tsx` 瘦身 | 画布/自动布局/校验/保存全部行为不变；`designer-page.tsx` 仅剩 `useDesignerState` + `navigate(replace)` 重定向 | **中**（245 行搬移，易漏 import） | 2 文件 ~280 行（搬移 + 瘦身） |
| **T4.2** | `DesignerDialog` | `.../workflow-designer/designer-dialog.tsx`（新） | 全屏尺寸正确（`max-w-none` + 四类覆盖齐全）；画布铺满不塌陷；Esc / 点外部可关；**有未保存改动时二次确认** | **高**（translate 覆盖不全会错位；`min-h-0` 漏一处画布高度为 0） | 1 文件 ~200 行 |
| **T4.3** | `definitions-page` 接入 | `.../workflow-designer/definitions-page.tsx` | 3 处 `navigate` 全改 `setState`；**历史条数交互前后不变**；「编排」传 `definitionId`；保存后 `await load()` 再关 | 中 | 1 文件 ~200 行（改） |
| **T4.4** | 新增/编辑弹窗 | `.../workflow-designer/definition-dialog.tsx`（新） | 6 字段校验全通（Q4.4 表）；表单多选**只列前后端交集**；编辑时编码只读、`ACTIVE` 禁用编排 | 中 | 1 文件 ~300 行 |
| **T4.5** | 编辑态还原 | `designer-body.tsx` 内 + `designer-body.test.ts` | `GET /{id}` 的 nodes/edges/flowMeta 完整还原；`canvasX/Y` → position 正确 | 中 | 1 文件 ~150 行 |
| **T4.6** | 白名单多选改造 | `.../workflow-designer/property-panel.tsx:52-59` | 逗号自由文本 → 受控多选 + 未注册项标红保留 | 中 | 1 文件 ~150 行（改） |
| **T4.7** | 权限码控制 | `definitions-page.tsx`（发布/取消发布按钮包 `PermissionGate`） | 无 `workflow:definition:edit` 时不渲染两个按钮 | 低 | 1 文件 ~30 行（改） |
| **T4.8** | 侧栏项处理 | `lib/nav/system-nav.ts:67` 标注、`keep-alive-outlet.tsx:149` 保持 | 点「流程编排」→ `replace` 回流程定义页；**不产生历史** | 低 | 1 文件 ~20 行（改） |

小计：**10 文件 / ~1330 行**，风险**高**（T4.2 布局 + T4.1 搬移）

### 第 5 批（表单注册管理页）

| 任务号 | 内容 | 文件 | 验收标准 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **T5.1** | 树 + 表格主页面 | `.../forms/pages/form-registry-page.tsx` + `.test.tsx` | 树（`filterTree` 照 `menu-manage-page.tsx:77`）+ 右侧表格；`min-h-0 flex-1 overflow-auto` 单层滚动 | 中 | 2 文件 ~600 行 |
| **T5.2** | CRUD 抽屉 | 同文件内 `Sheet` 抽屉 | 增/改/删闭环；删除被引用表单时后端报错**原样展示** | 中 | ~300 行 |
| **T5.3** | 一致性横幅 | 同文件 | `后端 enabled − 前端 registered` 非空时黄横幅列出 code | 低 | ~80 行 |
| **T5.4** | 路由 + 导航登记 | `keep-alive-outlet.tsx` PAGE_MAP 加 `/system/forms`；`lib/nav/system-nav.ts` 加「表单管理」分支 | 侧栏出现入口；刷新不 404 | 低 | 2 文件 ~30 行（改） |

小计：**4 文件 / ~1010 行**，风险**中**

### 验收与回归

| 任务号 | 内容 | 命令 | 通过标准 |
|---|---|---|---|
| **T6** | 后端全量 | `.\mvn.ps1 -pl mis-taskflow test "-Dsurefire.forkCount=0"`（⚠️ PowerShell） | `Tests run: ≥95 + 新增数, Failures: 0, Skipped: 0`（基线 95） |
| **T7** | 前端全量 | `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true` | `files ≥ 58 + 新增, passed ≥ 645 + 新增, failed: 0`（基线 58 files / 645 passed） |
| **T8** | 类型检查 | `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit` | 0 error |

**联调验收清单**（人工，T9）：
1. 新建表单 `PUR_FORM` → 侧栏「表单管理」可见 → 新建流程选中它 → 保存成功
2. 启动实例（`startedFormCode=PUR_FORM`）→ 审批页显示表单，**金额千分位、日期中文、多选标签化**
3. 停用该表单 → 新建流程时不再出现在候选 → 已有流程保存时被后端拒（错误文案可读）
4. 某 `formCode` 后台有、前端无 → 审批页显示黄色兜底卡，**同意/驳回仍可点**
5. 发布流程 → 侧栏出现「取消发布」→ 点 → 状态回 `DRAFT` → 编排按钮恢复可点
6. 无 `workflow:definition:edit` 的账号登录 → 定义页看不到「新建流程」「编排」「发布」「取消发布」
7. 编排 Dialog：打开→编排→关闭，**浏览器后退一次即离开定义页**（无多余历史）
8. 编排 Dialog 在 1920/1440/1280 三档宽度下三栏不塌陷、画布铺满

---

## 6. 需要主理人拍板的点

| # | 议题 | 我的建议 | 不拍板的后果 |
|---|---|---|---|
| **1** | `readOnly` 用受控 prop 还是 `ref.setReadonly()`（Q2.5） | **受控 prop**，且只读态下**根本不实例化业务组件**。用户原话「提供一个设置为只读的方法」在语义上被满足（父组件 `setReadOnly` 存在），机制上不违反 React 数据流 | 若坚持 ref，实现要多写 `forwardRef` + `useImperativeHandle` 两层包装，且只读态仍会执行全部业务组件代码（`useEffect` 可能发请求） |
| **2** | `form_data` 从 VO 哪里透出（Q3.2） | **方案 B**：不动 `WfInstanceVO`，在 `ProcessDetailVO` 加第 4 个分量。只在 detail 接口填，列表接口不受影响 | 若图省事改 `WfInstanceVO`（在末尾追加），`GET /workflow/instances/my` 分页 20 条会多传 20 份表单 JSON |
| **3** | 表单分类是否限制层级深度（Q1.1） | **限制 2 层**（根分类 → 子分类 → 表单），应用层校验「父节点无父节点」才可挂子节点。不上 `CHECK` 约束（PG CHECK 不能跨行） | 不限制则分类树深度不可控，前端树组件要写递归、管理页要做无限层级缩进 |
| **4** | 编辑流程定义时能否删掉正被 `wf_instance.started_form_code` 用到的表单（Q4.5） | **建议本轮禁止**：删除前查 `wf_instance` 引用计数 > 0 ⇒ 拒绝并提示。这需要新增一个内部查询（非新端点，是 `PUT` 流程时的内部校验） | 不做校验 ⇒ 老实例的审批页会渲染失败（走到 `not-registered` 兜底），审批人看到的是黄色告警卡而非数据 |
| **5** | 新增流程时编码是否要预查重端点 | **本轮不做**：`POST` 靠 `uk_wf_def_tenant_code_ver` 报冲突，要求后端把重复错误信息**翻译成可读文案**（`code "XXX" 已存在`）而不是裸 SQL 异常 | 管理员点了保存才知道编码重复，体验差一档，但不影响正确性 |

**另外一条「我认为是问题但需要主理人确认」的**：

⚠️ **V123 的演示数据 `PURCHASE_APPROVAL_DEMO` 白名单是 `['PUR_FORM']`（V123:145）**，
而 `PUR_FORM` 目前**没有任何前端实现**。本方案 T3.4 会补一个 `PUR_FORM` 示例组件。
但请主理人确认：**这个演示流程的 `form_data` 里应该有什么数据**？
现在库里**没有任何 `wf_instance` 记录**（我没查数据，只查了代码），
所以补完 `PUR_FORM` 后演示流程**仍然无法在审批页看到真实数据**（因为没有实例）。
是否需要**额外种一条 `wf_instance` 演示数据**（T9 联调用）？这会影响联调验收清单第 2 条能否通过。

---

## 附：变更文件总览（56 文件）

```
后端  mis-migrator   1 文件（V128，~200 行）
      mis-taskflow   1 entity + 1 repo + 2 service + 2 controller + 3 dto + 1 VO + 1 ProcessService 改动
                     = 12 文件 / ~920 行

前端  features/biz/forms/     types + registry + 9 fields + form-shell + form-missing + error-boundary
                              + 2 示例表单 + 2 pages                    = 18 文件 / ~2300 行
      features/system/workflow-designer/
                              designer-body + designer-dialog + definition-dialog
                              + definitions-page + property-panel + designer-page  = 6 文件 / ~1100 行
      features/taskflow/      process-shell（改）                        = 1 文件
      components/ui/           checkbox + switch + multi-select + date-field + number-field
                                                                    = 5 文件 / ~400 行
      lib/ + 路由 + 导航       workflow.ts + keep-alive-outlet + system-nav = 3 文件
                                                                                        = 3 文件
合计                                                                            ≈ 41 文件 / ~4900 行
```

**⚠️ 提交纪律**：
- V128 是**唯一**新增迁移，**绝不改 V120~V127**（checksum 变更会阻塞整条迁移链）。
- 前后端测试**必须**用本文给出的完整命令（沙箱环境的 OOM / fork 限制），
  直接 `npm run test` 会静默被杀（退出码 1 + 零输出，极易误判为通过）。

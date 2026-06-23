# ADR-011: sys_api 统一 API 树、层级 code、按 APP 隔离用户与令牌

## 状态
已接受

## 日期
2026-06-23

## 背景

在 APP + 模块模型讨论基础上，进一步要求：

1. 原扁平 HTTP 绑定表演进为 **`sys_api` 树**（`type=catalog|api`）；**`sys_menu_api`** 保留为菜单页/按钮 ↔ API 叶子的关联表
2. **`sys_menu`、`sys_api` 均增加 `code` 字段**，用层级编码表示父子关系（如 `0001` → `00010001` → `000100010001`）
3. **租户 = 集团公司**；一租户多 APP；**每个员工在每个 APP 内独立建 USER**；按 APP 登录；**令牌按 APP 隔离**

## 决策

### 1. 表与命名

| 原 | 新 |
|----|-----|
| 原扁平 HTTP 绑定 | **`sys_api`** API 注册树 + **`sys_menu_api`** 菜单/按钮关联表 |

### 2. sys_api

| type | 含义 | http_method / path_pattern |
|------|------|---------------------------|
| `catalog` | API 分类目录 | NULL |
| `api` | HTTP 端点 | 必填 |

- 树关系：`parent_id` + **`code` 层级编码**（见 ADR-011 附录）
- 归属：`tenant_id`, `app_id`（门户隔离）；`module_id` → **`sys_module`（平台级，无 app_id）**
- **不含 `permission` 字段**；鉴权 permission 来自关联的菜单页/按钮（经 `sys_menu_api`）

### 3. sys_menu

- 保留 `type`：目录 / 菜单页 / 按钮
- 增加 **`code`** 层级编码（与 `sys_api` 规则一致，**两树 code 独立编号**）
- `app_id` 必填；`permission` 在 type=2/3 节点，**为鉴权唯一来源**
- 菜单页、按钮通过 **`sys_menu_api`** 关联 `sys_api`（`type=api`）叶子

### 4. sys_menu_api（关联表，非 API 注册表）

| 字段 | 说明 |
|------|------|
| menu_id | type=2 菜单页 或 type=3 按钮 |
| api_id | → `sys_api` 叶子 |

每个 `api_id` 全局唯一归属一个 menu 节点。

### 5. 租户、员工、APP 用户

```
sys_tenant（集团公司）
  └── sys_app（多个应用）
  └── sys_employee（租户内员工主数据，一人一条）
        └── sys_user（员工在某个 APP 下的登录账号，一人每 APP 最多一条）
```

| 表 | 说明 |
|----|------|
| `sys_employee` | 租户内自然人：工号、姓名、主部门等 |
| `sys_user` | **(tenant_id, app_id, username)** 唯一；`employee_id` FK；独立 password |

登录请求必须带 **`app_code` 或 `app_id`** + username + password。

### 6. 令牌按 APP 隔离

| 项 | 规则 |
|----|------|
| JWT claims | 必含 `tenantId`, **appId**, `userId`, `employeeId` |
| Access Token | 仅可用于该 APP 的 API（Gateway/BFF 校验 `X-App-Id` 或 path 前缀） |
| Refresh Cookie | 名：`mis_refresh_{appCode}` 或 payload 含 appId，**不可跨 APP** |
| Redis permissions | `mis:rbac:permissions:{tenantId}:{appId}:{userId}` |
| Redis perm-version | `mis:rbac:perm-version:{tenantId}:{appId}:{userId}` |
| 登出 | 仅吊销当前 APP 的 token |

同一员工在「系统管理 APP」与「HR APP」各有一套账号、令牌、权限，互不影响。

### 7. 角色授权

| 表 | 用途 |
|----|------|
| `sys_role_permission` | 角色权限；`perm_type='menu'` 勾选菜单树 |
| `sys_menu_api` | 菜单页、按钮 ↔ `sys_api` 叶子 |

用户有效 permissions = 已勾选菜单/按钮的 `sys_menu.permission`（去重）。

BFF Registry：`sys_api` ⋈ `sys_menu_api` ⋈ `sys_menu` → method+path → permission。

**不使用 `sys_role_api`。**

### 8. code 编码规则（附录）

- 每层层级 **4 位数字**，不足补零
- 根节点：`0001`, `0002`, …
- 子节点：父 `code` + 4 位子序号，如 `00010001`, `00010002`
- 孙节点：`000100010001`
- 最大长度建议 `VARCHAR(64)`（支持足够深度）
- 查询直接子节点：`WHERE parent_id=?`；查子孙：`WHERE code LIKE '00010001%' AND code != '00010001'` 或用 `code` 长度

**sys_menu 与 sys_api 各自独立编号空间**（两套树互不复用 code 值）。

## 后果

### 正面
- API 与菜单均可视化树管理，符合企业元数据习惯
- 多 APP、多账号、令牌隔离适合集团多产品门户
- `sys_api` 为 API 注册树；**`sys_menu_api`** 为菜单/按钮关联表（名称保留，职责不同）

### 负面
- 登录、JWT、Redis key 全链路要带 `appId`
- 员工主数据 + APP 用户两层，实施稍复杂
- code 手动维护需管理台自动生成子 code

## 已确认

- [x] `sys_api` API 树 + `sys_menu_api` 关联表
- [x] 角色只勾选菜单/按钮；API 由 `sys_menu_api` 关联（D9/A7）
- [x] 租户多 APP；员工每 APP 一个 sys_user；令牌 APP 隔离

## 附录：code 生成示例

```
sys_api (app=system)
0001                    catalog  用户模块
00010001                catalog  用户查询
000100010001            api      GET /api/v1/users
000100010002            api      GET /api/v1/users/{id}
00010002                catalog  用户写入
000100020001            api      POST /api/v1/users
```

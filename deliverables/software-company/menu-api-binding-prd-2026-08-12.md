# 菜单「关联 API」设置能力 PRD（简单档）

| 项 | 值 |
| --- | --- |
| 文档版本 | v0.1（2026-08-12） |
| 语言 | 中文（技术术语保留英文） |
| 项目代号 | menu_api_binding |
| 所属平台 | mis-platform（mis-admin-web / mis-admin-bff / mis-system） |
| 原始需求 | 「能看到每个菜单的关联API，却没有地方设置这个关联API」——菜单管理页仅只读展示 `apiList`，需补齐「菜单 ↔ 接口」绑定的设置闭环 |

---

## 1. 产品目标

**一句话**：让运营/管理员在「系统管理 → 菜单管理」页内，能够为任意菜单节点绑定/解绑平台接口（`sys_api`），使菜单的「关联 API」从只读展示变为可维护、可落库的真实配置。

**验收标准（可度量）**：

- P0 达成后，菜单详情面板「关联 API」区可执行「新增绑定、删除绑定」；操作成功后重新拉取菜单树，`apiList` 与数据库 `sys_menu_api` 一致。
- P0 达成后，新建/编辑菜单后无需改动菜单树接口契约：`MenuNode.apiList` 结构（`{ method, path }`）保持不变，前端与旧数据兼容。
- 绑定操作有明确权限码控制；BFF 端点注册进权限注册表，`BffApiRegistryDiffSurveyTest` 类审计（若该测试维护菜单端点清单）通过。
- 全链路（前端 → BFF → mis-system → `sys_menu_api`）走通，无「只能看、不能改」的半成品残留。

---

## 2. 用户故事

1. **作为** 菜单管理员，**我希望** 在菜单详情面板中直接把「接口树」里的接口勾选绑定到当前菜单，**以便** 无需手工改库即可配置菜单对应的接口权限。
2. **作为** 菜单管理员，**我希望** 对已绑定的接口执行解绑/全量替换，**以便** 菜单改版或接口下线时能及时清理关联，保持 `apiList` 准确。
3. **作为** 菜单管理员，**我希望** 按模块筛选接口后再选择（接口归属于 `sys_module`），**以便** 在接口量大时快速定位目标接口，而不是在一棵全量大树里翻找。

---

## 3. 需求池

| 优先级 | 需求 | 说明 |
| --- | --- | --- |
| P0 | 菜单详情面板「关联 API」区支持**新增绑定** | 面板内新增「绑定 API」入口，弹层/Sheet 内从接口树（`GET /internal/v1/apis/tree?moduleId=`，按模块组织）选择接口，确认后落库 `sys_menu_api` |
| P0 | 菜单详情面板「关联 API」区支持**解绑** | 现有每行右侧的 `Unlink` 图标由纯展示改为可点击，点击后从 `sys_menu_api` 删除该行（解绑确认可后续再加，P1） |
| P0 | 编辑时**回显**已绑定列表 | 打开绑定弹层时，展示当前菜单已绑定的 `apiList`（勾选态），避免重复绑定 |
| P0 | 后端提供**写端点** | mis-system 新增绑定/解绑端点（见 §5），`MenuService.create/update/delete` 不承担绑定写入（保持职责单一） |
| P1 | 绑定列表**按模块筛选**接口树 | 绑定弹层顶部提供模块下拉，切换模块加载该模块接口树（复用 `apis/tree`），降低选择成本 |
| P1 | 绑定**排序**（按选择顺序写入 `sort`） | 全量替换时按请求中 `apiIds` 顺序写 `sort`；`findApisByMenuIds` 已按 `ma.sort` 排序，前端即可稳定展示 |
| P1 | 解绑前**确认提示** | 防误操作；与现有删除菜单的确认交互保持一致 |
| P2 | 绑定结果**即时反馈**（不整树刷新） | 绑定/解绑成功后局部更新详情面板 `apiList`，减少整树刷新闪烁（整树刷新仍作兜底） |
| P2 | 手动**拖拽排序**绑定项 | 面板内支持拖拽调整顺序并落库 `sort`（P0/P1 阶段仅按选择顺序自动排序） |
| P2 | 新增/编辑菜单 Sheet 内直接管理关联 API | 见 §4.3 建议，默认**不做**（理由见该节） |

---

## 4. UI 设计稿

### 4.1 现状（仅展示）

`menu-manage-page.tsx:557-587` 详情面板「关联 API（N）」区：只读渲染 method 徽标 + path，右侧 `Unlink` 图标无任何交互（`onClick` 缺失），无新增入口。

```
┌─ 详情面板（选中菜单节点后）────────────────────┐
│  关联 API（2）          经 sys_menu_api 绑定    │
│  ┌──────────────────────────────────────────┐ │
│  │ [GET]  /api/v1/menus/tree        [Unlink]│ │  ← Unlink 纯展示
│  │ [PUT]  /api/v1/menus/{id}/apis   [Unlink]│ │
│  └──────────────────────────────────────────┘ │
│  该节点未绑定 API  ← 空态文案                  │
└───────────────────────────────────────────────┘
```

### 4.2 目标（P0：只读 → 可管理）

头部「关联 API（N）」右侧新增 **「绑定 API」按钮**；每行 `Unlink` 变为可点击的解绑操作。点击「绑定 API」打开绑定弹层（Dialog/Sheet），内含模块下拉 + 接口树勾选 + 已绑定回显。

```
┌─ 详情面板（P0 目标）──────────────────────────┐
│  关联 API（2）  [绑定 API]  经 sys_menu_api 绑定 │
│  ┌──────────────────────────────────────────┐ │
│  │ [GET]  /api/v1/menus/tree        [✕ 解绑]│ │  ← Unlink 可点击
│  │ [PUT]  /api/v1/menus/{id}/apis   [✕ 解绑]│ │
│  └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
        │ 点击「绑定 API」
        ▼
┌─ 绑定 API（Dialog）──────────────────────────┐
│  模块：[KB 模块 ▾]                             │
│  ┌──────────────────────────────────────────┐ │
│  │ ☑ GET  /api/v1/menus/tree   ← 已绑定回显  │ │
│  │ ☐ POST /api/v1/roles          （勾选态）  │ │
│  │ ☑ PUT  /api/v1/menus/{id}/apis           │ │
│  └──────────────────────────────────────────┘ │
│                    [取消]  [保存]              │
└───────────────────────────────────────────────┘
```

- 交互要点：
  - 「保存」= 全量替换（提交当前勾选集合），符合后端 `PUT` 语义，天然覆盖「新增 + 解绑」两种操作；**建议绑定与解绑共用同一个弹层/全量替换入口**，单行 ✕ 解绑作为快捷操作（P0 可只做全量替换 + 单行解绑）。
  - 空态：未绑定接口时展示「该节点未绑定 API」，按钮仍可点击进入绑定弹层。
  - 错误态：保存失败时 Toast 展示后端 `Result.message`，弹层不关闭，勾选状态保留。

### 4.3 新增/编辑菜单 Sheet 是否加入关联 API 区 —— **建议：P0 不加，P2 再评估**

理由：
1. **职责单一**：Sheet 表单当前只承载菜单基础属性（名称/类型/路径/组件/权限码等，见 `menu-manage-page.tsx:595-619`），接口绑定是独立关注点，混入会拉长创建表单、提高心智负担。
2. **创建顺序**：先建菜单（拿到 `menuId`）再绑接口更自然，避免「未保存的菜单怎么绑接口」的临时态设计。
3. **选择器复杂度**：接口树按模块组织、量大时需要筛选，不适合塞进窄 Sheet 表单；详情面板有更大空间承载弹层。
4. **P2 可选增强**：若用户后续反馈「新建按钮菜单后还要回详情面板绑接口，两步太繁琐」，再在编辑 Sheet 中追加「关联 API」只读摘要 + 「去详情面板管理」入口。

### 4.4 前端落地位置（提示实现者）

- 页面：`frontend/mis-admin-web/src/features/system/menu/menu-manage-page.tsx`（详情面板 + 新增绑定 Dialog/Sheet）。
- API 封装：`src/lib/api/menus.ts` 新增 `fetchMenuApis(menuId)`、`replaceMenuApis(menuId, apiIds)`。
- 类型：`src/types/api.ts` 可新增 `MenuApiBindingItem { id: string; name: string; method: string; path: string }` 用于绑定弹层展示（`MenuApiItem` 保持不变，兼容树接口）。

---

## 5. 接口草案（REST，需与后端实现对齐）

### 5.1 推荐方案：GET + PUT 全量替换

BFF 对外（`/api/v1/menus`）：

```
GET /api/v1/menus/{menuId}/apis            # 返回该菜单当前已绑定的接口明细（含 apiId，供回显勾选）
PUT /api/v1/menus/{menuId}/apis            # 全量替换绑定，body: { "apiIds": [1, 2, 3] }
```

mis-system 内部（`/internal/v1/menus`）同步新增对应端点（由 BFF `SystemWebClient` 透传，如 `menuApiList/menuApiReplace`）。

**推荐理由**：
1. **有设计先例**：BFF 审计测试 `BffApiRegistryDiffSurveyTest.java:532-533` 的设计 registry 已定义 `GET /api/v1/menus/{menuId}/apis`、`PUT /api/v1/menus/{menuId}/apis`，按此落地与既定注册表一致，实现时只需同步补实现而非改注册表。
2. **有平台惯例**：`PUT /api/v1/roles/{id}/menus`（角色菜单绑定）已是全量替换模式，菜单绑接口复用同一交互心智。
3. **事务原子性**：全量替换在 Service 层一个事务内「删除旧行 + 插入新行（按 apiIds 顺序写 sort）」，避免逐条 POST/DELETE 的中间态与部分失败。
4. **前端简单**：绑定弹层「保存」天然对应一个请求，回显用 GET 结果即可，无需维护增删差异。

**响应示例**（待后端最终定义）：

```
GET /api/v1/menus/91039/apis
→ { "code": 0, "data": [ { "id": "91039001", "name": "查询命中测试", "method": "GET", "path": "/api/v1/kb/..." }, ... ] }

PUT /api/v1/menus/91039/apis  {"apiIds":[91039001, 91039002]}
→ { "code": 0 }
```

**注意**：
- 必须**校验 menuId 存在且 status=1**；`apiIds` 必须**全部存在于 `sys_api`**，否则报 VALIDATION_ERROR（防脏数据）。
- 绑定写入 `sys_menu_api`（`menu_id` / `api_id` / `sort`=数组下标 / `created_at`），**不修改 `sys_menu` 主表**；`sys_menu_api` 唯一性约束（menu_id+api_id）建议由 Flyway 迁移补齐（待确认现状是否已有，见 §6）。
- 需要与后端实现对齐的点：BFF 端点权限码注册、`BffApiRegistryDiffSurveyTest` 端点清单同步、`SystemWebClient` 新增透传方法。

### 5.2 备选（不推荐，仅记录）

- `POST /internal/v1/menus/{menuId}/apis` + `DELETE /internal/v1/menus/{menuId}/apis/{apiId}` 单条绑定/解绑：语义清晰、可精细控制，但请求次数多、无整体原子性，且与审计测试既有设计不一致，**不推荐作为主方案**。

---

## 6. 待确认问题

1. **是否按菜单类型限制绑定范围**？现状建议：**不限制**——目录/菜单/按钮均可绑（type=3 按钮最常见，通常绑权限码也可能需绑接口），由 UI 统一提供入口；是否需要「按钮类必绑权限码/接口」等强约束，待确认。
2. **是否支持排序**？`sys_menu_api.sort` 字段已存在、查询已按 sort 排序。P0 建议「按选择顺序自动写 sort」，P2 再评估拖拽排序；是否 P0 就要手动排序，待确认。
3. **软删菜单时绑定行如何处理**？现状 `MenuService.delete` 为软删（`status=0`，L154-163），不清理 `sys_menu_api`。由于 `tree()` 只查 `status=1` 菜单、`findApisByMenuIds` 走 `menu_id IN` 关联，脏行不会展示；建议 P0 **保留绑定行**（数据无碍），但需要确认：是否在软删时同步清理绑定行以保持数据整洁（成本低，可 P1 做）。
4. **权限码用哪个**？现状菜单按钮权限码有 `system:menu:list / add / edit / delete`（`V2__seed_data.sql`）。建议 P0 **复用 `system:menu:edit`**（绑定属于菜单编辑能力，无需新增按钮权限），或新增独立 `system:menu:api`；选哪种待确认（若新增，需 Flyway 插入按钮菜单 + 分配角色）。
5. **绑定弹层展示的接口明细字段**？`sys_api` 有 `name / http_method / path_pattern / module_id` 等。建议绑定弹层展示 `method + path_pattern`（与详情面板一致），可选带 `name`；是否还要展示接口所属模块/分组，待确认。
6. **`sys_menu_api` 唯一性约束**：现状实体/Repository 未见 `(menu_id, api_id)` 唯一索引，全量替换逻辑本身不产生重复，但建议 Flyway 补唯一索引防并发/脏数据——是否补，待确认。
7. **BFF 审计测试维护范围**：`BffApiRegistryDiffSurveyTest` 是否对菜单端点有强制清单校验，实现时需同步更新到何种程度，需架构师在实现阶段确认。

---

## 附录：关键现状锚点（供实现者核对，勿偏离）

- 前端详情面板：`menu-manage-page.tsx:557-587`（只读渲染 apiList，`Unlink` 无 onClick）。
- 菜单树组装：`MenuService.tree()` → `loadApiMap()`（`MenuService.java:186-196`）→ `SysMenuApiRepository.findApisByMenuIds()` 返回 `{method, path_pattern}`。
- `MenuService.create/update/delete`（L95-163）不写 `sys_menu_api`。
- mis-system `MenuController`：`/internal/v1/menus` 仅 `tree/router/permissions/{id}/create/update/delete`。
- `SysMenuApi` 字段：`id / menu_id / api_id / sort / created_at`。
- `SysMenuApiRepository` 仅两个只读 native query：`findBindingsByModuleId`、`findApisByMenuIds`。
- 接口字典：mis-system `ApiController` `GET /internal/v1/apis/tree?moduleId=`；`ModuleController` `GET /internal/v1/modules/{moduleId}/apis`、`GET /internal/v1/modules/{moduleId}/bindings`（只读）。
- BFF 审计测试设计 registry：`BffApiRegistryDiffSurveyTest.java:532-533` 已定义 `GET/PUT /api/v1/menus/{menuId}/apis`。
- BFF `SystemWebClient` 现有菜单方法透传 `/internal/v1/menus/*`（tree/router/permissions/{id}/create/update/delete）。
- 现有绑定数据来自 Flyway 预置（如 KB `V17__kb_hittest_perms.sql`），非运行时配置。
- **易误判点**：BFF `ModuleController` 的 `POST /{moduleId}/apis`、`PUT/DELETE /apis/{apiId}` 是**模块下接口（sys_api）的 CRUD**，不是「菜单绑定 API」；mis-system `ModuleController` 仅只读 `apiTree/bindings`。本功能新增的是「菜单 ↔ 接口」绑定管理，勿混淆。

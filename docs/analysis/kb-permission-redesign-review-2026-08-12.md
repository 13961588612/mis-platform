# 知识库（KB）权限模型改造方案 —— 可行性评审 + 改动量评估

- 评审人：软件架构师（高见远）
- 日期：2026-08-12
- 范围：只读分析，未修改任何源码
- 对象：MIS 平台知识库（KB）模块，仓库根目录 `D:\code\mis-platform`

---

## 一、结论速览

| 维度 | 结论 |
|---|---|
| 方案总体 | **基本合适但有坑**（方向正确，落地需补关键缺口） |
| 设计合理性 | 分类管理员继承知识库管理权限，与现有后端合成语义一致，合理 |
| 最大风险 | ① 知识库 create/update/delete 服务层当前**不校验数据范围**，继承语义需补服务层闸门；② 存量 `kb_acl` 的 `manage/acl` 授权行处置决策；③ UI 过滤要区分「可管理」与「可见」两套口径 |
| 工作量 | **中等**（后端中、前端中、无强制 DB 迁移） |

---

## 二、A. 现状梳理（基于代码事实）

### A.1 权限模型全景：三层两套

当前 KB 权限实际上是**三层数据**、**两套语义**：

```
分类节点管辖（kb_category_admin）        ← 管理语义（谁能管）
   └─ 知识库 ACL（kb_acl read）          ← 读/检索语义（谁能看）
   └─ 知识库 ACL（kb_acl manage/acl）    ← 管理语义补充（库级细授权）
        └─ 文档（无独立权限，随库）
```

### A.2 分类权限（分类管理员）

| 项 | 实现 | 位置 |
|---|---|---|
| 存储 | `kb_category_admin` 表：`category_id, subject_type(user/role/dept), subject_id, created_by`，UK `(category_id, subject_type, subject_id)`，FK 级联删除 | `backend/mis-migrator/.../V24__kb_category_admin.sql` |
| 校验核心 | `NodeAdminResolver`：全局管理员角色码短路（`mis.kb.admin.global-role-codes`，默认 `TENANT_ADMIN`）→ 祖先链（自身→父→…→根）任一命中 → 子树并集 | `backend/mis-kb/src/main/java/com/mis/kb/domain/service/NodeAdminResolver.java` |
| 管辖范围 | **以授权节点为根的整棵子树**（子分类继承**已经实现**） | `NodeAdminResolver.resolveManageableCategoryIds` |
| 服务 | `KbCategoryAdminService`：授权/回收前置 `assertNodeManage`（设置者须先管该节点） | `.../KbCategoryAdminService.java` |
| 前端设置入口 | 分类管理页 → 「设置管理员」弹窗 | `frontend/mis-admin-web/src/features/kb/category/kb-category-page.tsx` + `kb-category-admin-dialog.tsx` |
| 权限码 | `kb:category:manage`（设置管理员/移动）、`kb:category:list`（页面） | V24；BFF `KbController.requireCategoryManagePermission` |

### A.3 知识库管理权限

| 项 | 实现 | 位置 |
|---|---|---|
| 存储 | `kb_acl` 表：`library_id, subject_type(user/role/dept), subject_id, action(read/manage/acl)` | `V12__kb_schema.sql` + `V15__kb_incremental.sql`（V15 扩展 dept） |
| 校验核心 | `NodeAdminResolver.hasLibraryManage = hasNodeManage(库所属分类) ∨ kb_acl.exists(manage)`（Q9 合成：**后端已有「分类管辖继承库管理」语义**） | `NodeAdminResolver.java` L230-261 |
| 实际使用点 | 文档写操作（上传/启停/重解析/删除）`KbDocumentService.requireLibraryManage`；图谱/RAPTOR 构建 | `KbDocumentService.java` L457-461、`KbGraphService`、`KbRaptorService` |
| **关键缺口 1** | `KbLibraryService.create/update/delete` **服务层不校验** `hasLibraryManage`/`assertNodeManage`——只受 BFF 权限码 `kb:library:add/edit/delete` 控制，mis-kb 侧不裁定数据范围 | `KbLibraryService.java` L133-270 |
| **关键缺口 2** | `RagSettingsService.save`（保存 RAG 设置，属管理操作）同样不校验数据范围 | `RagSettingsService.java` L115-144 |
| 前端设置入口 | 知识库「权限」页（独立路由 `/kb/permissions`） | `frontend/mis-admin-web/src/features/kb/permission/kb-permission-page.tsx` |

### A.4 文档权限

**没有独立的文档级权限**。文档完全随知识库：
- 读：库可见（public ∨ ACL read）→ 文档在检索中可见；
- 写：库可管理（`hasLibraryManage`）→ 可上传/编辑/删除文档（`KbDocumentService` 双闸门：BFF 权限码 + mis-kb 管辖）。

### A.5 知识库「权限」页（方案中要改名「搜索权限」的页面）

| 项 | 现状 |
|---|---|
| 路由/标题 | `/kb/permissions`；导航标题「权限」（`frontend/mis-admin-web/src/lib/nav/kb-nav.ts` L19）；页面标题「知识库权限」；面包屑「权限」 |
| 权限项 | **三种**：`read`（只读）/ `manage`（管理）/ `acl`（授权）——`KB_ACL_ACTION_OPTIONS`（`features/kb/types.ts` L1238-1242）；后端 `AclAction` 枚举同三值（`domain/model/AclAction.java`） |
| 搜索范围控制 | 检索/问答命中可见库：`KbRetrieveService.retrieve` → `KbVisibilityService.resolveVisibleLibraryIds(userId)`（= public∧enabled ∪ ACL read，− disabled）→ `filterVisible` 收敛 `libraryIds` | `KbRetrieveService.java` L100-102；`KbVisibilityService.java` L68-93 |
| 页面可见性规则文案 | 「可见 =（密级为『公开』且状态启用）∪（当前用户/其角色/其部门被显式授予 read）−（状态停用）」 | `kb-permission-page.tsx` L191-197 |
| 命中测试 | 强制 `hasPermission(userId, libraryId, READ)` | `KbHitTestService.java` L115 |

**结论**：该页当前同时承载「读/管/授」三语义，其中**只有 `read` 真正参与检索可见性**（`manage/acl` 不参与）。方案「改名搜索权限 + 只保留只读」对**检索接口鉴权逻辑零影响**——检索本就不看 manage/acl。

### A.6 分类权限与知识库权限的关系

- **存储与授权入口各自独立**（`kb_category_admin` vs `kb_acl`）；
- **判定已合成**：`hasLibraryManage = 节点管辖 ∨ kb_acl.manage`（`NodeAdminResolver` L230，`docs/kb-document-manage-sequence.mermaid` 亦已描绘此链路）；
- **痛点根因**：前端**没有按管辖过滤**，导致用户操作路径与后端语义脱节：
  1. 知识库管理页「新增知识库」的分类下拉**列出全部分类**（`kb-library-page.tsx` L662-666），用户可在非管辖分类下建库；
  2. 建库后该库不在其管辖子树 → 文档操作 `hasLibraryManage=false` → 抛 40311（`KB_CATEGORY_NOT_MANAGEABLE`）；
  3. 用户被迫再到「权限」页给该库手动授 `manage` —— 于是出现「① 分类权限 → ② 建库 → ③ 知识库管理权限」三步痛点。
  4. 同时 `create/update/delete` 服务层不校验管辖，造成「能建库但加不了文档」「能编辑 RAG 设置但传不了文档」的割裂体验。

### A.7 前端 KB 页面清单 / 后端模块

- 前端：`frontend/mis-admin-web/src/features/kb/` 共 **40 个文件 / 11 个子目录**（api、category、components、document、engine、hittest、library、operations、permission、qa、stores、synonym + types.ts、kb-overview-page.tsx）。
- 后端：`backend/mis-kb/`（Java 微服务，Spring Boot + JPA + Flyway）；BFF：`backend/mis-admin-bff/.../controller/KbController.java`（`/api/v1/kb/**`）+ `KbFacadeService`；DB 迁移：`backend/mis-migrator/.../db/migration/V12~V34__kb_*.sql`。
- 前端门禁确认：`package.json` `typecheck` = `tsc --noEmit`；`tsconfig.json` `strict: true` + `noUnusedLocals: true` + `noUnusedParameters: true`。后端为 Java 微服务（未跑构建，纯只读分析）。

---

## 三、B. 方案评审

### B.1 设计合理性

1. **方向正确**：后端 `hasLibraryManage` 早已实现「分类管辖 → 库管理」的继承合成（Q9），方案本质是把这一语义**显性化 + 前端对齐 + 补齐服务层闸门**，与现有模型高度一致，不是另起炉灶。
2. **符合最小权限原则的方向**：「分类管理员应能管理其分类下的库」是自然语义，免去重复授权，减少「看得见但动不了」的困惑。
3. **层级设计合理**：分类（子树继承，已有）→ 知识库（管辖合成，已有）→ 文档（随库，无需新权限）。文档无独立权限的现状与方案「知识库/文档操作权限继承」一致。
4. **解耦 API 权限合理**：功能权限码（`kb:library:add` 等）管「能不能用功能」，数据范围权限（管辖/ACL read）管「能碰哪些数据」——这正是现有「双闸门」架构的延续。

### B.2 风险与坑（重点）

| # | 风险 | 说明 | 应对建议 |
|---|---|---|---|
| R1 | **服务层缺口未补则继承不成立** | `KbLibraryService.create/update/delete`、`RagSettingsService.save` 当前不校验数据范围；若只做前端过滤，任何持有 `kb:library:*` 权限码的用户仍可直连 API 操作任意库/任意分类建库 | 在 mis-kb 服务层补 `assertNodeManage`（create，校验目标分类）与 `hasLibraryManage`（update/delete/save），需要把 `userId` 从 Controller 贯通进 Service（现签名未带） |
| R2 | **存量 `kb_acl` 的 `manage/acl` 行处置** | 方案「权限页只保留 read」后，存量 `manage/acl` 行成为「UI 不可见但 API 仍生效」的孤儿权限，**不可静默保留**；若做「manage → 分类管理员」迁移，因库级与节点级粒度不同，**会权限放大**（某分类下只有一部分库被授权管理时，迁移成分类管理员等于扩大了管理范围） | 建议：**不做数据迁移**，后端枚举/表结构不动；UI 不再提供新增 `manage/acl` 入口；提供一次性只读清单报表（哪些库、哪些主体仍有 manage/acl 授权）由运营评估清理；文档明示「manage 授权仍兼容生效，仅入口下线」 |
| R3 | **UI 过滤要区分「可管理」与「可见」两套口径** | 知识库管理页/文档管理页过滤应基于「可管理」（`hasLibraryManage`/管辖）；问答/检索场景过滤应基于「可见」（`read`/public）。若混用，会出现「权限页只列我读得到的库 → 我无法给读不到的库授权」的悖论 | 权限页（搜索权限页）的库列表应显示**可管理的库**（授权 read 是管理动作）；文档管理页显示可管理的库；问答页组合框显示可见的库。各页面显式声明口径 |
| R4 | **空态与「部分有权限」** | 过滤后：非管理员进知识库管理页可能看到空树；文档管理页组合框空；同一用户同时是 A 分类管理员与 B 分类只读者时，AB 都要显示但按钮权限不同 | 空态文案（如「您暂无管辖的分类/知识库，请联系管理员」）；行级按钮继续由权限码 + 管辖双判定；「全部/仅管辖」切换保留（分类管理页已有 `onlyManageable` 先例） |
| R5 | **子分类继承与多管理员交集/并集需固化** | 现有语义：授权节点 = 整棵子树（子分类继承已有）；多主体（user∪role∪dept）、多管理员为**并集**（任一命中即放行）。方案未明确，若被误改成交集/仅限直接子级会引发权限事故 | 在设计文档/验收标准中固化：「子树继承 + 并集判定」，与 `NodeAdminResolver` 现状一致，禁止改动 |
| R6 | **`acl` 动作下线后的授权入口语义** | 现状 `acl` 允许「再授权他人」；方案只留 read 后，「谁能 grant/revoke read」应定义为「能管理该库的人」（分类管理员/全局管理员），由 BFF 权限码 `kb:acl:grant/revoke` + mis-kb `hasLibraryManage` 双闸门裁定 | 明确 `kb:acl:*` 权限码语义为「在可管理库上授予/撤销 read」；mis-kb `KbAclService.grant/revoke` 增加管辖校验（当前无） |
| R7 | **检索鉴权影响面** | 检索只依赖 read/public（`KbRetrieveService`、`KbHitTestService.hasPermission(READ)`），方案对检索接口**零影响**；但需回归确认所有文档写操作、图谱/RAPTOR 构建、RAG 设置保存均统一走 `hasLibraryManage` | 上线前按「管理操作清单 × hasLibraryManage 覆盖矩阵」回归 |
| R8 | **同名库/重名提示** | 组合框已针对同名库做强提示（`duplicatedName`）；过滤后同名提示逻辑需保留，避免过滤引入新歧义 | 保留 `KbLibraryCombobox` 现有同名/路径提示逻辑 |

### B.3 「API 权限另行设置」的边界建议

建议明确两层、两闸门：

- **L1 功能权限码（`sys_menu`/`sys_api` 注册表，BFF 拦截）**：`kb:category:add/edit/delete`、`kb:category:manage`、`kb:category:list`、`kb:library:add/edit/delete`、`kb:document:add/edit/delete`、`kb:acl:grant/revoke`、`kb:hittest:run`、`kb:library:engine-ref:view` —— 管「入口/功能可见性」。
- **L2 数据范围权限（mis-kb 服务层裁定）**：分类节点管辖（`kb_category_admin`）+ 库 ACL `read`（可见性）+ 合成的 `hasLibraryManage` —— 管「能碰哪些数据」。
- 边界红线：**功能权限码只控制入口，数据范围一律由 mis-kb 服务层二次裁定（双闸门）**。任何「有码即放行」的写接口（当前 create/update/delete/save 即属此类）必须补第二道闸。
- 「API 权限」若指网关注册表（`sys_api` 映射）：保留现状即可，**继承语义不需要新增权限码**。

---

## 四、C. 改动量评估

### C.1 后端（mis-kb / mis-admin-bff）—— 中等

| 文件 | 改动 | 量 |
|---|---|---|
| `mis-kb/.../domain/service/KbLibraryService.java` | `create` 补 `assertNodeManage(userId, categoryId)`；`update/delete` 补 `hasLibraryManage(userId, libraryId)`（方法签名加 userId） | 中 |
| `mis-kb/.../api/controller/LibraryController.java` | `create/update/delete` 传入 `currentUserId()` | 小 |
| `mis-kb/.../domain/service/RagSettingsService.java` | `save` 补 `hasLibraryManage` | 小 |
| `mis-kb/.../domain/service/KbAclService.java` | `grant/revoke` 补管辖校验（R6） | 小-中 |
| `mis-kb/.../api/controller/AclController.java` | 传入 userId | 小 |
| 新增只读清单端点（可选） | 存量 `manage/acl` 授权清单（R2） | 小 |
| BFF `KbFacadeService` / `KbController` | 透传 userId；新增「可管理库列表」接口（建议 `GET /kb/libraries?scope=manageable`，前端过滤的数据面收敛，安全侧更好） | 中 |
| 单元/集成测试 | 上述服务签名变更 + 新增校验分支的测试 | 中 |

### C.2 前端（mis-admin-web）—— 中等

| 文件 | 改动 | 量 |
|---|---|---|
| `features/kb/library/kb-library-page.tsx` | 左侧分类树 + 新增库分类下拉按管辖过滤；空态；「仅管辖」开关（复用分类管理页先例） | 中 |
| `features/kb/components/kb-library-combobox.tsx` | 增加「scope=manageable/visible」模式（文档页/权限页传 manageable；问答页传 visible） | 中 |
| `features/kb/document/kb-document-page.tsx` | 组合框过滤 + 空态 | 小 |
| `features/kb/permission/kb-permission-page.tsx` | 改标题「搜索权限」；action 下拉只保留 read；可见性规则/说明文案更新；库列表口径改为「可管理的库」 | 中 |
| `features/kb/types.ts` | `KB_ACL_ACTION_OPTIONS` 裁剪为 read（或保留枚举 + 页面过滤）；注释更新 | 小 |
| `lib/nav/kb-nav.ts` | 导航标题「权限」→「搜索权限」 | 极小 |
| `features/kb/qa/`（可选，一致性） | 问答页库选择器改为「可见库」口径 | 中 |

### C.3 数据库迁移 —— 极小（建议零迁移）

- 采纳「不迁移存量 manage/acl」策略：**无需 DDL**，仅新增可选的只读清单 SQL/报表。
- 若强行迁移 `manage → 分类管理员`：需 V35 迁移脚本 + 权限放大风险评审，**不推荐**。

### C.4 工作量结论

> **整体：中等（M）**。后端约 1.5~2 人日、前端约 2~3 人日（含回归测试与空态打磨）。

**最耗时/最易踩坑的部分**：
1. **userId 贯通 + 服务层签名变更**（Controller→Service→测试），涉及面广、回归点多；
2. **前端组合框/分类树的「可管理 vs 可见」双口径过滤**（多页面共用组件，行为分支多，空态易漏）；
3. **存量 manage/acl 数据的处置决策**（需产品/运营拍板，决策不当会权限放大或留下孤儿权限）；
4. 权限页改「搜索权限」后的**授权入口语义重定义**（谁能授 read），牵动 BFF 权限码与 mis-kb 管辖双闸门。

---

## 五、D. 建议

1. **补服务层闸门优先于 UI 过滤**：先给 create/update/delete/save 补数据范围校验，否则「继承」只是界面假象，越权路径仍在。
2. **收敛策略选「UI 收敛 + 后端兼容」**：`AclAction` 枚举与 `kb_acl` 表结构不动，`manage/acl` 授权行保留兼容生效，UI 只保留 read 入口；存量行出只读报表供运营清理，**不做自动迁移**（防权限放大）。
3. **接口收敛优于前端本地过滤**：新增 `GET /kb/libraries?scope=manageable|visible`（或 `manageable-library-ids`），前端不拉全量再过滤，数据面安全侧更好。
4. **明确双口径**：管理界面（知识库/文档/搜索权限页）用「可管理」，问答/检索场景用「可见」；页面文案写明口径，避免歧义。
5. **固化继承语义**：设计文档写明「子树继承 + 多主体并集 + 全局管理员短路」，与 `NodeAdminResolver` 现状一致，防止后续误改。
6. **回归清单**：上线前按「管理操作清单（建库/改库/删库/RAG 设置/文档写/图谱/RAPTOR/命中测试/ACL 授权）× hasLibraryManage/hasPermission 覆盖矩阵」逐一回归，重点验证 40311 路径与检索零回归。
7. **顺带修复**：趁此机会把「创建知识库可在非管辖分类下进行」这一根因消除——创建时目标分类必须在当前用户管辖内（`assertNodeManage`），从源头杜绝「三步授权」痛点。

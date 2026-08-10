# PRD（收敛一期）：知识库域一期 —— 多级分类树 + 任意层级管理员 + 子树权限

> 状态：收敛 PRD（增量）| 产品经理：许清楚（software-product-manager）| 日期：2026-08-10
> 基于全量 PRD：`doc-kb-separation-prd-2026-08-10.md`（本次只收敛「知识库域一期」范围，非重写）
> 已确认输入：`.workbuddy/memory/2026-08-10.md`（KB 历史、B1-B3、kb_category/kb_acl/KbVisibilityService 现状）；已读代码核实：`KbCategoryService`（delete 校验 `existsByParentId || existsByCategoryId` → `KB_CATEGORY_HAS_CHILDREN`）、`KbCategory`（parentId 无层级限制）、`KbAcl`/`SubjectType`（user/role/dept）、`KbVisibilityService`（visible = public∧enabled ∪ ACL read）、前端 `kb-category-page.tsx`（`flattenCategories` 仅两级，注释「分类树 P0 仅两级」）。

---

## 1. 收敛说明（与全量 PRD 的对应关系）

本次范围 = 全量 PRD 中**知识库域**相关条目的收敛版，其余条目明确排除至二期：

| 本次条目 | 收敛自全量 PRD | 状态 |
|---|---|---|
| R-KB-P0-1 多级分类树 | R-P0-2（双域树形分类，仅知识库侧） | 本期 |
| R-KB-P0-2 任意层级管理员设置 | R-P0-3（任意层级管理员，仅知识库域） | 本期 |
| R-KB-P0-3 节点管辖判定链 | R-P0-4（子树权限范围控制） | 本期 |
| R-KB-P0-4 管理员管子树目录与文档 | R-P0-4 + 原始需求「管理员可调整其下级的目录结构和目录内的文档」 | 本期 |
| R-KB-P0-5 可见范围与 kb_acl 共存 | R-P0-4 + Q9 | 本期 |
| R-KB-P1-1 操作审计 | R-P1-6 | P1（若有余量） |
| 排除：文档库新域 | R-P0-1 / R-P0-2（文档库侧）/ Q1/Q2/Q6 | 二期 |
| 排除：跨域引用（知识库选文档库文档） | R-P0-5 / Q7 | 二期 |
| 排除：单文档粒度权限 | R-P1-2 / Q4-B | 二期 |
| 排除：批量授权 | R-P2-1 | 二期 |
| 排除：管理员移交/委托 | R-P2-3 / US-6 | 二期 |
| 排除：存量数据迁移 | R-P1-4（仅文档库域相关） | 二期 |

---

## 2. 项目信息

| 项 | 值 |
|---|---|
| Language | 中文 |
| 技术栈 | 前端 `frontend/mis-admin-web`（Vite + React + TS + Tailwind + shadcn/ui）；后端 Java 17 Spring Boot 微服务（mis-kb / mis-iam / mis-admin-bff / mis-org）；PG（Flyway） |
| 项目名 | `kb_category_tree_admin`（知识库域一期） |
| 原始需求（收敛后） | 知识库分类树支持任意层级；任意节点可设置管理员；节点管理员可管理其下级目录结构与目录内文档；权限范围=以该节点为根的子树 |

### 2.1 现状锚点（本次改动直接落点）

- **后端已支持多级**：`kb_category.parent_id` 无层级限制，`KbCategoryService.create/update/delete` 已就绪；删除校验已含 `KB_CATEGORY_HAS_CHILDREN`（子节点或库引用）。
- **前端仅两级**：`kb-category-page.tsx` 的 `flattenCategories` 只渲染「根→子」两行，`parentId` 下拉只列根节点——本次加深到任意层级。
- **库级 ACL 可复用**：`kb_acl`（library_id + subject_type + subject_id + action=read/manage/acl），`KbVisibilityService` 已实现 user∪role∪dept 并集取数与 read 判定。
- **改造方式**：现有 features/kb 就地改造，不并行新域（Q6 已拍板）。

---

## 3. 产品目标（本次版本）

1. **多级树形治理**：知识库分类树从「两级」加深为「任意层级」，支持展开/折叠与完整节点操作（新建子级/重命名/移动/删除/排序/启停），解除树深硬限制。
2. **分级授权**：任意层级分类节点可设置管理员（主体=用户/角色/部门），管理员的管理范围=以该节点为根的子树；形成「全局管理员 → 节点管理员」分级治理，避免所有操作都汇聚到平台管理员。
3. **权责对等**：节点管理员可调整其管辖子树内的目录结构与目录内文档，但不可越权操作兄弟/父级/管辖外内容；普通用户仍按现有 kb_acl 读取授权访问，互不干扰。

---

## 4. 用户故事（聚焦知识库域）

| # | 角色 | 场景 | 价值 |
|---|---|---|---|
| US-KB-1 | 平台/租户管理员 | 在知识库分类页创建「技术/产品/市场」多级树，为「技术/后端」节点设置一名部门管理员 | 分级授权，管理入口从平台管理员下沉到业务负责人 |
| US-KB-2 | 节点管理员 | 登录后左侧树只显示/高亮自己管辖的子树；在「技术/后端」下新建「知识库子系统」子目录、重命名、调整顺序、删除空节点 | 权责对等，只对自己分管范围负责 |
| US-KB-3 | 节点管理员 | 管理「技术/后端」子树内的文档：上传、编辑、停用/启用、删除、重新解析；目标位置选在管辖范围外时被拒绝并给出提示 | 目录内文档随目录管辖，操作闭环 |
| US-KB-4 | 节点管理员 | 尝试把「技术/后端」移动到「市场」节点下（移出管辖范围）→ 被拒；尝试删除仍有子节点或挂有知识库的节点 → 被拒（沿用子树/引用校验） | 防止越权与数据破坏 |
| US-KB-5 | 全局管理员 | 在节点「技术」的管理员设置弹窗查看当前管理员列表（用户/角色/部门），移除某管理员授权 | 可设置、可回收，授权生命周期完整 |
| US-KB-6 | 节点管理员 | 节点管理员自动获得该节点下所有知识库的 manage（无需逐库单独授权）；普通用户按 kb_acl 读取权限访问库 | 管理/读取两层语义解耦，不互相污染 |

---

## 5. 需求池（本期边界）

### P0（必须，本期交付）

| ID | 需求 | 简述 | 验收要点 |
|---|---|---|---|
| R-KB-P0-1 | 多级分类树（前端加深） | `kb-category-page` 的 `flattenCategories` 由两级改为递归任意层级；树组件支持展开/折叠、缩进、节点操作菜单（新建子级/重命名/移动/删除/排序/启停） | ① 可创建/展示 ≥3 级树；② 展开/折叠状态可记忆（组件内 state 即可）；③ 新建子级时父级下拉显示完整树（含任意层级）而非仅根节点 |
| R-KB-P0-2 | 任意层级管理员设置 | 新建 `kb_category_admin` 授权表；任意层级节点可设置/移除管理员（主体=user/role/dept，复用 `SubjectType`） | ① 节点操作菜单有「设置管理员」入口；② 弹窗可添加/移除多个管理员；③ 主体选择器支持用户/角色/部门三类；④ 同一节点同主体不可重复授权（唯一约束） |
| R-KB-P0-3 | 节点管辖判定链 | 新增节点管辖判定（沿祖先链查授权 + 全局管理员短路），支撑目录与文档操作校验、移动目标范围校验、可见范围计算 | ① 判定逻辑独立成可单测的服务（NodeAdminResolver）；② 全局管理员/superadmin/TENANT_ADMIN/域级权限码直接放行；③ 非管理员对无授权节点操作返回明确拒绝（业务码） |
| R-KB-P0-4 | 管理员管子树目录结构与文档 | 目录管理（增/删/改/移动分类节点）与文档管理（该节点下文档上传/编辑/删除/重解析等）受节点管辖判定约束 | ① 管理员可在管辖子树内新建/重命名/移动/删除节点、管理文档；② 移动节点目标父节点必须在本人管辖子树内（Q8）；③ 删除沿用子树/引用校验（`KB_CATEGORY_HAS_CHILDREN`）并扩展校验 `kb_category_admin` 引用；④ 不可操作管辖外节点 |
| R-KB-P0-5 | 可见范围与 kb_acl 共存 | 可见范围=命中的管理员节点子树并集；节点管理员自动获得该节点下所有库的 manage（Q9）；kb_acl 保留为库级补充授权；`KbVisibilityService` 读语义不变 | ① 节点管理员能看到并管理管辖子树内全部库（合成 manage）；② 普通用户读可见性仍由 `KbVisibilityService`（public ∪ ACL read）裁定，不被节点授权污染；③ kb_acl 既有授权不回归 |

### P1（应当，本期若有余量）

| ID | 需求 | 简述 | 验收要点 |
|---|---|---|---|
| R-KB-P1-1 | 操作审计 | 管理员设置/回收、目录结构变更（增删改移动）、文档写操作（上传/删除/停用/重解析）挂 `@OperLog` 审计 | ① 上述写操作均有留痕（操作人/时间/对象）；② 可按域+节点过滤查询 |
| R-KB-P1-2 | 大节点树性能 | 分类节点规模较大（>500）时，树加载/展开采用懒加载或分页，避免一次拉全量 | ① 万级节点下首页可交互不卡顿；② 懒加载不影响展开/折叠体验 |

### P2（明确二期，不展开设计）

| ID | 需求 | 来源 |
|---|---|---|
| R-KB-P2-1 | 文档库新域（原始文档资产独立管理、独立分类树、独立权限） | 全量 R-P0-1 / R-P0-2 文档库侧 / Q1/Q2/Q6 |
| R-KB-P2-2 | 跨域引用（知识库从文档库选文档、引用/快照模式、同步策略） | 全量 R-P0-5 / R-P1-3 / Q7 |
| R-KB-P2-3 | 单文档粒度权限 | 全量 R-P1-2 / Q4-B |
| R-KB-P2-4 | 批量授权（多节点勾选统一授权） | 全量 R-P2-1 |
| R-KB-P2-5 | 管理员移交/委托 | 全量 R-P2-3 / US-6 |

---

## 6. 权限模型（可直入架构设计）

### 6.1 设计原则（沿用全量 PRD §2.3/§6）

- **不新建第二套 RBAC**：功能权限（能否用按钮）沿用菜单权限码；节点管理员是「资源授权行」，不是动态角色（Q3 已拍板）。
- **判定链**：先功能权限码（菜单）→ 再节点资源授权（祖先链）→ 最后库可见性（读）/引擎侧文档过滤（检索）。

### 6.2 数据模型（新建 `kb_category_admin`，与 kb_acl 同构）

```sql
-- Flyway 新版本迁移
CREATE TABLE kb_category_admin (
    id           BIGINT PRIMARY KEY,
    category_id  BIGINT      NOT NULL,   -- kb_category.id，任意层级节点
    subject_type VARCHAR(20) NOT NULL,   -- user | role | dept（复用 SubjectType）
    subject_id   BIGINT      NOT NULL,   -- 复用 mis-iam/mis-org 主体 id
    created_at   TIMESTAMP   NOT NULL,
    updated_at   TIMESTAMP   NOT NULL,
    CONSTRAINT uk_kb_category_admin UNIQUE (category_id, subject_type, subject_id),
    CONSTRAINT fk_kb_category_admin_category FOREIGN KEY (category_id)
        REFERENCES kb_category(id) ON DELETE CASCADE  -- 删节点级联清授权行
);
-- 索引：按主体查（判定用）+ 按节点查（设置列表用）
CREATE INDEX idx_kb_category_admin_subject ON kb_category_admin (subject_type, subject_id);
CREATE INDEX idx_kb_category_admin_category ON kb_category_admin (category_id);
```

语义：某主体是该节点管理员，管理范围 = 以该节点为根的**子树**（目录结构 + 目录内文档 + 该节点下所有库的 manage，见 Q9）。action 固定为「manage 子树」，不设 read 列（读由 kb_acl/KbVisibilityService 另行裁定）。

### 6.3 判定链伪代码（NodeAdminResolver）

```
# 主体集：当前用户自身 + 其角色 + 其部门（与 KbVisibilityService.resolveGrantedLibraryIds 同一取数口径）
subjects(user) = {user.id} ∪ user.roles.id ∪ user.depts.id

# 判定：用户是否可管理某分类节点（含其子树）
hasNodeManage(user, nodeId) -> bool:
  1) if user.superadmin or user.hasRole(TENANT_ADMIN)
       or user.hasPermCode("kb:category:manage"):   # 域级权限码，全局管理员短路
     return true
  2) for cur in ancestorChain(nodeId):               # 沿 nodeId → parent → ... → 根（含自身）
       if kb_category_admin.exists(category_id = cur, subject_type ∈ {user,role,dept},
                                   subject_id ∈ subjects(user)):
         return true
  3) return false

# 可见/可管范围：所有命中的管理员节点的子树并集
resolveManageableCategoryIds(user) -> Set<categoryId>:
  1) hitNodes = kb_category_admin.where(subject ∈ subjects(user)).category_id
  2) return union( subtree(h) for h in hitNodes )    # 子树 = 自身 + 全部后代

# 移动校验（Q8）：目标父节点必须在本人管辖范围内
canMove(user, nodeId, newParentId) -> bool:
  return hasNodeManage(user, nodeId)
     and hasNodeManage(user, newParentId)            # 目标位置在管辖子树内
     and newParentId ∉ subtree(nodeId)               # 防环：不能移入自己后代

# 删除校验（扩展现有 KB_CATEGORY_HAS_CHILDREN）
canDelete(user, nodeId) -> bool:
  return hasNodeManage(user, nodeId)
     and not kb_category.existsByParentId(nodeId)
     and not kb_library.existsByCategoryId(nodeId)
     # kb_category_admin 行由 FK ON DELETE CASCADE 清理，无需业务拦截

# 库级 manage 合成（Q9）：节点管理员自动获得该节点下所有库的 manage
hasLibraryManage(user, libraryId) -> bool:
  categoryId = kb_library.categoryId(libraryId)
  if hasNodeManage(user, categoryId): return true     # 节点管辖命中 → 库 manage
  return kb_acl.exists(libraryId, subject ∈ subjects(user), action = manage)  # kb_acl 补充
```

### 6.4 与 kb_acl / KbVisibilityService 的共存关系

| 维度 | kb_acl（保留） | kb_category_admin（新增） | KbVisibilityService（不变） |
|---|---|---|---|
| 粒度 | 库级 | 分类节点级（子树继承） | 库级（读可见性） |
| 动作 | read / manage / acl | manage 子树（隐含） | read 判定 |
| 语义 | 库级补充授权（读/管理/授权管理） | 节点管理员 = 子树治理权 | visible = public∧enabled ∪ ACL read − disabled |
| 变更面 | 不动，仅判定时被「合成」引用 | 新增表 + NodeAdminResolver + CRUD | 不动；节点管理员管辖子树作为候选可见集与库可见性取交集 |

- **读可见性**：普通用户读库仍走 `KbVisibilityService`（public ∪ ACL read），节点授权不扩大普通用户读取范围。
- **管理可见性**：节点管理员在管理端看到管辖子树（`resolveManageableCategoryIds`）；其文档/目录操作以 `hasNodeManage` 为准。
- **检索/问答**：引擎侧文档过滤仍沿用现有可见库集合口径，本期不引入节点级过滤（单文档粒度二期）。
- **双向不污染**：给某节点设置管理员 ≠ 给该节点下所有库设置 read 给所有人；只给该管理员本人合成 manage。

### 6.5 关键取舍（沿用全量 PRD §6.5，写入口径）

- **子树继承用祖先链查询而非物化子树授权行**：避免增删节点时同步改大量授权行；千级节点深度可控。
- **删除节点**：沿用 `KB_CATEGORY_HAS_CHILDREN`（先删子/迁子再删节点），授权行 FK 级联清理，避免孤儿授权。
- **不做部门树向上继承**：授权给「研发部」不自动覆盖子部门，部门选择器树形多选显式勾选（与现有 KbVisibilityService 口径一致）。
- **功能权限码仍先行（双闸门）**：节点管理员能管子树，但若角色未配「文档上传」等按钮权限码，仍不能执行该操作；文案需说明「授权管子树 ≠ 获得全部功能按钮」。

---

## 7. UI 设计稿（知识库分类页就地改造）

### 7.1 页面布局：左树右表（任意层级树 + 节点操作）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 知识库分类                              [＋ 新增根分类] [＋ 新建子级]        │
├──────────────────────────┬───────────────────────────────────────────────┤
│ 分类树                    │ 当前节点：技术文档/后端                          │
│ ▼ 技术          ⋯        │ ┌─────────┬──────┬─────┬──────────┬──────────┐ │
│   ▼ 后端  ⚙管理员 ◀管辖   │ │ 知识库  │状态  │密级  │ 更新时间  │ 操作      │ │
│     └ 知识库子系统         │ ├─────────┼──────┼─────┼──────────┼──────────┤ │
│   └ 前端                  │ │ 产品KB  │启用  │公开  │ 2026-08-10│ 管理/删除 │ │
│ ▼ 产品        ⋯          │ │ 制度KB  │启用  │秘密  │ 2026-08-09│ 管理/删除 │ │
│   └ 市场      ⚙管理员     │ └─────────┴──────┴─────┴──────────┴──────────┘ │
│ ▼ 制度                    │  说明：仅显示我有权限的节点；管辖子树高亮         │
└──────────────────────────┴───────────────────────────────────────────────┘
```

树组件交互要点：
- **任意层级展开/折叠**：递归渲染，缩进按 depth；展开状态存组件 state（可记忆到 localStorage）。
- **节点操作菜单**：节点行悬浮 `⋯`（或右键）弹出菜单：新建子级 / 重命名 / 移动 / 启停 / 删除 / **设置管理员**。操作入口按权限码门控（`kb:category:add/edit/delete`）+ 管辖判定（非管理员仅可查看，不可操作）。
- **管辖范围高亮**：当前用户管辖的节点（含命中管理员节点的整棵子树）高亮底色 + 树根标记 ⚙；管辖外节点置灰或隐藏（管理员视角可切换「只看管辖」/「全部」）。
- **移动**：拖拽或弹窗选目标父节点；目标下拉只列「本人管辖子树内且非自己后代」的节点（Q8 前端先行约束，后端再校验）。
- **删除**：沿用现有 confirm 提示「分类下若仍有知识库将被后端拒绝」，文案补充「或仍有子分类/管理员授权时拒绝」。

### 7.2 节点管理员设置弹窗

```
┌─────────── 设置管理员：技术/后端 ───────────┐
│ 当前管理员（管理范围=本节点及全部子目录）      │
│  ┌──────────────────────────────────────┐  │
│  │ [张三] 用户   研发部        [移除]    │  │
│  │ [研发角色] 角色  默认角色   [移除]    │  │
│  │ [研发部] 部门   研发部      [移除]    │  │
│  └──────────────────────────────────────┘  │
│ 添加管理员：                                │
│  主体类型: (●)用户 ( )角色 ( )部门          │
│  [选择用户/角色/部门…]（树形多选，部门支持）  │
│  说明：管理员可管理本节点及其全部子目录内的    │
│  目录结构与文档，并自动获得本节点下所有知识库  │
│  的管理权限。                                │
│                              [取消] [保存]  │
└────────────────────────────────────────────┘
```

弹窗要点：
- 主体选择器复用现有用户/角色/部门选择组件（部门树形多选，不做部门向上继承，显式勾选子部门）。
- 保存后立即生效（写 `kb_category_admin`），无需二次确认；移除管理员二次确认。
- 弹窗内提示管辖范围语义（见上「说明」），并提示「授权管子树 ≠ 获得全部功能按钮」（双闸门）。

### 7.3 越权与约束提示

- 越权操作（管辖外新建/移动/删除/管文档）→ 后端返回明确业务错误码 + 前端 toast「该节点不在您的管理范围内」。
- 移动目标超出管辖范围 → 目标下拉不出现该节点 + 提交时后端复核拒绝。
- 删除非空节点 → 沿用 `KB_CATEGORY_HAS_CHILDREN` 文案。

---

## 8. 已拍板决策记录（写入即生效，不再询问）

| # | 决策 | 值 |
|---|---|---|
| Q3 | 管理员形态 | 资源授权行（kb_category_admin），非动态角色 |
| Q4 | 权限粒度 | 一期到节点（子树继承）；单文档粒度二期 |
| Q5 | 分类表 | 复用现有 kb_category 加深，不新建表、不复用 mis-org |
| Q8 | 移动范围 | 目标位置必须在本人管辖范围内（且不能移入自己后代） |
| Q9 | 节点管理员与库 ACL | 节点管理员自动获得该节点下所有知识库的 manage；kb_acl 保留为补充 |
| Q6 | 前端改造方式 | 现有 features/kb 就地改造，不并行新域 |

## 9. Open Questions（如需澄清）

- O-1：管理员被移除授权时，其名下已创建的子目录是否保留？（建议：保留，目录归属不变，仅失去管理权；待架构侧确认）
- O-2：`kb_category_admin` 是否需要「创建人 created_by」字段以支撑审计/追溯？（建议：加，成本极低，服务 P1 审计）
- O-3：管理员「移动」采用拖拽还是弹窗选择？（建议：一期弹窗选择更稳，拖拽二期增强；前端交互可两者皆做，后端校验不变）

---

## 10. 验收口径（P0 完成定义）

1. 前端分类树任意层级渲染、展开/折叠、节点操作菜单齐套（新建子级/重命名/移动/删除/排序/启停）。
2. `kb_category_admin` 落库（Flyway），节点管理员设置/移除/列表端到端可用，主体三类可选。
3. `NodeAdminResolver` 判定链（全局短路 + 祖先链 + 子树并集）有单测覆盖：全局管理员放行、直接授权命中、祖先继承命中、角色/部门命中、无授权拒绝、移动范围校验、防环校验。
4. 节点管理员可管子树内目录与文档；越权与非法移动被拒且提示明确；删除沿用子树/引用校验。
5. kb_acl 既有授权与 `KbVisibilityService` 读可见性不回归（存量用例全绿）。

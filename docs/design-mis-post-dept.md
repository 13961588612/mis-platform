# MIS 平台 /system/post 与部门树 增量改造 — 系统设计 + 任务分解

> 范围：需求 A（岗位管理主表格新增「组织」列并调整列序）+ 需求 B（部门树「编制数」列右移 + 钻取只读行计数列显 0）。
> 性质：增量改造，无 Flyway 迁移（组织信息已存在于 `SysDept.orgId` + `SysOrg`）。
> 角色：架构师（高见远）产出，仅设计不写实现代码。

---

## 1. 最终文件清单（相对仓库根 `D:\code\mis-platform`）

### 后端 mis-org
- `backend/mis-org/src/main/java/com/mis/org/dto/PostVO.java` — 新增 `orgId` / `orgName` 字段
- `backend/mis-org/src/main/java/com/mis/org/service/PostService.java` — 注入 `orgRepository`；`list()` 批量预取；`toVo` 改造

### 后端 mis-admin-bff（聚合层）
- `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/model/PostVO.java` — 新增 `orgId` / `orgName` 字段（透传）
- （无需改动）`client/OrgWebClient.java`、`service/OrgFacadeService.java` — 已正确透传 `orgIds`（见 R3）

### 前端
- `frontend/mis-admin-web/src/types/api.ts` — `PostItem` 增加 `orgId` / `orgName`
- `frontend/mis-admin-web/src/features/system/page-defs.ts` — `/system/post` 列定义重排 + loader 增加 org 映射
- `frontend/mis-admin-web/src/features/system/dept/dept-tree-page.tsx` — 列数组重排 + `<td>` 重排 + readOnly 计数显 0
- （无需改动）`frontend/mis-admin-web/src/lib/api/posts.ts` — 仅 `import type { PostItem }`，类型来源为 `api.ts`，本文件无需改
- （无需改动）`frontend/mis-admin-web/src/features/system/dept/dept-tree-types.ts` — 结构已承载 `establishmentCount`（穿透行 null），B2 纯前端渲染 0，无需改

---

## 2. 后端 API 契约

### 2.1 PostVO（mis-org 与 BFF 同步）
新增两字段，命名沿用 `deptId`/`deptName` 风格（camelCase），置于 record 末尾（`quota` 之后），保证向前兼容：

- `String orgId` — 部门所属组织 id（来自 `SysDept.orgId`；实体 `Long`，VO 序列化为 `String`，与 `deptId` 一致）
- `String orgName` — 组织名称（来自 `SysOrg.name`；可为 null，但 `SysDept.org_id NOT NULL`，正常必能解析；保留 null 兼容历史脏数据）

完整字段序：
`id, tenantId, deptId, deptName, postTypeId, postTypeName, code, name, sort, status, quota, orgId, orgName`

### 2.2 PostService 取 org 的方式（避免 N+1）
现状：`PostService` 构造器仅注入 `postRepository / postTypeRepository / employeePostRepository / deptRepository`，**未注入 `orgRepository`**；`toVo(SysPost)` 逐条 `deptRepository.findById` 取 `deptName`、`postTypeRepository.findById` 取 `postTypeName` —— **本身已存在 N+1**（每条岗位 2 次查询）。

改造方案（推荐：批量预取，顺带消除既有 N+1）：
1. 构造器新增第 5 个参数 `SysOrgRepository orgRepository` 并保存。
2. `list()` 内：过滤出 posts 后，收集 `deptIds = posts.deptId 集合` → `deptRepository.findAllById(deptIds)` 组装 `Map<Long,SysDept>`（同时得到 `deptName` 与 `dept.getOrgId()`）；由这些 dept 收集 `orgIds` → `orgRepository.findAllById(orgIds)` 组装 `Map<Long,SysOrg>`（`orgName`）；收集 `postTypeIds` → `postTypeRepository.findAllById(postTypeIds)` 组装 `Map<Long,SysPostType>`。
3. 新增私有 `toVo(SysPost p, Map<Long,SysDept> depts, Map<Long,SysOrg> orgs, Map<Long,SysPostType> types)` 用于 `list()`：从 map 取 `deptName` / `orgName` / `postTypeName`，取不到返回 null。
4. 保留原 `toVo(SysPost p)` 重载（逐条查询）供 `getById / create / update` 单条路径使用 —— 单条无 N+1 风险，签名不变，调用点不动。

> 备选（最小改动）：保持 `toVo(SysPost)` 逐条，仅在其中 `deptRepository.findById(p.getDeptId())` 拿到 `SysDept` 后 `.map(SysDept::getOrgId)` → `orgRepository.findById(orgId).map(SysOrg::getName)`。缺点：再叠加 1 次/条的 N+1，列表稍大即放大延迟。**不推荐**，仅作兜底。

确认：`SysOrgRepository extends JpaRepository<SysOrg,Long>`，具备 `findById` 与 `findAllById`（批量），可用。`SysDept.getOrgId()` 存在。

### 2.3 控制器
mis-org `PostController` 直接返回 `List<PostVO>`（已含 `orgIds` 入参透传），**无需改动** —— 新字段随 record 自动序列化。

---

## 3. BFF 透传改动
- 仅需改 `client/model/PostVO.java`：与 mis-org 同步新增 `orgId, orgName`（同序、同类型）。BFF 通过 `OrgWebClient.listPosts` 反序列化 mis-org JSON 后原样转发，字段名匹配即可（Jackson 按属性名映射，顺序无关，但保持同序更清晰）。
- `OrgWebClient.listPosts(tenantId, deptId, deptIds, postTypeId, status, orgIds)` 已把 `orgIds` 作为最后参数下发 mis-org `/internal/v1/posts?...&orgIds=`（L185-190）。
- `OrgFacadeService.listPosts(deptId, deptIds, orgIds, postTypeId, status)` → `orgWebClient.listPosts(tenantId, deptId, deptIds, postTypeId, status, orgIds)`（L196-197）：**参数顺序一致，`orgIds` 已正确透传**（见 R3）。二者均无需改签名。

---

## 4. 前端改动点

### 4.1 page-defs.ts（需求 A）
- **列定义**（当前 L245-252）：目标序 `组织, 所属部门, 岗位编码, 岗位名称, 岗位类型, 编制, 状态`。在数组**首位插入** `{ key:'org', label:'组织' }`，并将 `{ key:'dept', label:'所属部门' }` 从原第 3 位移至第 2 位（其余 code/name/post_type/quota/statusText 顺延）。
- **loader**（L261-282）：在 `.map()` 返回值中新增 `org: p.orgName ?? null` 与 `orgId: p.orgId ?? null`（列 key=`org` 对应 `orgName`；`orgId` 一并带上，见 R7）。列顺序由 `columns` 控制，loader 只需补齐字段。

### 4.2 types/api.ts — PostItem（~L352）
在 `deptName` 之后新增：
```ts
orgId?: string;
orgName?: string | null;
```
`lib/api/posts.ts` 仅 `import type { PostItem }`，**无需改动**（`listPosts` 返回类型自动包含新字段）。

### 4.3 dept-tree-page.tsx（需求 B）
- **(B1) 列数组重排**（L97-113）：将 `{ key:'establishmentCount', label:'编制数' }` 从当前第 3 位（code 之后）移到 `{ key:'postCount', label:'岗位数' }` **之后**。
  目标：`name, code, deptTypeName, isLeaf, linkedOrg, postCount, establishmentCount, filled, vacant, sort, status, __ops__`
- **(B1) `<td>` 重排**（L377-447）：当前 `establishmentCount <td>`（L380-382，位于 code `<td>` 之后、即第 3 格）整体移至 `postCount <td>`（L413-415）**之后**、`filled <td>`（L416）之前。
- **(B2) readOnly 计数显 0**：
  - `establishmentCount <td>`（L381）：`readOnly ? <span>—</span> : ...` → `readOnly ? 0 : row.establishmentCount ?? 0`
  - `filled <td>`（L417-418）：`readOnly ? <span>—</span> : ...` → `readOnly ? 0 : ...`
  - `vacant <td>`（L426-427）：`readOnly ? <span>—</span> : ...` → `readOnly ? 0 : ...`
  - `postCount`（L414）已是 `readOnly ? ... : vo ? vo.postCount : 0` → readOnly 已渲染 0，无需改。

### 4.4 dept-tree-types.ts
**无需改动**。B2 纯前端：`DeptPierceNode`（api.ts ~163）无 `establishmentCount/postType/filled/vacant` 字段，穿透行 `normalizePierceNode` 已将其置 null（L131-133）；改后渲染分支对 readOnly 直接显 0 即满足，结构不变。

---

## 5. 有序任务列表（后端优先 → BFF → 前端 → 测试）

依赖链：
`T01 后端 mis-org` → `T02 后端 BFF` → `T03 前端岗位页` → `T05 测试`
`T04 前端部门树`（纯前端，可并行 T03）→ `T05 测试`

| ID | 任务 | 源文件 | 依赖 | 优先级 |
|----|------|--------|------|--------|
| T01 | 后端 mis-org：PostVO 加 orgId/orgName；PostService 注入 orgRepository；list() 批量预取；toVo 双重载 | `dto/PostVO.java`, `service/PostService.java` | 无 | P0 |
| T02 | 后端 BFF：PostVO 透传 orgId/orgName（OrgWebClient/OrgFacadeService 不动） | `client/model/PostVO.java` | T01 | P0 |
| T03 | 前端岗位页：api.ts PostItem 增字段；page-defs.ts 列定义插入「组织」+ loader 映射 | `types/api.ts`, `features/system/page-defs.ts` | T01,T02 | P1 |
| T04 | 前端部门树：列数组重排 + <td> 重排 + readOnly 计数显 0 | `features/system/dept/dept-tree-page.tsx` | 无（纯前端） | P1 |
| T05 | 测试：后端 PostServiceListFilterTest 补 org 断言（+ 构造器同步）；前端新增列序/0 值渲染测试 | `PostServiceListFilterTest.java`, 前端 *.test.ts | T01–T04 | P1 |

> 说明：本改为增量改造，无新增工程配置/入口文件，故未套用「首个任务=项目基础设施」的绿field 模板；任务按模块/层次分组，单任务文件数可能 <3（如 T02 仅 1 文件），属正常。

---

## 6. 测试计划

### 后端
现有 `PostServiceListFilterTest`（Mockito）直接 `new PostService(...)`（4 参，L66）—— **新增 orgRepository 后会编译失败**，必须同步：
- 增加 `@Mock SysOrgRepository orgRepository`；`setUp()` 构造改为 `new PostService(postRepository, postTypeRepository, employeePostRepository, deptRepository, orgRepository)`。
- 现有 `dept(...)` fixture 仅设 orgId/tenantId；补 `org(Long id, String name)` helper，并在相关用例 `when(orgRepository.findAllById(anyList())).thenReturn(List.of(org(10L,"组织A"), org(20L,"组织B")))`（批量方案）或按 `findById` 桩（逐条方案）。
- 在 `NoConstraint.allNullReturnsAll` 等用例追加断言：`result` 中每个 VO 的 `orgId()` / `orgName()` 非空且与 `dept.orgId` 对应（如 post1/dept101/org10 → `orgId="10"`, `orgName="组织A"`）。建议新增 `@Nested OrgNameEnrichment` 专测：单条 `toVo`、批量 `list` 均带正确 `orgName`；`dept` 无对应 org（脏数据）时 `orgName=null` 不报错。
- 建议：不新增独立测试类，扩展现有测试即可。

### 前端
- 现有 `dept-tree-types.test.ts` 仅覆盖防环纯函数（`isOrgInChain`/`buildOrgChain`），**与本次无关，无需改**。
- 建议新增（或并入现有 *.test.ts）：
  1. `page-defs` 列顺序快照：断言 `/system/post` 的 `columns.map(c=>c.key)` === `['org','dept','code','name','post_type','quota','statusText']`，防列序回归。
  2. loader 映射：构造伪 `listPosts` 返回含 `orgId/orgName` 的 `PostItem`，断言 `.map()` 产物含 `org` / `orgId` 且 `dept` 不变。
  3. dept-tree 渲染 0 值：对 readOnly 行（`establishmentCount`/`filled`/`vacant = null`）断言单元格渲染文本为 `0` 而非 `—`（Testing Library 查文本）。
- 以上为建议项（非必做），但强烈建议 #1 与 #3 纳入，成本低、护住本次核心改动。

---

## 7. 风险 / 待确认

- **R1 N+1**：现状 `toVo` 已逐条查 dept/postType；追加 org 再逐条会再 +1 次/条。采用 §2.2 批量预取方案可一并消除三者 N+1；若评估列表量极小（<50），逐条兜底可接受，但需明确。**建议批量方案**。
- **R2 测试编译阻断**：T01 改构造器签名会令 `PostServiceListFilterTest` 立即编译失败（L66），须同步更新 mock + 构造调用（见 §6）。属必做，已纳入 T05。
- **R3 BFF/mis-org listPosts 参数顺序（已闭环）**：核查确认 `OrgWebClient.listPosts(…, orgIds)` 与 `OrgFacadeService.listPosts(…)` → 调用实参顺序 `(tenantId, deptId, deptIds, postTypeId, status, orgIds)` **完全一致**，`orgIds` 已透传，不漏参。BFF 仅需改 PostVO 模型，无需动调用链。✅ 风险解除。
- **R4 PostVO 字段顺序/序列化**：mis-org 与 BFF 两处 PostVO 必须同名字段（`orgId`/`orgName`），Jackson 按名映射；建议两处同序（置于 `quota` 后）以减少歧义。前端 `PostItem` 字段名须与后端 JSON 一致（`orgId`/`orgName`，非 `org_id`）。
- **R5 历史脏数据**：理论上 `SysDept.org_id NOT NULL`，但若有 `dept.orgId` 指向不存在的 org（软删/脏数据），`orgRepository` 取不到 → `orgName=null`，渲染空。建议 org 列对 null 显示「—」或空，避免误显 0（org 列与计数 0 语义不同）。
- **R6 明确不做（已确认）**：下钻顶级部门显示（第 2 点①）不做；`DeptService.pierce(orgId)` 行为已满足，不增任务。
- **R7 PostItem 是否带 orgId**：建议**同时带 `orgId` 与 `orgName`**（与既有 `deptId`/`deptName` 对称，成本低，便于将来按组织下钻/联动，且列「组织」仅用 `orgName`）。若坚持极简，仅带 `orgName` 亦可，但 `orgId` 几乎零成本，推荐都带。

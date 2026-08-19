# 组织→部门强绑定规则 + 部门管理页行为改造（G1–G7）· 独立回归验证 Sign-off

> 验收人：严过关（software-qa-engineer）
> 方式：独立读源码 + 独立跑前端门禁 + 独立后端静态/契约审查（不采纳工程师"已达成"自述）
> 环境：Git Bash / node v22.22.2 / npm 10.9.7；后端 Maven 损坏（见第四节，仅静态审查，不伪造编译）
> 轮次：第 1 轮（门禁 + 静态复核全绿，未发现问题）→ 无需第 2 轮

---

## 一、前端门禁实际结果

| 门禁 | 命令 | 结果 |
|------|------|------|
| typecheck | `cd frontend/mis-admin-web && npm run typecheck` → 实际执行 `tsc --noEmit` | **PASS · EXIT=0 · 0 错误** |
| build | `npm run build` → `tsc --noEmit && vite build` | **PASS · EXIT=0 · 2288 modules · built in 46.64s**（仅 chunk>500kB 体积告警，非错误） |

> 注：首次以 `npm run` 后台方式跑 typecheck 时，进程被沙箱后台任务时限（~4min）中断（killed）；改用前台有界运行 `node_modules/.bin/tsc --noEmit`（timeout 280）复跑即为 EXIT=0、零输出，确认门禁真实通过，非编译失败。第 1 轮即全绿，未消耗第 2 轮。

---

## 二、逐条判定表（规则 | 现状 | 结论 | 证据 file:line）

### 规则组 1（后端：OrgService / DeptService / SysDeptRepository）

| 规则 | 现状 | 结论 | 证据 file:line |
|------|------|------|----------------|
| 1.1 建组织自动建部门 | 事务内 `new SysDept()` + `deptRepository.save(root)`，与 org 同事务原子提交 | ✅ 维持达成 | `OrgService.java:72,99-114` |
| 1.2 该部门为根部门 | `setParentId(0L)` + `setIsRoot(1)` | ✅ 维持达成 | `OrgService.java:103,110` |
| 1.3 同名且不可修改 | 自动同名（create L105）；后端 `DeptService.update` 对 `isRoot==1` 拦截 name/status 修改 | ✅ 缺口闭合（G1） | 同名 `OrgService.java:105`；守卫 `DeptService.java:157-166` |
| 1.4 改组织→同步顶级部门名/状态 | 取根部门后仅 name/status 确有变更时写回 save | ✅ 缺口闭合（G2） | `OrgService.java:142-158`（取根 L144，脏检查 L145-153，save L154-157） |
| 1.5 组织改状态只动顶级、不动子部门 | 同步仅命中 `findByOrgIdAndIsRoot(id,1)` 返回的唯一根部门，无子部门递归 | ✅ 缺口闭合（G3，构造满足） | `OrgService.java:142-158`（只改根，不遍历子） |
| 1.6 每组织仅一根部门、禁手工建根 | 服务层拒建/拒移/拒删 + DB 部分唯一索引（既有） | ✅ 维持达成 | `DeptService.java:105-107,197-199,267-269` |

### 规则组 2（前端：dept-tree-page.tsx）

| 规则 | 现状 | 结论 | 证据 file:line |
|------|------|------|----------------|
| 2.1 箭头收起/展开子部门、默认全折叠 | `expandedIds` 默认 `new Set()`（全折叠）；`renderNodes` 仅当 `expandedIds.has(node.id)` 才递归子树；`flattten` 已移除 | ✅ 缺口闭合（G4） | `dept-tree-page.tsx:53,278,500-502,242-249,295` |
| 2.2 岗位/任职/空缺数默认 0 | 未加载编制时显示 `0`（非 `—`） | ✅ 缺口闭合（G5） | `dept-tree-page.tsx:330,336,348` |
| 2.3 操作列增「查看任职详情」按钮 | 新增 Users 图标按钮，`title="查看任职详情"`，触发 `toggleStaffing(node.id)` | ✅ 缺口闭合（G6） | `dept-tree-page.tsx:55,118,394-405` |
| 2.4 箭头=下钻、取消独立穿透按钮 | `onArrowClick`：`linkedOrgId` 非空→`openPierce`（复用 OrgPierceDrawer），否则→`toggleExpand`；独立「穿透下钻」按钮及 `Network` 导入已移除 | ✅ 缺口闭合（G7） | `dept-tree-page.tsx:236-239,252-261,295,654`；导入 `L3`（无 Network） |

---

## 三、前端静态复核结论（逐条 2.1–2.4）

- **G4（2.1）**：`expandedIds` 默认空集=全部折叠；`renderNodes` 以 `expandedIds.has(node.id)` 作为递归闸门（L500-502），原 `flatten` 全量拍平已移除（仅 L39 注释提及）；箭头 `onClick` 绑定 `onArrowClick`；`toggleExpand` 仅切换集合成员性。逻辑自洽。
- **G5（2.2）**：岗位数 L330、已任职 L336、空缺 L348 三处在 `vo` 为空时均显示 `0`。`code`/`linkedOrg` 列仍在缺失时显示 `—`（合理，非编制数值）。
- **G6（2.3）**：L394-405 操作列新增「查看任职详情」（Users 图标、`title` 一致），`onClick` 调 `toggleStaffing(node.id)`；`staffingIds` 状态 + `toggleStaffing`（L118）懒加载并展开编制面板（L409-495）。编制信息由「箭头」正确迁移到「按钮」。
- **G7（2.4）**：`onArrowClick`（L252-261）按 `node.linkedOrgId` 分流：非空→`openPierce` 复用 `OrgPierceDrawer`（`OrgPierceDrawer` 组件 props `anchorDept/orgs/open/onOpenChange` 与调用 L654 完全匹配，组件零改动）；否则→`toggleExpand`。**全仓 grep 确认**：`openPierce` 仅在 `onArrowClick` 内被调用（L255），无残留独立「穿透下钻」按钮；`dept-tree-page.tsx:3` 的 lucide 导入已不含 `Network`，无悬空导入。TypeScript 编译零未用变量/导入（typecheck 已证实）。

---

## 四、后端静态/契约审查结论（逐条 1.1–1.6，重点 1.3/1.4/1.5）

### 4.1 G1–G3 是否闭合
- **G3（`findByOrgIdAndIsRoot`）**：`SysDeptRepository.java:20` 方法签名 `Optional<SysDept> findByOrgIdAndIsRoot(Long orgId, Integer isRoot)`。实体 `SysDept` 含 `orgId`（L22-23，`@Column(name="org_id")`，getter `getOrgId()`）与 `isRoot`（L46-47，`@Column(name="is_root")`，getter `getIsRoot()`）→ Spring Data 派生查询合法。
- **G2/G3（`OrgService.update`）**：L119 `@Transactional`；L144 经 `deptRepository.findByOrgIdAndIsRoot(id,1)` 取根部门；L145-153 仅当 `name`/`status` 确有差异（`Objects.equals` 守卫）置 dirty；L154-157 dirty 才 `save(root)`。**只改根部门，不递归子部门**（1.5 由构造满足）。`deptRepository` 经构造器注入（L38/L45），位于 `@Transactional` 方法内使用。
- **G1（`DeptService.update`）**：L145 `@Transactional`；L157 判定 `isRoot==1`；L158-165 仅当（nameChanged || statusChanged）时抛 `BusinessException(ResultCode.VALIDATION_ERROR, "根部门名称/状态由所属组织维护...")`；L167-178 非根正常 `setName/setStatus`。**守卫仅在 `isRoot==1` 且请求改 name/status 时拦截，不误伤 `linkedOrgId` 等其它字段**（与改造说明一致）。

### 4.2 编译隐患排查
- 三类所需 import 均齐备：`BusinessException`（OrgService L3 / DeptService L3）、`ResultCode`（L4）、`Objects`（L24）。
- `OrgUpdateRequest.name()/status()` 可为 null，`OrgService.update` 以 `!= null` 先行判空后 `Objects.equals`，无 NPE 风险。
- 派生查询参数顺序 `(Long orgId, Integer isRoot)` 与调用 `findByOrgIdAndIsRoot(id, 1)` 一致；`id` 即 orgId，语义正确。
- **结论：静态/契约审查无编译隐患，G1–G3 全部闭合，1.1/1.2/1.6 维持原达成且未被破坏。**

### 4.3 Maven 环境限制（如实说明，不伪造编译）
- 实测：`mvn -v` 报 `错误: 找不到或无法加载主类 org.codehaus.plexus.classworlds.launcher.Launcher`；Maven 安装目录 `lib/`、`boot/` 下无 jar；属沙箱 Maven 安装损坏，无法编译后端。
- 故后端仅做**静态/契约审查**（行号属实核验 + 类型/导入/派生查询合法性），**未伪造 `mvn compile` 结果**，与此前约定一致。

---

## 五、路由判定与结论

- **源码 Bug**：未发现（前端 typecheck + build 双绿；后端静态审查逻辑与改造说明一致，无编译隐患）。
- **测试/审查问题**：无（无需 QA 自修）。
- **路由判定**：**NoOne**（仅后端受 Maven 环境限制，已如实说明，非源码缺陷）。
- **IS_PASS**：**YES**

> 遗留观察（非阻塞、非源码缺陷）：前端 `openEdit`（L162-172）仍允许对根部门点开编辑表单，实际提交会被后端 G1 守卫拒绝（toast 报错），数据完整性已由服务端保障。若要更严格 UX，可在前端对 `isRoot==1` 节点禁用名称/状态编辑项——属体验增强，不在 G1–G7 交付范围，亦不阻断验收。

---

## 六、一句话总结

前端 typecheck/build 双门禁独立复跑均 0 错误通过，前端 G4–G7 与后端 G1–G3 行号属实、逻辑自洽、契约合法，1.1/1.2/1.6 维持达成，**IS_PASS=YES（仅后端受 Maven 环境限制做静态审查，未伪造编译）**。

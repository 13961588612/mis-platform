# MIS 知识库（mis-kb）交付总结

**日期**：2026-08-03
**需求来源**：`docs/backend/knowledge-base-app-plan.md`（《MIS 知识库 APP 规划 v3》）
**工作流**：标准 SOP（产品经理 → 架构师 → 工程师 → QA）
**交付状态**：代码完成，静态验证通过；**运行时验证未执行**（见第 4 节）

---

## 1. TL;DR

在 mis-platform 新增完整 RAG 知识库能力：新建 `mis-kb` 微服务（端口 8108）、BFF 聚合层、管理后台 7 个页面、ai-platform 侧 RAG 问答链路，含 3 个 Flyway 迁移与三环境 Nacos 配置。

**代码已就绪，但模块从未启动过一次。** 交付前必须完成第 4 节的两项验收。

---

## 2. 交付规模

| 层 | 内容 | 数量 |
|---|---|---|
| `backend/mis-kb` | 新建微服务（`com.mis.kb`，端口 8108） | 92 个生产 Java 文件 |
| `backend/mis-kb` 测试 | `KbVisibilityServiceTest`（纯 Mockito，7 用例） | 1 |
| `backend/mis-admin-bff` | `KbController` / `KbFacadeService` / `KbWebClient` / `dto/kb/` | 4 新增 + 7 修改 |
| `frontend/.../features/kb` | 7 页面 + 4 组件 + api/types/store | 15 |
| `agent/.../mis_rag` | RAG 问答管线 + `kb_client.py` + `retrieve.py` | 4 |
| Flyway 迁移 | V12 建表（9 表）/ V13 种子 / V14 菜单授权 | 3 |
| Nacos 配置 | integration / test / prod | 3 |
| 设计文档 | ADR-018 + 系统设计 + 类图 + 时序图 + 知识库说明 | 5 |

**生产代码与测试代码之比：92 : 1。**

---

## 3. 质量门禁实际状态

| 门禁 | 结果 | 覆盖了什么 |
|---|---|---|
| `mvn test`（22 用例） | ✅ 22/22 全绿 | 能编译 + 未打破既有用例 |
| 前端 `npm run typecheck` | ✅ 通过 | TS 类型一致性 |
| `docker compose --env-file .env.example config -q` | ✅ exit 0 | ragflow 编排语法 |
| **应用真实启动** | ❌ **从未执行** | **JPA 映射 / 派生查询 / DDL 对应关系** |
| **并发行为测试** | ❌ **无覆盖** | `editable_once` 一次修改语义 |

**关键认知**：`mis-kb` 与 `mis-admin-bff` 两个模块**零集成测试**（无任何 `@SpringBootTest` / `@DataJpaTest` / `@WebMvcTest`）。所有派生查询属性名、实体映射与 DDL 的对应关系，**只在 EntityManagerFactory 启动时由 Hibernate 校验**。

因此 `mvn test` 全绿与「模块能真正起来」之间存在实质鸿沟。若实体映射有误，症状是 **mis-kb 启动直接失败**，要到部署阶段才暴露。

---

## 4. 交付前必须执行的验收（P0）

### 4.1 回归确认

```bash
# 需 JDK17
mvn -pl mis-kb,mis-admin-bff -am clean test
```
预期：22/22 绿灯未回归。

### 4.2 启动自检（**比 4.1 更重要**）

```bash
# 先起基础设施
docker compose -f deploy/docker-compose.dev.yml up -d
# 再启动 mis-kb 一次
```

**这是本次交付最有价值的验收手段。** 启动成功即证明全部派生查询、实体映射通过 Hibernate 校验；失败时报错会直接点名是哪个 query 或哪个实体。

---

## 5. 已修复问题（QA 移交 6 项，全部关闭）

| 编号 | 问题 | 修复方式 |
|---|---|---|
| P-01 | ragflow compose 无 `.env` 无法解析 | `env_file` 改 Compose v2.24+ 长语法 `path` + `required: false` |
| P-02 | 引用列表缺 `source` 字段 | 前端类型补 `source: string \| null`，运行时归一 |
| P-03 | 引用长文本溢出 | `min-w-0` + `shrink-0` + `truncate` 三件套 |
| P-04 | RAG 异常时 session 状态不一致 | `session_verified` 状态不变式，双 except 分支归零 |
| P-05 | `editable_once` 并发 TOCTOU | 悲观锁 `findWithLockBySessionId` + `@Lock(PESSIMISTIC_WRITE)` |
| P-06 | 软删口径不明 | 澄清为非缺陷（物理删除与 `status=0` 均被 `findByStatus(ENABLED)` 覆盖），补注释 |

### P-05 修复细节与验证强度

实现为 **Spring Data 派生查询**（非手写 JPQL），全后端 `@Query` 命中数现为 **0**。

四项生效前提已逐条核验：
1. `KbQaService:227` `@Transactional` 非 readOnly — 锁持有至提交 ✅
2. 写路径 `:240` 取锁，只读端点 `:187`/`:264` 保持无锁 — 无读放大 ✅
3. 唯一调用方 `QaController:52` 为外部入口 — 非同类自调用，Spring 代理生效 ✅
4. 并发**首次插入**无行可锁，由 `uk_kb_feedback_session UNIQUE(session_id)`（`V12__kb_schema.sql:135`）在落库层兜底 ✅

**验证强度**：已执行 = 静态自审 + 属性名与实体字段一致性核对。**尚未执行** = 元模型校验（须应用真实启动）、并发行为测试。

---

## 6. 遗留待办

### P1 — 并发行为测试

`editable_once` 并发场景补测，验收条件已钉死：

- **必须跑在真 PostgreSQL**（Testcontainers 或 dev 栈 PG）
- 两线程并发提交「第二次反馈」，断言**恰好一个**拿到 `KB_FEEDBACK_ALREADY`
- **禁止用 H2 替代** —— H2 与 PostgreSQL 的 `FOR UPDATE` 语义不一致，糊出的绿灯比没有测试更危险

### P1 — 集成测试基座

`mis-kb` / `mis-admin-bff` 应引入至少一个 `@SpringBootTest`，把 JPA bootstrap 纳入 CI 门禁。

### P2 — 死代码清理

- `KbQaFeedbackRepository:37` `existsBySessionId` — 全仓零调用点
- `KbQaFeedbackRepository:39` `findAll()` — 与 `JpaRepository` 自带方法重复声明

---

## 7. 配套文档

| 文档 | 路径 |
|---|---|
| QA 验证报告（含 5 轮修订记录） | `deliverables/software-company/kb-qa-report-2026-08-03.md` |
| 架构决策记录 | `docs/adr/ADR-018-knowledge-base-mis-kb.md` |
| 系统设计 | `docs/backend/mis-kb-system-design.md` |
| 类图 / 时序图 | `docs/backend/mis-kb-{class,sequence}-diagram.mmd` |
| 知识库说明 | `docs/backend/knowledge-base.md` |

---

## 8. 过程记录：一个值得留存的教训

本次交付中，「**把尚待执行的验证写成已执行的验证**」这一错误，在工程师、主理人、QA 三方各出现一次，并沿协作链条传递了一整圈：

1. 工程师写「`mvn test` 启动期元模型校验」—— 而 `mvn test` 根本不 bootstrap JPA
2. 主理人在更正指令中写「验证方式为静态自审 + 启动期元模型校验」—— 自己也踩
3. QA 忠实落盘 —— 导致报告第 143 行称「已做启动期校验」、第 186 行称「只有真实启动才能证明」，隔 43 行自相矛盾

**根因**：中文里「应该做的验证」与「已经做的验证」只差一个时态，用顿号并列时几乎无感；但对读者而言，差别是「这块有保障」与「这块完全裸奔」。

**已确立规则**：已执行的验证与尚待执行的验证，**必须断句分开陈述，禁止顿号并列**。

QA 报告的「七、修订记录」完整保留了 5 轮更正的原表述、更正内容与更正原因，可追溯。

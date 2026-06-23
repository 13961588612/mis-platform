# ADR-015: 持久层采用 Spring Data JPA（替代 MyBatis-Plus）

## 状态
已接受

## 日期
2026-06-23

## 背景

原规划使用 **MyBatis-Plus 3.5.5** 作为 ORM，通过 `DataScopeInterceptor` 注入数据权限 SQL。

团队决策改为 **Spring Data JPA + Hibernate 6**（Spring Boot 3.2 默认），以便：

- 与 Spring Boot 生态一致（Repository、审计、事务）
- 实体与表结构映射更直观，减少 XML / 注解 SQL 维护
- 复杂查询可用 `Specification`、JPQL、`@Query`

Schema 仍由 **Flyway** 管理（ADR-001 不变）；JPA 不负责 DDL。

## 决策

1. **ORM**：`spring-boot-starter-data-jpa`（Hibernate 6 + HikariCP）
2. **公共模块**：`mis-common-jpa`（替代原 `mis-common-mybatis`）
3. **Repository**：各领域服务 `repository` 包，继承 `JpaRepository` / `JpaSpecificationExecutor`
4. **分页**：Spring `Pageable` → 转换为 `PageResult`（`mis-common-core`）
5. **审计字段**：`@EnableJpaAuditing` + `AuditingEntityListener`（`createdAt` / `updatedBy` 等）
6. **数据权限**：`@DataScope` + `DataScopeSpecification` 动态拼接 `Specification`（领域服务层），**不用** MyBatis 拦截器
7. **软删**：实体 `deleted` 字段 + `@SQLRestriction("deleted = 0")`（Hibernate 6）或查询显式条件
8. **PostgreSQL ENUM**：Hibernate 6 `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` 映射 `sys_perm_type` 等

**不采用**：MyBatis-Plus、JPA `ddl-auto=update`（生产禁止，仅 Flyway 改表）。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. Spring Data JPA（选定） | Boot 原生、实体驱动 | 复杂 SQL / 批量需技巧 |
| B. MyBatis-Plus（原方案） | SQL 可控、拦截器成熟 | 与 Boot 实体模型两套范式 |
| C. jOOQ | 类型安全 SQL | 学习成本、需 codegen |

## 后果

### 正面
- 减少一套 ORM 依赖与配置
- 实体类可直接对齐 `schema-design.md` 表结构
- 测试可用 `@DataJpaTest`

### 负面
- 数据权限从 SQL 片段改为 `Specification`，需统一工具类
- 极复杂报表类 SQL 可能仍需 `@Query(nativeQuery=true)` 或后期引入 jOOQ

## 关联

- 替代文档中对 `mis-common-mybatis` / `DataScopeInterceptor` 的描述
- [common-modules.md](../backend/common-modules.md) §5
- [03-security.md](../architecture/03-security.md) §6.2

# T01 工程骨架规格锁定 — recon-service

| 项 | 值 |
|----|----|
| 文档状态 | 已锁定（T01 执行依据） |
| 负责人 | 架构师 高见远 |
| 日期 | 2026-08-13 |
| 适用阶段 | T01 工程骨架（不写业务代码，只落地可编译可启动的工程底座） |
| 物理位置 | `D:\work\mis-platform\recon\`（与 `backend/` 平级，共享 git，独立 Maven 工程 / 独立 jar / 独立 Flyway / 独立部署） |
| 包名 | `com.mis.recon` |

关联文档：
- MIS 父工程版本管理：`backend/pom.xml`（spring-boot 3.2.5 / spring-cloud 2023.0.1 / spring-cloud-alibaba 2023.0.1.0 / flyway 10.14.0 / postgresql 42.7.3）
- 配置管理策略：`docs/devops/configuration.md`（方案 B：bootstrap + application 两文件制、Nacos 约定）
- 持久层决策：`docs/adr/ADR-015-jpa-over-mybatis.md`（JPA 取代 MyBatis；recon 沿用）
- Nacos bootstrap 模板：`deploy/nacos-config/bootstrap-template.yml`

---

## 1. 目标与范围

### 1.1 T01 要做什么

1. 建立 `recon` 独立 Maven 工程（父 POM + `recon-service` 模块），版本与 MIS 父工程完全对齐。
2. 锁定 `recon-service` 的完整依赖清单（§3）。
3. 锁定 6 个 config 类（§4）：JpaConfig、JdbcTemplateConfig、QuartzConfig、JacksonConfig、WebConfig、AsyncConfig（NacosConfig 为说明项，无 Java 类）。
4. 锁定 3 个配置文件骨架（§5）：`bootstrap.yml` / `application.yml` / `application-dev.yml`。
5. 给出 T01 验收标准与本地验证命令序列（§6）。

### 1.2 本次不做（out-of-scope）

- 不写任何业务代码、业务表、业务 API；不产出 `openapi.yaml`（无业务端点，T02 引入业务端点时再出契约）。
- 不引入 `mis-common-core / mis-common-web / mis-common-security`；当前按不引入独立实现 `ApiResponse` / `PageResult` 设计，仅在工程目录预留 `common` 包空间（见 §2）。
- 不配置源库（MySQL）数据源：`mysql-connector-j` 仅保留依赖（runtime），源库连接与对账引擎热路径在 T02 落地。
- 不建 Quartz `QRTZ_` 表（T02 提供 `V1__init.sql` 时一并建）；T01 调度开关默认关闭（见 §5.4）。
- 不新增 ADR：JPA 决策复用 ADR-015；如后续要对「recon 独立工程 / 单数据源」补 ADR，另行发起，不在 T01 范围内。

### 1.3 技术栈（已拍板，不可更改）

Java 17 + Spring Boot 3.2.5 + Spring Cloud 2023.0.1 + Spring Cloud Alibaba 2023.0.1.0 + Flyway 10.14.0 + PostgreSQL 42.7.3（独立 database `recon`）+ Spring Data JPA（配置/查询）+ JdbcTemplate（引擎热路径/源库）+ Quartz JDBC JobStore + Nacos 注册。

---

## 2. 工程结构与目录布局（点名文件）

```
recon/
├── pom.xml                                  # recon-parent（packaging=pom）
├── .gitignore                               # 参照 backend/.gitignore（target/、.idea/、本地 env 等）
├── docs/
│   └── T01-spec.md                          # 本文档
└── recon-service/
    ├── pom.xml                              # packaging=jar；parent=recon-parent
    └── src/
        ├── main/java/com/mis/recon/
        │   ├── ReconApplication.java        # @SpringBootApplication，入口只装配（不写业务）
        │   └── config/
        │       ├── JpaConfig.java           # @EnableJpaRepositories + @EntityScan + @EnableJpaAuditing
        │       ├── JdbcTemplateConfig.java  # JdbcTemplate + PlatformTransactionManager（单数据源）
        │       ├── QuartzConfig.java        # SchedulerFactoryBean + JobFactory（受调度开关控制）
        │       ├── JacksonConfig.java       # 时间格式 + Long→String + JavaTimeModule
        │       ├── WebConfig.java           # CORS（WebMvcConfigurer）
        │       └── AsyncConfig.java         # @EnableAsync + ThreadPoolTaskExecutor
        ├── main/resources/
        │   ├── bootstrap.yml                # 仅应用名 + Nacos（照抄模板）
        │   ├── application.yml              # local 完整可跑画像
        │   ├── application-dev.yml          # dev profile 覆盖（可选，见 §7-4）
        │   └── db/migration/.gitkeep        # T02 放 V1__init.sql（含 QRTZ_ 表）
        └── test/java/com/mis/recon/
            └── ReconApplicationTests.java   # @SpringBootTest 冒烟（需本地 PG，T01 不 gate）
```

分层依赖铁律（沿用 `code-organization` 规范）：controller → service → repository / mapper；依赖只向下；入口文件只装配；单文件 ≤ 300 行。T01 只落地 config 与入口，业务分层在 T02 起执行。

---

## 3. pom.xml 依赖清单（版本精确锁定）

### 3.1 父 POM 采用方式

`recon-parent` 以 **`spring-boot-starter-parent:3.2.5` 为 parent**（获得 Boot BOM 依赖管理与插件管理），并在 `dependencyManagement` 中 **import 两个 BOM**：

1. `org.springframework.cloud:spring-cloud-dependencies:2023.0.1`（scope=import）
2. `com.alibaba.cloud:spring-cloud-alibaba-dependencies:2023.0.1.0`（scope=import）

import 顺序：Spring Cloud 在前、Spring Cloud Alibaba 在后（SCA 依赖覆盖 SC 同名 artifact，官方约定）。

非 BOM 管不到的、或需覆盖 Boot BOM 的版本，一律在 `recon-parent` 的 `dependencyManagement` 显式管理：

| 坐标 | 版本 | 为什么显式 |
|------|------|-----------|
| `org.flywaydb:flyway-core` | 10.14.0 | Boot 3.2.5 BOM 管理的是 10.10.0，MIS 约定提升到 10.14.0，必须显式覆盖 |
| `org.flywaydb:flyway-database-postgresql` | 10.14.0 | Flyway 10 起 PG 支持模块化（已知坑 §8-1）；必须与 flyway-core 同版本显式管理 |
| `org.postgresql:postgresql` | 42.7.3 | Boot 3.2.5 BOM 恰好管理 42.7.3，与 MIS 对齐；显式声明便于追踪，不依赖 BOM 巧合 |

Boot BOM 内已管理、无需写版本的：`spring-boot-starter-*` 全家、`mysql-connector-j`（8.3.0）、`lombok`（1.18.32）、`spring-boot-configuration-processor`。Spring Cloud / SCA BOM 已管理：`spring-cloud-starter-bootstrap`、`spring-cloud-starter-alibaba-nacos-config`、`spring-cloud-starter-alibaba-nacos-discovery`、`spring-cloud-starter-loadbalancer`。

### 3.2 recon-parent（`recon/pom.xml`）完整参考

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.5</version>
        <relativePath/>
    </parent>

    <groupId>com.mis</groupId>
    <artifactId>recon-parent</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <packaging>pom</packaging>
    <name>recon-parent</name>
    <description>对账平台独立父工程（与 backend/ 平级，共享 git，独立部署）</description>

    <modules>
        <module>recon-service</module>
    </modules>

    <properties>
        <java.version>17</java.version>
        <maven.compiler.release>17</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <spring-cloud.version>2023.0.1</spring-cloud.version>
        <spring-cloud-alibaba.version>2023.0.1.0</spring-cloud-alibaba.version>
        <flyway.version>10.14.0</flyway.version>
        <postgresql.version>42.7.3</postgresql.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework.cloud</groupId>
                <artifactId>spring-cloud-dependencies</artifactId>
                <version>${spring-cloud.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <dependency>
                <groupId>com.alibaba.cloud</groupId>
                <artifactId>spring-cloud-alibaba-dependencies</artifactId>
                <version>${spring-cloud-alibaba.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <!-- 覆盖 Boot BOM：Flyway 提升到 MIS 约定 10.14.0；PG 支持模块同版本 -->
            <dependency>
                <groupId>org.flywaydb</groupId>
                <artifactId>flyway-core</artifactId>
                <version>${flyway.version}</version>
            </dependency>
            <dependency>
                <groupId>org.flywaydb</groupId>
                <artifactId>flyway-database-postgresql</artifactId>
                <version>${flyway.version}</version>
            </dependency>
            <!-- 与 Boot 3.2.5 BOM 恰好一致（42.7.3），显式声明便于追踪 -->
            <dependency>
                <groupId>org.postgresql</groupId>
                <artifactId>postgresql</artifactId>
                <version>${postgresql.version}</version>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-compiler-plugin</artifactId>
                    <version>3.13.0</version>
                    <configuration>
                        <release>${java.version}</release>
                        <parameters>true</parameters>
                    </configuration>
                </plugin>
                <plugin>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-maven-plugin</artifactId>
                </plugin>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-surefire-plugin</artifactId>
                    <configuration>
                        <!-- Windows 下修复 "'other' has different root"（与 MIS 父工程一致） -->
                        <argLine>-Djdk.net.URLClassPath.disableClassPathURLCheck=true</argLine>
                    </configuration>
                </plugin>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-enforcer-plugin</artifactId>
                    <version>3.5.0</version>
                </plugin>
                <plugin>
                    <groupId>org.flywaydb</groupId>
                    <artifactId>flyway-maven-plugin</artifactId>
                    <version>${flyway.version}</version>
                </plugin>
            </plugins>
        </pluginManagement>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-enforcer-plugin</artifactId>
                <executions>
                    <execution>
                        <id>enforce-build-environment</id>
                        <goals><goal>enforce</goal></goals>
                        <phase>validate</phase>
                        <configuration>
                            <rules>
                                <requireMavenVersion><version>[3.9,)</version></requireMavenVersion>
                                <requireJavaVersion><version>[17,)</version></requireJavaVersion>
                            </rules>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>
```

### 3.3 recon-service（`recon/recon-service/pom.xml`）依赖清单

| # | groupId | artifactId | version | scope | 说明 |
|---|---------|------------|---------|-------|------|
| 1 | org.springframework.boot | spring-boot-starter-web | —（Boot BOM 3.2.5） | compile | Web 入口（REST + actuator） |
| 2 | org.springframework.boot | spring-boot-starter-validation | — | compile | 参数校验（保留） |
| 3 | org.springframework.boot | spring-boot-starter-mail | — | compile | 对账结果邮件通知（保留，占位） |
| 4 | org.springframework.boot | spring-boot-starter-actuator | — | compile | health / 监控（保留） |
| 5 | org.springframework.boot | spring-boot-starter-data-jpa | — | compile | JPA：平台库配置/查询（新增） |
| 6 | org.springframework.boot | spring-boot-starter-jdbc | — | compile | JdbcTemplate：引擎热路径/源库（新增） |
| 7 | org.springframework.boot | spring-boot-starter-quartz | — | compile | Quartz 调度（保留，JDBC JobStore） |
| 8 | org.springframework.cloud | spring-cloud-starter-bootstrap | —（SC BOM 2023.0.1） | compile | 启用 bootstrap.yml（新增） |
| 9 | com.alibaba.cloud | spring-cloud-starter-alibaba-nacos-config | —（SCA BOM 2023.0.1.0） | compile | Nacos 配置中心（新增） |
| 10 | com.alibaba.cloud | spring-cloud-starter-alibaba-nacos-discovery | —（SCA BOM 2023.0.1.0） | compile | Nacos 注册发现（新增） |
| 11 | org.springframework.cloud | spring-cloud-starter-loadbalancer | —（SC BOM 2023.0.1） | compile | 服务调用负载均衡（新增，预留） |
| 12 | org.postgresql | postgresql | 42.7.3（recon-parent 显式） | runtime | 平台库驱动（recon database） |
| 13 | com.mysql | mysql-connector-j | —（Boot BOM 8.3.0） | runtime | 源库驱动（MySQL 对账源，T02 启用连接） |
| 14 | org.flywaydb | flyway-core | 10.14.0（recon-parent 显式） | compile | 迁移引擎 |
| 15 | org.flywaydb | flyway-database-postgresql | 10.14.0（recon-parent 显式） | runtime | Flyway 10 PG 支持模块（必装，见 §8-1） |
| 16 | org.projectlombok | lombok | —（Boot BOM 1.18.32） | optional | 编译期代码生成（保留） |
| 17 | org.springframework.boot | spring-boot-configuration-processor | —（Boot BOM） | optional | 配置类元数据生成（可选） |
| 18 | org.springframework.boot | spring-boot-starter-test | —（Boot BOM） | test | 测试（保留） |

依赖调整对照（§2.8 依赖清单）：

| 调整 | 坐标 | 说明 |
|------|------|------|
| 移除 | mybatis-spring-boot-starter 3.0.3 | JPA 取代 MyBatis（ADR-015） |
| 移除 | pagehelper-spring-boot-starter 2.1.0 | JPA `Pageable` 分页取代 PageHelper |
| 移除 | ojdbc11（平台库用途） | 平台库改 PostgreSQL，不再需要 Oracle 驱动 |
| 新增 | spring-boot-starter-data-jpa / jdbc / postgresql | 见上表 5/6/12 |
| 新增 | spring-cloud-starter-bootstrap / nacos-config / nacos-discovery / loadbalancer | 见上表 8/9/10/11 |
| 保留 | spring-boot-starter-web / validation / mail / actuator、mysql-connector-j、lombok、spring-boot-starter-test | 见上表 |

完整 `recon-service/pom.xml` 参考：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.mis</groupId>
        <artifactId>recon-parent</artifactId>
        <version>0.1.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>

    <artifactId>recon-service</artifactId>
    <packaging>jar</packaging>
    <name>recon-service</name>
    <description>对账平台核心服务（JPA 配置/查询 + JdbcTemplate 引擎热路径 + Quartz 调度 + Nacos）</description>

    <dependencies>
        <!-- Web / 校验 / 通知 / 监控（保留） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-mail</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>

        <!-- 数据访问：JPA（配置/查询）+ JDBC（引擎热路径/源库）（新增） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-jdbc</artifactId>
        </dependency>

        <!-- 调度：Quartz JDBC JobStore（保留） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-quartz</artifactId>
        </dependency>

        <!-- 云原生：bootstrap + Nacos 配置/注册 + LoadBalancer（新增） -->
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-starter-bootstrap</artifactId>
        </dependency>
        <dependency>
            <groupId>com.alibaba.cloud</groupId>
            <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
        </dependency>
        <dependency>
            <groupId>com.alibaba.cloud</groupId>
            <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-starter-loadbalancer</artifactId>
        </dependency>

        <!-- 数据库驱动 -->
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>com.mysql</groupId>
            <artifactId>mysql-connector-j</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- Flyway：MIS 约定 10.14.0；PG 支持模块必装（Flyway 10 模块化） -->
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-core</artifactId>
        </dependency>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-database-postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- Lombok / 配置元数据 -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-configuration-processor</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- 测试 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

### 3.4 版本对齐表（MIS 父工程 ↔ recon）

| 依赖/插件 | MIS 父工程（backend/pom.xml） | recon-parent | 说明 |
|-----------|-------------------------------|--------------|------|
| spring-boot | 3.2.5（属性） | parent=spring-boot-starter-parent 3.2.5 | 一致 |
| spring-cloud | 2023.0.1（属性） | spring-cloud-dependencies 2023.0.1 | 一致 |
| spring-cloud-alibaba | 2023.0.1.0（属性） | spring-cloud-alibaba-dependencies 2023.0.1.0 | 一致 |
| flyway | 10.14.0（属性） | flyway-core / flyway-database-postgresql 10.14.0 | 一致（Boot BOM 10.10.0 被覆盖） |
| postgresql | 42.7.3（属性） | postgresql 42.7.3 | 一致（Boot BOM 同版本） |
| maven-compiler-plugin | 3.13.0 | 3.13.0 | 一致 |
| maven-enforcer-plugin | 3.5.0 | 3.5.0 | 一致 |

---

## 4. config 类清单（点名接口）

全部位于 `com.mis.recon.config` 包。以下为关键注解与 Bean 方法签名（T01 执行依据，实现细节不得偏离）。

### 4.1 JpaConfig

```java
@Configuration
@EnableJpaRepositories(basePackages = "com.mis.recon.repository")
@EntityScan(basePackages = "com.mis.recon.entity")
@EnableJpaAuditing
public class JpaConfig {
    // 说明：
    // 1) ddl-auto=none 由 application.yml 的 spring.jpa.hibernate.ddl-auto 控制（改表只走 Flyway，ADR-015）。
    // 2) 事务管理器不在此声明——单数据源场景统一在 JdbcTemplateConfig 声明（§4.2），避免双 TransactionManager 歧义。
    // 3) 审计字段（createdAt/updatedAt）由 @EnableJpaAuditing + AuditingEntityListener 提供。
}
```

### 4.2 JdbcTemplateConfig

```java
@Configuration
public class JdbcTemplateConfig {

    // 平台库 JdbcTemplate（引擎热路径 / 源库直读走它；JPA 走实体查询）
    @Bean
    public JdbcTemplate reconJdbcTemplate(DataSource dataSource) {
        JdbcTemplate template = new JdbcTemplate(dataSource);
        template.setQueryTimeout(30);   // 引擎 SQL 超时（秒），可改配置
        template.setFetchSize(1000);    // 批量拉取防 OOM
        return template;
    }

    // 单数据源（recon 库）事务管理器：JPA 与 JdbcTemplate 共用同一事务。
    // 声明后 Boot 自动配置的 JpaTransactionManager 退避（@ConditionalOnMissingBean 语义）。
    @Bean
    @Primary
    public PlatformTransactionManager transactionManager(EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
```

> 单数据源下 JdbcTemplate 与 JPA 天然同事务：JpaTransactionManager 会把连接绑定到线程（TransactionSynchronizationManager），`reconJdbcTemplate` 使用同一 DataSource 时自动加入 JPA 事务。源库（MySQL）只读连接在 T02 引入时须另建独立 DataSource + 独立 JdbcTemplate（`@Qualifier("sourceDataSource")`），且只读不参与强一致事务（见 §7-6）。

### 4.3 QuartzConfig

> **实现修正（2026-08-13，T01 落地验证）**：原稿的 `AutowireCapableBeanJobFactory` 在 Spring 6.1.6（Boot 3.2.5 依赖，已验证 spring-context-support-6.1.6.jar）中**不存在**，为幻觉 API。改为等价实现：`SpringBeanJobFactory` + `setApplicationContext`（Job 可注入 Spring Bean）；同时不重复声明 `SchedulerFactoryBean` bean，改用 `SchedulerFactoryBeanCustomizer` 覆盖开关项——Boot 的 `QuartzAutoConfiguration` 继续按 `spring.quartz.*`（yml）装配，JobStore 参数保持 yml 驱动，符合下方职责边界硬约束。

```java
@Configuration
@ConditionalOnProperty(name = "mis.recon.scheduler.enabled",
                       havingValue = "true", matchIfMissing = false)
public class QuartzConfig {

    // Job 实例可注入 Spring Bean（Spring 6.1 的 SpringBeanJobFactory + setApplicationContext）
    @Bean
    public JobFactory quartzJobFactory(ApplicationContext applicationContext) {
        SpringBeanJobFactory factory = new SpringBeanJobFactory();
        factory.setApplicationContext(applicationContext);
        return factory;
    }

    // 不重复声明 SchedulerFactoryBean：Boot QuartzAutoConfiguration 按 spring.quartz.* 装配，
    // 仅通过 Customizer 覆盖规格要求的开关项，保证 yml 驱动的 JobStore 配置生效
    @Bean
    public SchedulerFactoryBeanCustomizer reconQuartzCustomizer(JobFactory quartzJobFactory) {
        return factory -> {
            factory.setJobFactory(quartzJobFactory);            // Job 可注入 Spring Bean
            factory.setOverwriteExistingJobs(true);
            factory.setSchedulerName("reconScheduler");
            factory.setWaitForJobsToCompleteOnShutdown(true);   // 优雅停机
            // autoStartup 不在此覆盖：由 spring.quartz.auto-startup（yml）控制，随调度开关联动
        };
    }
}
```

职责边界：
- **`org.quartz.jobStore.class=org.springframework.scheduling.quartz.LocalDataSourceJobStore`** 等 JobStore 参数放在 `application.yml`（`spring.quartz.properties.org.quartz.*`），**不写在 Java 代码里**（保持配置可调）。
- `spring.quartz.jdbc.initialize-schema=never`：QRTZ_ 表由 Flyway 建（T02 的 `V1__init.sql`），Quartz 绝不自动建表。
- 调度开关 `mis.recon.scheduler.enabled` 默认 `false`（T01 阶段无 QRTZ_ 表，避免启动即失败）；T02 建表后置 `true`。

### 4.4 NacosConfig（说明项，无 Java 类）

Nacos 集成**不需要** Java `@Configuration`：配置中心 + 注册发现全部由 `bootstrap.yml` + 两个 starter（nacos-config / nacos-discovery）驱动，Spring Cloud Alibaba 自动装配完成。

- T01 不新增 NacosConfig.java。
- 预留：当需要自定义 `mis.recon.*` 热刷新（Nacos 改值即时生效）时，对配置类加 `@RefreshScope` 或 `@ConfigurationProperties(prefix="mis.recon")` + `@NacosValue`，届时再补。
- 前提依赖：`spring-cloud-starter-bootstrap` 必须在 pom 中（已含，§3.3-8），否则 `bootstrap.yml` 不生效。

### 4.5 JacksonConfig

```java
@Configuration
public class JacksonConfig {

    private static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter DATE     = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter TIME     = DateTimeFormatter.ofPattern("HH:mm:ss");

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> {
            // 1) Long/long → String：防前端 JS 精度丢失（ID 等）
            builder.serializerByType(Long.class, ToStringSerializer.instance);
            builder.serializerByType(Long.TYPE, ToStringSerializer.instance);

            // 2) java.time 序列化格式（spring.jackson.date-format 只对 java.util.Date 生效，见 §8-3）
            JavaTimeModule module = new JavaTimeModule();
            module.addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(DATETIME));
            module.addSerializer(LocalDate.class, new LocalDateSerializer(DATE));
            module.addSerializer(LocalTime.class, new LocalTimeSerializer(TIME));
            module.addDeserializer(LocalDateTime.class, new LocalDateTimeDeserializer(DATETIME));
            module.addDeserializer(LocalDate.class, new LocalDateDeserializer(DATE));
            module.addDeserializer(LocalTime.class, new LocalTimeDeserializer(TIME));
            builder.modules(module);

            // 3) 时区与时间戳开关
            builder.timeZone(TimeZone.getTimeZone("Asia/Shanghai"));
            builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        };
    }
}
```

> 全局 Long→String 会波及所有 Long 字段（含统计数值）；个别需要返回数值的字段用 `@JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.NumberSerializer.class)` 反控（见 §8-4）。

### 4.6 WebConfig

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {

    // 允许来源从配置读取（默认本地前端联调源），T01 只做 CORS
    @Value("${mis.recon.cors.allowed-origins:http://localhost:5173,http://localhost:8081}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
    // 认证：已由 SecurityConfig 注册 JwtAuthFilter（OncePerRequestFilter，com.mis.recon.security）
    //       RS256 公钥验签，/internal/* 全量鉴权 + /actuator/health 白名单，默认关闭（mis.recon.security.enabled）；
    // 审计：仍预留（T02+，addInterceptors）
}
```

> CORS 主要为开发期前端直连；生产流量走 Gateway/BFF 同源，`allowed-origins` 收紧或留空即关闭。

### 4.7 AsyncConfig

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    // 异步线程池：非关键路径（邮件/Webhook 通知等）用 @Async("reconTaskExecutor")
    @Bean("reconTaskExecutor")
    public ThreadPoolTaskExecutor reconTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);        // 可读 mis.recon.async.core-pool-size
        executor.setMaxPoolSize(16);        // 可读 mis.recon.async.max-pool-size
        executor.setQueueCapacity(200);     // 可读 mis.recon.async.queue-capacity
        executor.setThreadNamePrefix("recon-async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy()); // 拒绝即调用线程执行，不丢任务
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }
}
```

> 引擎热路径（对账比对）**不用**此线程池——同步走 `reconJdbcTemplate`；Quartz 任务用 Quartz 自己的线程池（`spring.quartz.properties.org.quartz.threadPool.*`）。两个线程池职责分离，不得混用。

---

## 5. 配置文件骨架

### 5.1 bootstrap.yml（照抄模板，仅改应用名）

```yaml
# 复制自 deploy/nacos-config/bootstrap-template.yml，仅改 spring.application.name
# 职责：应用名 + 是否连 Nacos + Nacos 地址/命名空间/Group；不写业务配置
spring:
  application:
    name: recon-service
  cloud:
    nacos:
      config:
        enabled: ${MIS_REMOTE:true}
        server-addr: ${NACOS_SERVER:10.254.16.6:8848}
        namespace: ${NACOS_NAMESPACE:dev}
        group: ${NACOS_CONFIG_GROUP:MIS_GROUP}
        file-extension: yaml
        shared-configs:
          - data-id: mis-common
            group: ${NACOS_CONFIG_GROUP:MIS_GROUP}
            refresh: true
        extension-configs:
          - data-id: ${spring.application.name}
            group: ${NACOS_CONFIG_GROUP:MIS_GROUP}
            refresh: true
      discovery:
        enabled: ${MIS_REMOTE:true}
        server-addr: ${NACOS_SERVER:10.254.16.6:8848}
        namespace: ${NACOS_NAMESPACE:dev}
```

配置加载顺序（优先级从低到高）：`mis-common`（共享，先加载）→ `recon-service`（本服务，后加载，同名键覆盖）→ 本机 `application.yml`（未迁入键兜底）。`recon-service` Data ID 在 Nacos 侧的 Group 与 MIS 一致（`MIS_GROUP`），namespace 待确认（§7-2）。

### 5.2 application.yml（local 完整可跑画像）

```yaml
server:
  port: 8110

spring:
  application:
    name: recon-service

  # ---------- 平台库（recon database，HikariCP）----------
  datasource:
    driver-class-name: org.postgresql.Driver
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:recon}
    username: ${DB_USER:recon}
    password: ${DB_PASSWORD:recon123}
    hikari:
      pool-name: reconHikariPool
      minimum-idle: 2
      maximum-pool-size: 10
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000
      connection-test-query: SELECT 1

  # ---------- JPA（平台库配置/查询；ddl 一律 none，改表只走 Flyway）----------
  jpa:
    open-in-view: false
    hibernate:
      ddl-auto: none
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        jdbc:
          time_zone: Asia/Shanghai

  # ---------- Flyway（平台库迁移；schema 由 recon 库 owner 拥有）----------
  flyway:
    enabled: true
    locations: classpath:db/migration
    default-schema: public
    baseline-on-migrate: false
    validate-on-migrate: true

  # ---------- Quartz（JDBC JobStore，QRTZ_ 表由 Flyway 建，绝不自动初始化）----------
  quartz:
    job-store-type: jdbc
    jdbc:
      initialize-schema: never
    auto-startup: ${mis.recon.scheduler.enabled}
    properties:
      org.quartz.scheduler.instanceName: reconScheduler
      org.quartz.scheduler.instanceId: AUTO
      org.quartz.jobStore.class: org.springframework.scheduling.quartz.LocalDataSourceJobStore
      org.quartz.jobStore.driverDelegateClass: org.quartz.impl.jdbcjobstore.PostgreSQLDelegate
      org.quartz.jobStore.tablePrefix: QRTZ_
      org.quartz.jobStore.isClustered: false
      org.quartz.threadPool.class: org.quartz.simpl.SimpleThreadPool
      org.quartz.threadPool.threadCount: 5
      org.quartz.threadPool.threadPriority: 5

  # ---------- 邮件（保留 starter，占位；未配置时发送方降级为日志）----------
  mail:
    host: ${MAIL_HOST:}
    port: ${MAIL_PORT:465}
    username: ${MAIL_USERNAME:}
    password: ${MAIL_PASSWORD:}
    properties:
      mail.smtp.auth: true
      mail.smtp.ssl.enable: true

  cloud:
    loadbalancer:
      enabled: true

# ---------- 业务开关与占位（密钥只写 ${ENV}，不写真实值）----------
mis:
  recon:
    scheduler:
      # 调度总开关：默认 false（T01 无 QRTZ_ 表）；T02 建表后置 true
      enabled: ${RECON_SCHEDULER_ENABLED:false}
    notify:
      mail:
        to: ${RECON_NOTIFY_MAIL_TO:}
      webhook:
        url: ${RECON_NOTIFY_WEBHOOK_URL:}
    async:
      core-pool-size: 4
      max-pool-size: 16
      queue-capacity: 200
    cors:
      allowed-origins: ${RECON_CORS_ALLOWED_ORIGINS:http://localhost:5173,http://localhost:8081}

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      show-details: always

logging:
  level:
    com.mis.recon: INFO
    org.springframework.scheduling.quartz: INFO
```

> 数据库连接参数全部占位（`${DB_HOST:localhost}` 等），不硬编码生产密码；本机默认口令仅限 local 开发（与 MIS 约定一致）。

### 5.3 application-dev.yml（dev profile 覆盖）

```yaml
# 激活：SPRING_PROFILES_ACTIVE=dev 或 --spring.profiles.active=dev
# 注意：与 MIS 配置方案 B（只保留 bootstrap+application）存在差异，见 §7-4
spring:
  datasource:
    hikari:
      maximum-pool-size: 5
      minimum-idle: 1
  jpa:
    show-sql: true
    properties:
      hibernate:
        format_sql: true
  quartz:
    properties:
      org.quartz.threadPool.threadCount: 3

logging:
  level:
    com.mis.recon: DEBUG
    org.hibernate.SQL: DEBUG

management:
  endpoint:
    health:
      show-details: always
```

### 5.4 调度开关与 T01 启动行为约定

- `mis.recon.scheduler.enabled` 默认 `false`：QuartzConfig 不加载（`@ConditionalOnProperty`），Boot 兜底 SchedulerFactoryBean 存在但 `auto-startup=false` → T01 无 QRTZ_ 表也能正常启动，`/actuator/health` 保持 UP。
- T02：`V1__init.sql` 建 QRTZ_ 表（含 `QRTZ_LOCKS` 等全部官方 PG 脚本），`RECON_SCHEDULER_ENABLED=true` 后调度器自动启动。

---

## 6. 验收标准（对照技术适配 §四 T01）

| # | 验收项 | 通过标准 |
|---|--------|----------|
| A1 | `mvn compile` | `BUILD SUCCESS`，exit 0，无编译错误 |
| A2 | HikariCP 建池连 PG recon 库 | 启动日志出现 `HikariPool-1 - Start completed`；无连接失败 |
| A3 | Flyway 接线正常 | 启动日志出现 `Schema "public" is up to date. No migration necessary.`（空目录）或 `Successfully applied` |
| A4 | `/actuator/health` UP | `curl http://localhost:8110/actuator/health` 返回 `{"status":"UP", ...}` 且 `db` 组件 `UP` |
| A5 | Nacos 注册成功 | Nacos 服务列表出现 `recon-service`（实例 UP）或 OpenAPI 查询命中 |

### 6.1 前置：本地 PostgreSQL 准备 recon 库

```sql
CREATE DATABASE recon;
CREATE USER recon WITH PASSWORD 'recon123';
ALTER DATABASE recon OWNER TO recon;
-- PG 15+ 的 public schema 默认不再对普通用户授权，Flyway 建表会失败，必须显式授权（见 §8-2）
GRANT ALL ON SCHEMA public TO recon;
```

### 6.2 本地验证命令序列（PowerShell）

```powershell
# 0) 前置检查
java -version          # 须 17+
mvn -version           # 须 3.9+（与 MIS 父工程 enforcer 一致）

# 1) 编译（A1）
cd D:\work\mis-platform\recon
mvn -q clean compile
# 通过标准：BUILD SUCCESS，exit 0

# 2) 本地启动，不连 Nacos（A2 / A3 / A4）
$env:MIS_REMOTE = "false"
mvn -pl recon-service spring-boot:run
# 通过标准（日志）：
#   HikariPool-1 - Start completed
#   Flyway ... Schema "public" is up to date. No migration necessary.
#   Tomcat started on port 8110

# 3) health 验证（另开终端，A4）
curl.exe http://localhost:8110/actuator/health
# 通过标准：{"status":"UP","components":{"db":{"status":"UP",...}}}

# 4) Nacos 注册验证（A5，需 Nacos 可达 + recon-service Data ID 已推送）
$env:MIS_REMOTE = "true"
$env:NACOS_SERVER = "10.254.16.6:8848"
$env:NACOS_NAMESPACE = "dev"
mvn -pl recon-service spring-boot:run
# 通过标准：
#   Nacos 控制台「服务列表」出现 recon-service，实例状态 UP
#   或 OpenAPI 命中：
curl.exe "http://10.254.16.6:8848/nacos/v1/ns/instance/list?serviceName=recon-service&groupName=MIS_GROUP&namespaceId=dev"

# 5) 关闭：Ctrl+C
```

> 若本机无 `mvn` 命令，参照 MIS `backend/mvn.ps1` 或使用 IDE 自带 Maven（3.9+）。
> T01 验收只跑 `mvn compile`，**不 gate `mvn test`**；`ReconApplicationTests`（@SpringBootTest）需本地 PG，作为可选冒烟，在 T02 有完整 DB 后纳入常规回归。

### 6.3 完成定义

A1–A5 全部满足 + §1.2 out-of-scope 未被突破（未写业务代码/业务表/API）→ T01 判完成，可放行 T02。

---

## 7. 风险与待确认

| # | 风险/待确认 | 当前处理 | 责任方 |
|---|-------------|----------|--------|
| 1 | `mis-common-core / mis-common-web / mis-common-security` 是否引入 | ✅ 已确认**不引入**：`ApiResponse` / `PageResult` 独立实现；认证自写 `JwtAuthFilter`（nimbus-jose-jwt RS256 公钥验签，`com.mis.recon.security`，2026-08-26 落地，含 13 条单测） | 已确认 |
| 2 | Nacos namespace / group 实际值 | 按 mis-kb 先例默认 `dev` / `MIS_GROUP`（bootstrap.yml 占位 `${NACOS_NAMESPACE:dev}`）；`recon-service` 是否复用 `mis-common` 共享 Data ID（会下发公共 datasource 模板）需 MIS 侧确认；namespace 可能是 UUID 而非字面量 | 待 MIS 侧确认 |
| 3 | recon 库连接账号 | 默认 `recon` / `recon123` 占位；账号、密码、public schema 权限（PG 15+）待 DBA 确认；只写 `${DB_*}` 占位，不落真实密码 | 待 DBA 确认 |
| 4 | `application-dev.yml` 与 MIS 配置方案 B 冲突 | MIS 约定各服务只保留 bootstrap + application 两文件；团队指令要求提供 dev profile，故 T01 按三文件落地；如要严格遵循方案 B，将 dev 覆盖合并进 application.yml 即可（风险低，仅影响本机开发体验） | 待 team-lead 裁决 |
| 5 | `server.port=8110` | 已避开现有端口（8080/8081/8101/8102/8103/8105/8106/8108）；仍需确认不与未来服务冲突 | 待确认 |
| 6 | 源库（MySQL）双数据源 | T01 单数据源（recon）；T02 引入 MySQL 源库只读连接时，需独立 DataSource + `@Qualifier("sourceDataSource")`，只读不参与强一致事务；对账场景建议最终一致，不走分布式事务 | T02 再议 |
| 7 | Quartz 单实例 vs 集群 | T01 `isClustered=false`；若 recon-service 多实例部署，需 `isClustered=true` + `QRTZ_` 表 + clusterCheckinInterval，另行列项 | T02 再议 |

---

## 8. 已知坑（内嵌硬约束）

1. **Flyway 10 必须 `flyway-database-postgresql`**：Flyway 10 起 PG 支持从 flyway-core 拆出；缺失时启动报 `Unsupported Database: PostgreSQL`。Boot 3.2.5 BOM 管理 flyway 10.10.0，MIS 提升到 10.14.0，两个 flyway artifact 都要在 recon-parent 显式管理为 10.14.0。
2. **PG 15+ public schema 权限**：PG 15 起普通用户默认无 public schema 的 CREATE 权限，Flyway 建表报 `permission denied for schema public`。必须 `GRANT ALL ON SCHEMA public TO recon`（§6.1）。
3. **`spring.jackson.date-format` 不作用于 `java.time.*`**：只影响 `java.util.Date`。LocalDateTime 等必须自定义 JavaTimeModule（§4.5），否则序列化仍是 ISO 数组/带 T 字符串。
4. **全局 Long→String 波及数值字段**：JacksonConfig 全局把 Long 序列化为字符串后，统计数值类 Long 字段也会变字符串；个别需数值的字段用 `@JsonSerialize(using = NumberSerializer.class)` 反控。
5. **`open-in-view` 必须 false**：Web 层延迟加载被掩盖会引入性能与事务边界隐患，recon 一律 `false`（§5.2 已锁）。
6. **Quartz `initialize-schema=never` 的前提是 QRTZ_ 表已存在**：T01 调度开关默认 false 就是为了在没有 QRTZ_ 表时保证启动/health 不红；T02 建表后置 true，顺序不能反。
7. **Windows surefire "different root"**：Windows 下 surefire 3.2.5 fork 可能报 `'other' has different root`，recon-parent 已带 `-Djdk.net.URLClassPath.disableClassPathURLCheck=true`（与 MIS 一致），勿删。
8. **bootstrap.yml 依赖 `spring-cloud-starter-bootstrap`**：漏加该依赖时 bootstrap.yml 完全不生效，Nacos 配置/注册静默失效，启动只报找不到 Nacos 数据源的间接错误，排查成本高。

---

## 9. 关联决策记录

| 决策 | 来源 | 结论 |
|------|------|------|
| JPA 取代 MyBatis | ADR-015 | recon 沿用，不引 mybatis/pagehelper |
| 独立工程独立库独立 Flyway | 本次 T01 规格 | recon 与 backend/ 平级，独立 database `recon` |
| 单数据源（T01） | 本次 T01 规格 | JPA + JdbcTemplate 共用 recon 库与同一事务管理器 |
| Flyway 版本 10.14.0 | MIS 父工程属性 | 显式管理 flyway-core + flyway-database-postgresql |

## 10. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-13 | §4.3 QuartzConfig 实现修正：`AutowireCapableBeanJobFactory`（幻觉 API）→ `SpringBeanJobFactory` + `setApplicationContext`；重复声明 `SchedulerFactoryBean` bean → `SchedulerFactoryBeanCustomizer` | T01 落地验证：该 API 在 Spring 6.1.6 jar 中不存在；Customizer 方案保留 Boot yml 驱动（JobStore 参数放 yml 的硬约束不被破坏） | 仅 §4.3 实现建议；依赖清单/配置文件/验收标准不变 |

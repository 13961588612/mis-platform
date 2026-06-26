# MIS Platform — 后端

Java 17 + Maven 多模块。持久层：**Spring Data JPA**（[ADR-015](../docs/adr/ADR-015-jpa-over-mybatis.md)）。

## 模块结构

```
backend/
├── pom.xml
├── mis-migrator/              # Flyway → mis_platform
├── mis-common/
│   ├── mis-common-bom/        # 依赖版本 BOM
│   ├── mis-common-core/       # Result、ResultCode、常量
│   ├── mis-common-jpa/        # BaseEntity、DataScope
│   ├── mis-common-web/        # TraceId、全局异常
│   ├── mis-common-security/   # JWT 验签/签发、GatewayContextFilter
│   └── mis-common-redis/      # Token 黑名单
├── mis-gateway/               # API 网关（L1 认证）
└── mis-auth/                  # 认证服务（L0 登录发证）
```

**阅读顺序**：见 [docs/CODE-READING-GUIDE.md](../docs/CODE-READING-GUIDE.md)。

## 安全分层（已实现部分）

| 层级 | 模块 | 职责 |
|------|------|------|
| L0 | mis-auth | 登录、JWT 签发、Refresh、登出写 jti 黑名单 |
| L1 | mis-gateway | JWT 验签、查黑名单、透传 `X-*` 头 |
| L2 | mis-admin-bff（待建） | API 权限（Redis permissions） |
| L3 | 领域服务 | 读透传头、`@DataScope` 数据权限 |

## JDK 17 配置

父 POM 通过 **`maven-enforcer-plugin`** 在 `validate` 阶段强制：

| 规则 | 要求 |
|------|------|
| `requireJavaVersion` | Maven **运行时** JDK ≥ 17（Spring Boot 3 插件无法在 JDK 8 的 JVM 中加载） |
| `requireMavenVersion` | Maven ≥ 3.9 |
| `requireEnvironmentVariable` | 已设置 `JAVA_HOME_17`（团队约定路径，供 IDE 等使用） |

```powershell
# 1. 持久化环境变量（系统或用户级）
JAVA_HOME_17 = d:\software\jdk-17.0.2

# 2. 构建前让 Maven 使用 JDK 17（二选一）
$env:JAVA_HOME = $env:JAVA_HOME_17   # 当前终端
.\mvn.ps1 clean package              # 包装脚本自动设置 JAVA_HOME
```

`jdk.home`（`spring-boot:run` 等）优先级：`-Djdk.home` > `config/jdk.properties` > `${java.home}`。

> **为何不能只在 POM 里 fork 编译器？** `maven-compiler-plugin` 可 fork 到 `JAVA_HOME_17`，但 `spring-boot-maven-plugin:repackage` 与多数插件在 **Maven 自身 JVM** 中执行，POM 无法将其切换到另一个 JDK。因此正确做法是：**让 Maven 以 JDK 17 启动**，并用 enforcer 在构建最开始失败并给出明确提示。

## 常用命令

```bash
cd backend

# 编译与测试
mvn clean package
mvn -pl mis-gateway,mis-auth,mis-common/mis-common-security -am test

# 迁移
mvn -pl mis-migrator flyway:migrate

# 启动（dev profile，默认不连 Nacos）
mvn -pl mis-auth spring-boot:run      # :8101
mvn -pl mis-gateway spring-boot:run   # :8080
```

## 配置模式

| 模式 | 配置来源 | 说明 |
|------|----------|------|
| local（默认） | `application.yml` + 环境变量 | 本地 IDE 默认 |
| remote | Nacos 命名空间（`test` / `integration` / `prod`） | `MIS_REMOTE=true` |

见 [configuration.md](../docs/devops/configuration.md)。

## 子模块 README

- [mis-migrator](mis-migrator/README.md)
- [mis-gateway](mis-gateway/README.md)
- [mis-auth](mis-auth/README.md)
- [mis-common-security](mis-common/mis-common-security/README.md)

## 关联文档

- [公共模块](../docs/backend/common-modules.md)
- [微服务规划](../docs/backend/microservices.md)
- [本地开发](../docs/devops/local-dev.md)

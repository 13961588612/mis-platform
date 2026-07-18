# 运维与部署文档

> 最后更新：2026-06-24

本目录说明如何在 **本地**、**测试**、**正式** 三类环境中运行 MIS Platform。

## 环境一览

| 环境 | 配置模式 | Nacos 命名空间 | 典型场景 |
|------|----------|----------------|----------|
| **本地开发** | local（默认） | 不连接 | IDE 直跑，连 Docker 基础设施 |
| **混合联调** | remote | `integration` | 容器稳定服务 + IDE 调试被测服务 |
| **测试环境** | remote | `test` | 测试集群 / 预发验证 |
| **正式环境** | remote | `prod` | 生产运行 |

### 配置两档模式

| 模式 | 开关 | 配置来源 |
|------|------|----------|
| **local** | 不设 `MIS_REMOTE`（默认 `false`） | jar 内 `application.yml` + 环境变量 |
| **remote** | `MIS_REMOTE=true` | Nacos 命名空间（Git 源在 `deploy/nacos-config/`） |

详见 [配置管理策略](configuration.md)。

## 文档导航

| 文档 | 内容 |
|------|------|
| **[本地开发](local-dev.md)** | 基础设施、Flyway、IDE 启动、前端联调、日常调试 |
| **[混合联调](integration-test.md)** | 容器栈 + IDE 被测服务、集成测试 |
| **[测试环境部署](test-deploy.md)** | 推送 test 配置、构建镜像、启动与验收 |
| **[正式环境部署](prod-deploy.md)** | 推送 prod 配置、密钥、发版与回滚 |
| [配置管理策略](configuration.md) | Nacos 数据流、Data ID 约定、新服务接入 |
| [CI/CD](ci-cd.md) | 流水线与质量门禁（规划） |

## 快速命令

### 本地开发（最常见）

```powershell
docker compose -f deploy/docker-compose.dev.yml up -d
cd backend; .\mvn.ps1 -pl mis-migrator flyway:migrate
.\mvn.ps1 spring-boot:run -pl mis-gateway,mis-auth,mis-audit
```

### 推送 Nacos 配置

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace test   # 或 prod / integration
.\scripts\nacos-push.ps1 -Namespace test
```

### 混合联调一键启动

```powershell
.\scripts\start-integration-stack.ps1
```

## 仓库关键路径

```
deploy/
├── docker-compose.dev.yml      # 本地基础设施（PG / Redis / Nacos / MinIO）
├── docker-compose.stack.yml    # 混合联调稳定服务栈
├── docker/Dockerfile.service   # 微服务通用镜像
├── nacos-config/               # 配置 Git 源（推送到 Nacos，不打进业务镜像）
│   ├── prod/
│   ├── test/
│   └── integration/
├── nacos/                      # Nacos Server 自身配置
├── ide/                        # IDE 联调环境变量模板
└── postgres/init/              # 建库与 Nacos 表结构

scripts/
├── nacos-push.ps1              # 推送配置到 Nacos
├── ensure-nacos-namespace.ps1  # 创建命名空间
└── start-integration-stack.ps1 # 混合联调一键脚本
```

## 微服务启动所需环境变量（remote）

| 变量 | 必填 | 示例 |
|------|------|------|
| `MIS_REMOTE` | 是 | `true` |
| `NACOS_NAMESPACE` | 是 | `test` / `prod` / `integration` |
| `NACOS_SERVER` | 是 | `nacos:8848` |
| `JWT_PRIVATE_KEY_PATH` | mis-auth | `/keys/private.pem` |
| `JWT_PUBLIC_KEY_PATH` | gateway / 验签 | `/keys/public.pem` |
| `DB_HOST` 等 | 视 Nacos 配置 | 可在 `mis-common` 或 env 注入 |

> **注意**：`deploy/nacos-config/` 是配置 **源文件**，通过 `nacos-push` 写入 Nacos；**不要**与 JAR 一起拷贝进业务容器。

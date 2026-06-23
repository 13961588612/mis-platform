# mis-migrator

Phase 1 全库 Flyway 迁移模块，**不含业务代码**。所有 Java 微服务共享 `mis_platform` 单库（ADR-001），表结构变更仅在此模块追加版本。

## 脚本位置

```
src/main/resources/db/migration/
├── V1__init_schema.sql   # 建表、枚举、索引
└── V2__seed_data.sql     # 种子数据
```

设计评审副本：`docs/db/migrations/`（修改后请同步到本目录）。

## 前置条件

| 工具 | 版本 |
|------|------|
| JDK | 17 |
| Maven | 3.9+ |
| PostgreSQL | 16（本地推荐 Docker） |

## 快速开始

```bash
# 1. 启动基础设施（仓库根目录）
docker compose -f deploy/docker-compose.dev.yml up -d

# 2. 执行迁移（backend 目录）
cd backend
mvn -pl mis-migrator flyway:migrate
```

Windows 一键：`.\scripts\init-dev.ps1`（启动 Docker + 等待 PG + migrate）。

## 常用命令

```bash
cd backend

# 查看迁移状态
mvn -pl mis-migrator flyway:info

# 校验脚本（不执行）
mvn -pl mis-migrator flyway:validate

# 覆盖数据库连接
mvn -pl mis-migrator flyway:migrate \
  -Ddb.host=127.0.0.1 -Ddb.port=5432 -Ddb.name=mis_platform \
  -Ddb.user=mis -Ddb.password=mis123
```

## 约定

- **只追加** `V{n}__*.sql`，禁止修改已发布版本
- 业务微服务 `spring.flyway.enabled=false`，不在启动时重复迁移
- `flyway:clean` 已禁用（`cleanDisabled=true`），防止误删库
- 生产回滚使用补偿脚本 `V{n+1}__compensate_*.sql`，不做 downgrade

## 默认账号（V2 种子）

| 账号 | 密码 | 说明 |
|------|------|------|
| superadmin | Mis@123456 | 平台管理员 |
| admin | Mis@123456 | 租户管理员（app=system） |

首次登录须改密（`must_change_password=1`）。

## 关联文档

- [schema-design.md](../../docs/database/schema-design.md)
- [seed-data.md](../../docs/database/seed-data.md)
- [local-dev.md](../../docs/devops/local-dev.md)

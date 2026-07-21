# 数据库迁移脚本目录

Flyway 迁移脚本，与 `mis-migrator` 模块同步。

## 文件

| 文件 | 状态 | 说明 |
|------|------|------|
| [V1__init_schema.sql](V1__init_schema.sql) | ✅ | 建表、枚举、索引 |
| [V2__seed_data.sql](V2__seed_data.sql) | ✅ | 种子：superadmin、租户 admin、菜单/API 全量 |
| [V3__rename_sys_module_services.sql](V3__rename_sys_module_services.sql) | ✅ | Sprint 2：`sys_module` → mis-iam / mis-org（合并原 mis-user/mis-rbac） |
| [V4__api_path_align.sql](V4__api_path_align.sql) | ✅ | API path_pattern 与对外 `/api/v1` 对齐 |
| [V5__sys_app_portal_fields.sql](V5__sys_app_portal_fields.sql) | ✅ | `sys_app` 门户字段 + 占位 APP + `GET /api/v1/apps` 映射 |

## 本地执行

### 方式 A：Maven Flyway（推荐）

```bash
# 先启动 Postgres（见 deploy/docker-compose.dev.yml 或 init-dev.ps1）
cd backend
mvn -pl mis-migrator flyway:migrate
mvn -pl mis-migrator flyway:info
```

### 方式 B：psql 直跑（快速验证 SQL 语法）

```bash
# 创建库
psql -U postgres -c "CREATE DATABASE mis_platform;"
psql -U postgres -c "CREATE USER mis WITH PASSWORD 'mis123';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE mis_platform TO mis;"

# 执行迁移
psql -U mis -d mis_platform -f docs/db/migrations/V1__init_schema.sql
psql -U mis -d mis_platform -f docs/db/migrations/V2__seed_data.sql
psql -U mis -d mis_platform -f docs/db/migrations/V3__rename_sys_module_services.sql
psql -U mis -d mis_platform -f docs/db/migrations/V4__api_path_align.sql
psql -U mis -d mis_platform -f docs/db/migrations/V5__sys_app_portal_fields.sql
```

### 方式 C：一键脚本

```powershell
.\scripts\init-dev.ps1    # Windows
./scripts/init-dev.sh     # Linux / macOS
```

## 默认账号

| 账号 | 密码 | 说明 |
|------|------|------|
| superadmin | Mis@123456 | 平台管理员，首次须改密 |
| admin @ app=system | Mis@123456 | 租户管理员，首次须改密 |

## 同步

- **设计评审源**：`docs/db/migrations/`
- **Flyway 执行路径**：`backend/mis-migrator/src/main/resources/db/migration/`
- 修改 SQL 后请同步两处，再由 `mvn -pl mis-migrator flyway:migrate` 执行

模块说明见 [backend/mis-migrator/README.md](../../backend/mis-migrator/README.md)。

# Nacos 部署说明

## PostgreSQL 外置存储

Nacos **配置数据** 存入 PostgreSQL 库 `nacos`（与业务库 `mis_platform` 隔离）。  
微服务在 `MIS_REMOTE=true` 时通过 Nacos Client 读取配置，数据来自该库中的 `config_info` 等表。

| 文件 | 用途 |
|------|------|
| `server/application.properties` | Nacos Server 数据源（挂载到容器） |
| `nacos-standalone-pg.env` | Docker Compose 环境变量 |
| `schema/postgresql-schema.sql` | 表结构参考 |
| `postgres/init/02-init-nacos-db.sql` | 建库 |
| `postgres/init/03-nacos-schema.sql` | 建表 |
| `../nacos-config/{prod,test,integration}/` | **各环境 Git 配置源** |

## 各环境

| 环境 | `MIS_REMOTE` | Git 源 | 推送命令 |
|------|--------------|--------|----------|
| local | `false`（默认） | `application.yml` | — |
| test | `true` | `deploy/nacos-config/test/` | `nacos-push.ps1 -Namespace test` |
| integration | `true` | `deploy/nacos-config/integration/` | `nacos-push.ps1 -Namespace integration` |
| prod | `true` | `deploy/nacos-config/prod/` | `nacos-push.ps1 -Namespace prod` |

## 故障排查

1. 确认 Postgres 已执行 `03-nacos-schema.sql`
2. `docker logs mis-nacos`
3. 控制台查看命名空间与 Data ID 是否已推送

## 推送配置

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace prod
.\scripts\nacos-push.ps1 -Namespace prod
```

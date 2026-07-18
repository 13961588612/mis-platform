# Nacos 部署说明

Nacos **配置数据** 存入 PostgreSQL 库 `nacos`（与业务库 `mis_platform` 隔离）。

| 文件 | 用途 |
|------|------|
| `server/application.properties` | Nacos Server 数据源 |
| `nacos-standalone-pg.env` | Docker Compose 环境变量 |
| `schema/postgresql-schema.sql` | 表结构参考 |
| `../postgres/init/02-init-nacos-db.sql` | 建库 |
| `../postgres/init/03-nacos-schema.sql` | 建表 |
| `../nacos-config/{prod,test,integration}/` | 各环境配置 Git 源 |

## 推送配置

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace prod
.\scripts\nacos-push.ps1 -Namespace prod
```

## 文档

- [运维总览](../docs/devops/README.md)
- [配置管理策略](../docs/devops/configuration.md)
- [测试部署](../docs/devops/test-deploy.md)
- [正式部署](../docs/devops/prod-deploy.md)

## 故障排查

1. 确认 Postgres 已执行 `03-nacos-schema.sql`
2. `docker logs mis-nacos`
3. 控制台查看命名空间与 Data ID 是否已推送

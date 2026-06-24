# Nacos 部署说明

## PostgreSQL 外置存储

Nacos **配置数据** 存入 PostgreSQL 库 `nacos`（与业务库 `mis_platform` 隔离）。

| 文件 | 用途 |
|------|------|
| `server/application.properties` | Nacos Server 数据源（挂载到容器） |
| `nacos-standalone-pg.env` | Docker Compose 环境变量 |
| `schema/postgresql-schema.sql` | 表结构参考 |
| `postgres/init/02-init-nacos-db.sql` | 建库（随 Postgres 容器首次启动） |
| `postgres/init/03-nacos-schema.sql` | 建表（同上） |
| `import/*.yaml` | 导入测试配置中心的模板 |

## 微服务与 Nacos 的关系

- **正式环境**：微服务 **不连接** Nacos 客户端，见 `docs/devops/configuration.md`
- **测试环境**：可选 `NACOS_CONFIG_ENABLED=true` 连接本 Nacos
- **本地 dev**：默认 `application.yml`，Nacos 可选

## 故障排查

Nacos 2.3.x 使用 PostgreSQL 时，若启动报数据源或表不存在：

1. 确认 Postgres 已执行 `03-nacos-schema.sql`（仅首次 `docker compose up` 时自动执行）
2. 查看容器日志：`docker logs mis-nacos`
3. 部分版本需 [nacos-datasource-plugin-postgresql](https://github.com/nacos-group/nacos-plugin) 放入 `plugins/` 目录

微服务连接 Nacos 失败不影响 **dev/test 文件模式**（`NACOS_CONFIG_ENABLED=false`）。

## 导入配置

```powershell
.\scripts\import-nacos-config.ps1 -Namespace test
```


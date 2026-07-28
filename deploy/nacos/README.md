# Nacos 部署说明

## 版本与 JDK（锁定）

| 项 | 值 | 说明 |
|----|-----|------|
| Nacos **Server** | **2.3.2** | 与 SCA `2023.0.1.0` 的 `nacos-client` 一致 |
| Server **运行 JDK** | **17** | 与 mis-auth 等同机手工部署时可共用 `JAVA_HOME_17` |
| 业务 Client | SCA 引入的 2.3.2 | 跑在业务进程的 JDK 17 内，协议连 Server |

> 兼容指 **协议/大版本**（Client 2.3.x ↔ Server 2.3.x），不是「必须塞进同一个 JVM」。  
> Server 用 JDK 17 跑 2.3.2 发行包（Java 8 字节码可在 17 上运行）；PG 插件须为 **Java 17** 编译（`0.0.7`）。

镜像：`mis-nacos:2.3.2-jdk17`（`deploy/nacos/Dockerfile`）。

## 文件

| 文件 | 用途 |
|------|------|
| `Dockerfile` / `docker-entrypoint.sh` | JDK 17 自建镜像 |
| `nacos-standalone-embedded.env` | 本地默认（内嵌） |
| `nacos-standalone-pg.env` | PG 外置环境变量 |
| `server/application.properties` | 容器内 PG（主机名 `postgres`） |
| `server/application-native-pg.properties` | 本机手工 PG（`127.0.0.1`） |
| `plugins/` | PG 插件 JAR（gitignore，脚本下载） |

## 本地（内嵌）

```powershell
docker compose -f deploy/docker-compose.dev.yml build nacos
docker compose -f deploy/docker-compose.dev.yml up -d nacos
```

## 测试 / 联调（PostgreSQL 外置）

```powershell
.\scripts\ensure-nacos-pg-plugins.ps1
docker compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.nacos-pg.yml build nacos
docker compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.nacos-pg.yml up -d nacos
```

前置：PG 已执行 `02-init-nacos-db.sql` / `03-nacos-schema.sql`。

## 本机手工部署（与 mis-auth 同 JDK 17）

```powershell
# 内嵌
.\scripts\start-nacos-native.ps1

# PostgreSQL（本机 5432 / 库 nacos）
.\scripts\ensure-nacos-pg-plugins.ps1
.\scripts\start-nacos-native.ps1 -UsePostgres
```

要求已设置 `JAVA_HOME_17`（与 `backend/start-dev.ps1` 相同）。

## 推送配置

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace test
.\scripts\nacos-push.ps1 -Namespace test
```

## 文档

- [配置管理策略](../../docs/devops/configuration.md)
- [测试部署](../../docs/devops/test-deploy.md)
- [正式部署](../../docs/devops/prod-deploy.md)

## 故障排查

1. **CPU 很高 / RestartCount 暴涨**：启动失败反复重启 → `docker logs mis-nacos`
2. PG 模式缺插件：先 `ensure-nacos-pg-plugins.ps1` 再 **rebuild** 镜像（插件在 build 时 COPY）
3. 业务不受影响：mis-auth 等仍 Java 17 + SCA，无需改 pom
4. 控制台：http://localhost:8848/nacos（`nacos`/`nacos`）

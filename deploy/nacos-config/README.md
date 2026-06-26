# Nacos 配置 Git 源

各命名空间目录下的 `*.yaml` 为 **Nacos 配置中心的 Git 源**，经 `scripts/nacos-push.ps1` 推送到对应命名空间。

| 目录 | Nacos 命名空间 | 用途 |
|------|----------------|------|
| `prod/` | `prod` | 正式环境 |
| `test/` | `test` | 测试环境 |
| `integration/` | `integration` | 混合联调 |

## Data ID 约定

Git 文件名带 `.yaml` 扩展名；Nacos `data_id` **不含扩展名**（由 bootstrap `file-extension: yaml` 声明格式）。

| Git 文件 | Nacos Data ID |
|----------|---------------|
| `mis-common.yaml` | `mis-common` |
| `mis-gateway.yaml` | `mis-gateway` |
| `mis-auth.yaml` | `mis-auth` |
| `mis-audit.yaml` | `mis-audit` |

## 推送

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace prod
.\scripts\nacos-push.ps1 -Namespace prod
```

```bash
./scripts/nacos-push.sh integration
```

## 微服务加载

设置 `MIS_REMOTE=true` 后，bootstrap 从 Nacos 拉取 `mis-common` + `{spring.application.name}`。  
本地开发不设 `MIS_REMOTE`，仅使用 jar 内 `application.yml`。

详见 [configuration.md](../../docs/devops/configuration.md)。

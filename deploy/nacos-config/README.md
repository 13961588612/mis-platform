# Nacos 配置 Git 源

各命名空间目录下的 `*.yaml` 为 **Nacos 配置中心的 Git 源**，经 `scripts/nacos-push.ps1` 推送到对应命名空间。

| 目录 | Nacos 命名空间 | 操作文档 |
|------|----------------|----------|
| `prod/` | `prod` | [正式环境部署](../../docs/devops/prod-deploy.md) |
| `test/` | `test` | [测试环境部署](../../docs/devops/test-deploy.md) |
| `integration/` | `integration` | [混合联调](../../docs/devops/integration-test.md) |

## Data ID 约定

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

## 注意

- 配置通过 Nacos 下发，**不**与 JAR 打包进业务容器
- 微服务设 `MIS_REMOTE=true` 后从 Nacos 拉取
- 本地开发不设 `MIS_REMOTE`，见 [本地开发](../../docs/devops/local-dev.md)

完整说明：[配置管理策略](../../docs/devops/configuration.md) · [运维总览](../../docs/devops/README.md)

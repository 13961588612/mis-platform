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
| `mis-iam.yaml` | `mis-iam` |
| `mis-org.yaml` | `mis-org` |
| `mis-system.yaml` | `mis-system` |
| `mis-audit.yaml` | `mis-audit` |
| `mis-kb.yaml` | `mis-kb` |
| `mis-admin-bff.yaml` | `mis-admin-bff` |

## 推送与核对

```powershell
.\scripts\ensure-nacos-namespace.ps1 -Namespace integration
.\scripts\nacos-push.ps1 -Namespace integration
.\scripts\nacos-diff.ps1 -Namespace integration
```

`nacos-diff.ps1`：对比 Git 源与线上 Data ID（方案 B L2）；有差异 exit 1，两侧正文落到 `%TEMP%`。

## 注意

- 配置通过 Nacos 下发，**不**与 JAR 打包进业务容器
- 微服务 `bootstrap` 默认 `MIS_REMOTE=true`，从 Nacos 拉取
- 纯本地开发须显式 `MIS_REMOTE=false`，见 [本地开发](../../docs/devops/local-dev.md)

完整说明：[配置管理策略](../../docs/devops/configuration.md) · [运维总览](../../docs/devops/README.md)

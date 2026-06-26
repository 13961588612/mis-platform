# IDE 联调环境变量

混合联调（`integration` 命名空间）时，将对应 `.env` 粘贴到 Run Configuration。

| 文件 | 用途 |
|------|------|
| `mis-auth-integration.env` | IDE 调试 mis-auth |
| `mis-audit-integration.env` | IDE 调试 mis-audit |
| `mis-gateway-integration.env` | IDE 调试 mis-gateway（少见） |

关键变量：`MIS_REMOTE=true`、`NACOS_NAMESPACE=integration`、`NACOS_REGISTER_IP=host.docker.internal`

详见 [混合联调](../../docs/devops/integration-test.md)。

# IDE 联调环境变量

将对应 `.env` 文件内容粘贴到 Run Configuration 的 Environment variables（IntelliJ）或 `launch.json` env（VS Code）。

| 文件 | 用途 |
|------|------|
| `mis-auth-integration.env` | IDE 调试 mis-auth |
| `mis-audit-integration.env` | IDE 调试 mis-audit |
| `mis-gateway-integration.env` | IDE 调试 mis-gateway（少见，通常跑容器） |

路径请按本机仓库位置修改 `JWT_*_PATH`。

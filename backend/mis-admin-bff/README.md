# mis-admin-bff

管理后台 BFF（端口 **8081**）：聚合 `mis-iam` / `mis-org` / `mis-system`，对外暴露 `/api/v1/**`。

## 职责

| 对外路径 | 下游 |
|----------|------|
| `/api/v1/users` | IAM + Org（列表补全姓名/部门/组织） |
| `/api/v1/roles` | IAM；`/roles/{id}/menus` 角色-菜单 |
| `/api/v1/menus` | system 管理树 + IAM 授权组装 `router` / `permissions` |
| `/api/v1/orgs` / `/depts` / `/employees` | Org |

登录仍走 Gateway → **mis-auth**（不经本服务）。

## 本地运行

```powershell
# 先启动 mis-iam:8102、mis-org:8103、mis-system:8105
cd backend
.\mvn.ps1 spring-boot:run -pl mis-admin-bff
```

请求需带 Gateway 透传头：`X-User-Id`、`X-Tenant-Id`、`X-App-Id`。

## 配置

```yaml
mis.bff.iam-base-url / org-base-url / system-base-url
mis.bff.*-discovery-enabled  # Nacos 时改为 true
```

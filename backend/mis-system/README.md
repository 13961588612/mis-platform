# mis-system

系统服务（端口 **8105**）：菜单树、路由组装；后续字典 / API Registry。

## 内部 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/internal/v1/menus/tree?appId=` | 完整菜单树 |
| GET | `/internal/v1/menus/router?appId=&menuIds=` | 动态路由（授权菜单+祖先） |
| GET | `/internal/v1/menus/permissions?menuIds=` | permission 码列表 |
| CRUD | `/internal/v1/menus` | 菜单维护 |

## 本地启动

```powershell
cd backend
.\mvn.ps1 spring-boot:run -pl mis-system
```

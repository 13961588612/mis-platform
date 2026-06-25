# mis-admin-web

Phase 1 管理后台前端（Sprint 1：登录闭环）。

## 启动

```bash
cd frontend/mis-admin-web
pnpm install
pnpm dev
```

访问 http://localhost:5173 ，API 经 Vite 代理到 Gateway `http://localhost:8080`。

## 默认账号

- 用户名：`admin`
- 密码：`Mis@123456`（种子数据，首次登录 `mustChangePassword=true`）

## 已实现

- 登录页 + 验证码
- Zustand `auth-store`（持久化 Access Token）
- Axios 拦截器 + Refresh 单飞锁（`withCredentials` 携带 Refresh Cookie）
- 路由守卫（未登录 → `/login`）

## 依赖服务

Gateway `8080`、mis-auth `8101`、PostgreSQL、Redis。

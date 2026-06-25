# mis-audit

审计服务：登录日志写入/查询；操作日志（Sprint 4）。

## 端口

`8106`

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/internal/v1/login-logs` | mis-auth 写入登录日志 |
| GET | `/internal/v1/login-logs` | 分页查询（内部） |
| GET | `/api/v1/audit/login-logs` | 分页查询（经 Gateway） |

## 启动

```bash
cd backend
.\mvn.ps1 spring-boot:run -pl mis-audit
```

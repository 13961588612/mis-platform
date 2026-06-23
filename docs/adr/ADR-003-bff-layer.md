# ADR-003: 引入 BFF 聚合层

## 状态
提议中

## 日期
2026-06-23

## 背景

前端需要调用用户、组织、角色等多个微服务。若前端直接对接各服务，将导致：

- 多次 HTTP 往返（如用户列表需 orgName、roles）
- 前端耦合多个 API 契约
- Gateway 路由规则复杂

## 决策

引入 **mis-admin-bff** 作为管理后台专用 Backend-for-Frontend：

- 前端**仅**调用 BFF 暴露的 `/api/v1/*`
- BFF 通过 **WebClient** 聚合领域服务（见 ADR-007）
- BFF 适配前端 DTO，字段 camelCase，减少前端转换

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. BFF（选定） | 前端简单、少往返 | 多一层维护 |
| B. 前端直连各服务 | 少一层 | 前端复杂 |
| C. GraphQL 网关 | 灵活查询 | Phase 1 过重 |

## 后果

### 正面
- 前端 API 契约单一
- 列表页可一次返回完整数据
- 便于后续移动端另建 BFF

### 负面
- BFF 可能膨胀为「上帝服务」（需克制，不写业务规则）
- 多一跳延迟（通常可忽略）

## 约束

- BFF 不含核心业务规则，规则在领域服务
- BFF 不直接访问数据库
- 内部服务 API 使用 `/internal/v1`，不对外暴露

## 待确认

- [x] BFF 信任 Gateway 透传头（见 [03-security](../architecture/03-security.md) §4.5）
- [ ] 未来 H5 是否复用 BFF 或新建 mobile-bff

# 编码与 Git 规范

> 状态：📝 草稿 | 版本：v1.0-draft

## 1. Git 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>

[optional body]
```

### 1.1 type

| type | 说明 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| docs | 文档 |
| style | 格式（不影响逻辑） |
| refactor | 重构 |
| test | 测试 |
| chore | 构建/工具 |

### 1.2 scope 示例

`auth`, `user`, `org`, `rbac`, `gateway`, `web`, `agent`, `deploy`

### 1.3 示例

```
feat(auth): add captcha on login
fix(user): prevent deleting last admin
docs(api): update user list response schema
```

## 2. Java 规范

### 2.1 包命名

```
com.mis.{module}.{layer}
```

示例：`com.mis.user.service.impl.UserServiceImpl`

### 2.2 分层职责

| 层 | 职责 |
|----|------|
| controller | 参数校验、调用 service、返回 Result |
| service | 业务逻辑 |
| domain/repository | Spring Data JPA 数据访问（ADR-015，非 MyBatis Mapper） |
| domain/entity | 数据库实体 |
| dto / vo | 请求 DTO / 响应 VO |

**禁止：** Controller 写业务逻辑；Service 直接返回 Entity 给前端。

### 2.3 命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 实体 | 名词 | User, SysRole |
| Service | XxxService | UserService |
| DTO | XxxCreateDTO | UserCreateDTO |
| VO | XxxVO | UserVO |
| Repository | XxxRepository | SysUserRepository |

### 2.4 注释

- 类：简要说明职责
- 公共方法：JavaDoc
- 业务规则非显而易见时加注释

## 3. TypeScript / React 规范

### 3.1 命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件 | PascalCase | UserListPage |
| hooks | useXxx | usePermission |
| 文件（组件） | kebab-case 或 PascalCase | user-list-page.tsx |
| 类型/接口 | PascalCase | UserInfo |
| 常量 | UPPER_SNAKE | API_BASE_URL |

### 3.2 组件结构

```tsx
// 1. imports
// 2. types
// 3. component
// 4. sub-components (if small)
```

### 3.3 状态

- 服务端数据：TanStack Query
- 全局 UI/认证：Zustand
- 表单：React Hook Form 本地状态
- 避免不必要的 useEffect

### 3.4 路径别名

```json
{ "@/*": ["./src/*"] }
```

## 4. Python 规范

| 项 | 规则 |
|----|------|
| 格式化 | ruff format |
| Lint | ruff check |
| 类型 | 公共函数加 type hints |
| 命名 | snake_case |
| 模块 | 按 api / services / core 分层 |

## 5. SQL 规范

| 规则 | 说明 |
|------|------|
| 命名 | 小写蛇形，前缀 sys_ |
| 索引 | uk_ 唯一，idx_ 普通 |
| 禁止 | 生产 SELECT * |
| 迁移 | 只追加 Flyway 版本，不修改已发布版本 |

## 6. API 设计规范

| 规则 | 说明 |
|------|------|
| URL | 复数名词 `/users` |
| 动作 | HTTP 方法表达 |
| 版本 | `/api/v1` 前缀 |
| ID | 路径参数 `{id}`，字符串传输 |
| 响应 | 统一 Result 包装 |

## 7. 代码审查检查清单

- [ ] 是否有权限注解 / 数据权限
- [ ] 敏感字段是否脱敏
- [ ] 是否有操作日志
- [ ] 输入是否校验
- [ ] 是否有单测
- [ ] 是否硬编码密钥
- [ ] 前端是否处理 loading/error 状态

## 8. 技术栈（已确认）

| 项 | 决策 |
|----|------|
| Java 构建 | **Maven** 多模块 |
| 前端包管理 | pnpm（暂定） |
| Python | Phase 3 前再定（uv / poetry） |
| 代码格式 | Spotless（Java）+ Prettier（前端），pre-commit 建议启用 |

## 9. AI 辅助开发

Cursor Agent 角色、工作流与按语言拆分的规则见：

- [AI 辅助开发配置](./ai-assisted-dev.md)
- 仓库根目录 [AGENTS.md](../../AGENTS.md)
- `.cursor/rules/`

## 10. 关联文档

- [公共模块](../backend/common-modules.md)
- [管理后台设计](../frontend/admin-web-design.md)

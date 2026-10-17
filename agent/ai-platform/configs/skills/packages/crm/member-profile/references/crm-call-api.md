# CRM callApi 调用约定（会员档案域）

## MCP 连接

- **MCP 服务名**：`mcp-api-suite`
- **工具名**：`callApi`

## 约束

- 勿传 `serviceName`
- 会员域 **勿传 `datasourceId`**

## 身份字段默认约定

- 未说明类型时优先这样理解（查不到可换一种再试）：11 位且以 1 开头（如 139）→ `getMemberProfileByMobile`；以 8 开头 → `getMemberProfileByMemberCardNo`
- 明确会员编号 / 卡号 / 车牌 → 见 SKILL.md 映射表

# CRM callApi 调用约定（会员聚合订单域）

## MCP 连接

- **MCP 服务名**：`mcp-api-suite`
- **工具名**：`callApi`

## 约束

- 勿传 `serviceName`
- 勿传 `datasourceId`（服务端按模块固定到 CRM / ZHG）

## 身份前提

- 入参只要 `vipId`；仅有手机号 / 卡号时先经 `member.profile` 解析
- `apiName` 二选一：`listMemberOrdersByVipId` / `listMemberAllOrdersByVipId`（等价）

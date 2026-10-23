# CRM callApi 调用约定（CRM 订单详情域）

## MCP 连接

- **MCP 服务名**：`mcp-api-suite`
- **工具名**：`callApi`

## 约束

- 勿传 `serviceName`
- 会员域 **勿传 `datasourceId`**

## 接口速查

| apiName | 必填 params | 条件 |
|---------|-------------|------|
| `getMemberCrmPosOrderDetail` | `orderSourceName` | `orderCode` **或** `storeId`+`terminalNo`（可选 `receiptNo`） |
| `listMemberCrmPosOrdersWithLinesByVipId` | `vipId` | 可选 `beginDate` |

## 身份前提

- 批量接口只要 `vipId`；仅有手机号 / 卡号时先经 `member.profile` 解析
- 聚合列表（无明细）用 `orders.member-all`；本 Skill 查头+行

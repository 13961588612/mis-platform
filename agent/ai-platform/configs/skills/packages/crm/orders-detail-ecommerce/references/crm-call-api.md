# callApi 调用约定（智慧购订单详情域）

## MCP 连接

- **MCP 服务名**：`mcp-api-suite`
- **工具名**：`callApi`

## 约束

- 勿传 `serviceName`
- **勿传 `datasourceId`**（服务端固定 ZHG）

## 接口速查

| apiName | 必填 params | 说明 |
|---------|-------------|------|
| `listMemberZhgMallOrdersByVipId` | `vipId` | 可选 `beginDate`；拿单号 |
| `getZhgMallSaleOrderDetail` | `orderCode` | 销售单号 |
| `getZhgMallRefundOrderDetail` | `orderCode` | 退货单号 |
| `getZhgMallOrderDetail` | `orderCode` | 并行查销售+退货并合并 |

## 关联 Skill

- 聚合列表：`orders.member-all`
- CRM 头+行：`orders-detail.crm`
- 仅有手机号/卡号：先 `member.profile` 解析 `vipId`

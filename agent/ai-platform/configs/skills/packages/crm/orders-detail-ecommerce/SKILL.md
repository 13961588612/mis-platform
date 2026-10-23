---
name: orders-detail.ecommerce
skill_id: orders-detail.ecommerce
description: 智慧购（ZHG/MySQL）单笔订单详情：销售单、退货单头与商品行，及合并查询。用户需要按订单号查智慧购消费单明细、退货单明细或一次并行查两种时触发此 Skill。
version: "1.0.0"
category: crm
tags:
  - 会员
  - 订单
  - 订单详情
  - 智慧购
  - ZHG
  - 电商
  - 退货
  - orders-detail.ecommerce
source: package
status: active
timeout: 60
requires_approval: false
required_permissions:
  - crm:member:read
handler: mcp:mcp-api-suite:callApi
mcp_server: mcp-api-suite
inputSchema:
  type: object
  additionalProperties: false
  properties:
    apiName:
      type: string
      description: 智慧购订单详情域接口名
      enum:
        - listMemberZhgMallOrdersByVipId
        - getZhgMallSaleOrderDetail
        - getZhgMallRefundOrderDetail
        - getZhgMallOrderDetail
    params:
      type: object
      additionalProperties: false
      description: 智慧购订单参数，勿传 datasourceId 或 serviceName
      properties:
        vipId:
          type: string
          description: 会员编号（仅 listMemberZhgMallOrdersByVipId 必填）
        beginDate:
          type: string
          description: 起始日期（ISO，可选；仅列表接口）
        orderCode:
          type: string
          description: 销售单号或退货单号（详情/合并接口必填）
  required:
    - apiName
    - params
---

# 智慧购订单详情（orders-detail.ecommerce）

本文档供 **WorkBuddy / QwenPaw** 生成 Skill 使用：描述智慧购（ZHG）订单明细字段，以及如何通过 MCP 工具 **`callApi`** 查询单笔销售单、退货单或合并结果。

注册入口见代码 **`src/app/call-api-registry/registry-ecommerce-orders.ts`**（本 Skill 所列 `apiName` 均来自该注册表）。

## MCP 与调用前提

- WorkBuddy / QwenPaw 中已配置 MCP 服务，**名称为 `mcp-api-suite`**（与下文的工具调用对应）。
- 所有接口均通过该服务上的工具 **`callApi`** 调用：传入 **`apiName`**（字符串）与 **`params`**（对象）。
- **`params` 必须是对象**，不要写成 JSON 字符串。
- 进程内查询时不要传 **`serviceName`**，或传空/省略。
- **不需要、也不要传 `datasourceId`**（智慧购数据源由服务端固定到 ZHG）。

## 会员身份前提（列表接口）

- `listMemberZhgMallOrdersByVipId` 以 **`vipId`** 为条件；仅有手机号/卡号时先经 `member.profile` 解析。
- 跨域聚合列表（含智慧购摘要、无明细）见 `orders.member-all`；CRM 头+行见 `orders-detail.crm`。

## 1 数据与字段说明

### 1.1 销售单详情（`ZhgMallSaleOrderDetailResult`）

返回结构为：

- `order`：订单头（对象；按 `order.code` 未查到行时为 `null`）
- `lines`：商品行数组（`order_goods`）

#### 订单头（`order`，销售）

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderSourceName` | `string` | 来源文案（如「智慧购订单」） |
| `saleOrRefund` | `string \| null` | 消费/退货（销售单为「消费」） |
| `orderCode` | `string \| null` | 销售单号（`order.code`） |
| `storeId` / `storeName` | `string \| null` | 门店 |
| `createTime` | `string` | 创建时间 |
| `successTime` | `string \| null` | 成功时间 |
| `status` | `string \| null` | 订单状态文案 |
| `vipId` / `memberCardNo` | `string \| null` | 会员编号 / 会员卡号 |
| `userName` / `mobile` | `string \| null` | 昵称 / 手机 |
| `amount` | `number` | 订单金额 |
| `fee` | `number` | 运费（`express_amount`） |
| `expressDiscountAmount` | `number` | 运费券抵扣 |
| `goodsAmount` | `number` | 商品金额 |
| `universalCouponAmount` | `number` | 通用券金额 |
| `wxPayAmount` | `number` | 微信支付金额 |
| `pointsUseAsAmount` / `pointsUse` | `number` | 积分抵现金额 / 使用积分数 |
| `bountyAmount` | `number` | 赏金等 |
| `yearReturnCouponAmount` | `number` | 年返券等 |
| `welfareAmount` / `ecCouponAmount` / `cashcardAmount` | `number` | 福利金 / 电商券 / 现金卡 |
| `activityAmount` / `fullMinusAmount` / `discountAmount` | `number` | 活动 / 满减 / 折扣 |
| `address` | `string \| null` | 收货地址 |
| `deliveryMethod` | `string \| null` | 配送方式（自提/快递等） |

#### 商品行（`lines[]`，销售）

| 字段 | 类型 | 含义 |
|------|------|------|
| `goodsId` / `goodsName` | `string \| null` | 商品 id / 名称 |
| `goodsTotal` | `number` | 件数 |
| `salePrice` | `number` | 销售价 |
| `goodsAmount` / `dealAmount` | `number` | 商品金额 / 成交价 |
| `couponAmount` | `number` | 券抵扣 |
| `pointUseAsAmount` | `number` | 积分抵现 |
| `bountyAmount` / `yearReturnAmount` | `number` | 赏金 / 年返 |
| `cashcardAmount` / `welfareAmount` / `ecCouponAmount` | `number` | 现金卡 / 福利 / 电商券 |
| `activityAmount` / `fullMinusAmount` / `discountAmount` | `number` | 活动 / 满减 / 折扣 |

### 1.2 退货单详情（`ZhgMallRefundOrderDetailResult`）

返回结构为：

- `order`：退货单头（按 `refund.code` 未查到行时为 `null`）
- `lines`：按商品聚合后的行（`refund_goods` + `order_goods_detail`）

#### 订单头（`order`，退货）

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderSourceName` | `string` | 来源 |
| `saleOrRefund` | `string \| null` | 「退货」 |
| `orderCode` | `string \| null` | **退货单号**（`refund.code`） |
| `originOrderCode` | `string \| null` | 原销售单号（`refund.order_code`） |
| `storeId` / `storeName` | `string \| null` | 门店 |
| `createTime` | `string` | 创建时间 |
| `successTime` | `string \| null` | 退款成功时间 |
| `amount` | `number` | 退款金额 |
| `fee` | `number` | 退运费 |
| `status` | `string \| null` | 退货退款状态文案 |
| `vipId` / `memberCardNo` / `userName` / `mobile` | `string \| null` | 会员信息 |
| `goodsAmount` | `number` | 退商品金额 |
| `address` | `string \| null` | 退货地址 |

#### 商品行（`lines[]`，退货聚合）

| 字段 | 类型 | 含义 |
|------|------|------|
| `goodsId` / `goodsName` | `string \| null` | 商品 |
| `salePrice` | `number` | 均价（聚合） |
| `goodsAmount` / `dealAmount` | `number` | 金额汇总 |
| `couponAmount` / `pointUseAsAmount` / `bountyAmount` / `yearReturnAmount` | `number` | 分项汇总 |
| `cashcardAmount` / `welfareAmount` / `ecCouponAmount` | `number` | 分项汇总 |
| `activityAmount` / `fullMinusAmount` / `discountAmount` | `number` | 分项汇总 |

### 1.3 合并详情（`ZhgMallOrderDetailMergedResult`）

同一入参 `orderCode` 并行查询销售侧（`order.code`）与退货侧（`refund.code`）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderCode` | `string` | 调用传入的订单号 |
| `sale` | 对象 | 结构同 **1.1**（`order` + `lines`） |
| `refund` | 对象 | 结构同 **1.2**（`order` + `lines`） |

列表里「消费」行的单号对应销售单；「退货」行的单号对应退货单。同一串号通常只会在 `sale` 或 `refund` 一侧命中头信息。

## 2 能力清单 — `registry-ecommerce-orders`（工具 `callApi`）

在 MCP 服务 **`mcp-api-suite`** 上调用 **`callApi`**，请求体为 JSON，至少包含：

| 字段 | 含义 |
|------|------|
| `apiName` | 接口名（下表） |
| `params` | 参数对象（**不含** `datasourceId`） |

### 2.1 按会员查智慧购订单列表（辅助拿单号）

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listMemberZhgMallOrdersByVipId` |
| `params` 必填 | `vipId` |
| `params` 可选 | `beginDate`（ISO 日期，如 `"2025-01-01"`） |
| 返回 | `{ "items": [ ... ] }`，含 `orderCode`、`saleOrRefund` 等 |

### 2.2 查询销售单明细（消费单）

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `getZhgMallSaleOrderDetail` |
| `params` 必填 | `orderCode`（**销售单号**，`order.code`） |
| 返回 | `{ "order": {...} \| null, "lines": [...] }`，字段见 **1.1** |

### 2.3 查询退货单明细

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `getZhgMallRefundOrderDetail` |
| `params` 必填 | `orderCode`（**退货单号**，`refund.code`） |
| 返回 | `{ "order": {...} \| null, "lines": [...] }`，字段见 **1.2** |

### 2.4 并行查询销售单与退货单并合并返回

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `getZhgMallOrderDetail` |
| `params` 必填 | `orderCode` |
| 返回 | `{ "orderCode", "sale": {...}, "refund": {...} }`，字段见 **1.3** |

示例（销售单明细）：

```json
{
  "apiName": "getZhgMallSaleOrderDetail",
  "params": {
    "orderCode": "ORD20260429001"
  }
}
```

示例（合并查询）：

```json
{
  "apiName": "getZhgMallOrderDetail",
  "params": {
    "orderCode": "ORD20260429001"
  }
}
```

## 3 术语

- **ZHG**：智慧购 MySQL 数据源，由服务端固定。
- **销售单号**：`order.code`，与列表中 `saleOrRefund` 为「消费」的 `orderCode` 一致。
- **退货单号**：`refund.code`，与列表中「退货」的 `orderCode` 一致；**不等于**原销售单号时，应用 **2.3** 或合并接口的 `refund` 分支。
- **原销售单号**：退货头字段 `originOrderCode`（`refund.order_code`），用于人工对照，本注册表未提供「仅按原单号列出所有退货单」的单独接口。

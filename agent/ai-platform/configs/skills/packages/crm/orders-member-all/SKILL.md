---
name: orders.member-all
skill_id: orders.member-all
description: 会员聚合订单查询（CRM + 停车 + 智慧购）。当用户需要一次性获取会员在多个业务域的订单并按分块结果消费时触发此 Skill。
version: "1.0.0"
category: crm
tags:
  - 会员
  - 订单
  - 聚合订单
  - vipId
  - CRM
  - 停车
  - 智慧购
  - orders.member-all
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
      description: 会员聚合订单接口名（二选一，入参与返回相同）
      enum:
        - listMemberOrdersByVipId
        - listMemberAllOrdersByVipId
    params:
      type: object
      additionalProperties: false
      description: 聚合订单参数，勿传 datasourceId 或 serviceName
      properties:
        vipId:
          type: string
          description: 会员编号
        beginDate:
          type: string
          description: 起始日期（ISO 日期，如 2025-01-01），可选
  required:
    - apiName
    - params
---

# 会员聚合订单（orders.member-all）

本文档供 **WorkBuddy / QwenPaw** 生成 Skill 使用：描述聚合接口 `listMemberOrdersByVipId`（及等价别名 `listMemberAllOrdersByVipId`）的返回分块结构，以及如何通过 MCP 工具 **`callApi`** 调用。

## MCP 与调用前提

- WorkBuddy / QwenPaw 中已配置 MCP 服务，**名称为 `mcp-api-suite`**（与下文的工具调用对应）。
- 所有接口均通过该服务上的工具 **`callApi`** 调用：传入 **`apiName`**（字符串）与 **`params`**（对象）。
- **`params` 必须是对象**，不要写成 JSON 字符串（错误示例：`"params": "{\"vipId\":\"...\"}"`）。
- 进程内查询时不要传 **`serviceName`**，或传空/省略。
- **`params` 中不需要、也不要传 `datasourceId`**（由服务端按模块固定到 CRM / ZHG）。

## 会员身份前提

- 本 Skill 的接口均以 **`vipId`（会员编号）** 为查询条件。
- 若用户仅提供手机号、会员卡号等，**先**通过 `member.profile` Skill 解析出 `vipId`，再调用本 Skill 查询聚合订单。

## 1 接口说明

### 1.1 接口名

以下 **`apiName` 二选一**，入参与返回结构**完全相同**：

- `listMemberOrdersByVipId`（沿用原名）
- `listMemberAllOrdersByVipId`（语义化别名，便于 Skill / 编排里区分「全量订单聚合」）

### 1.2 入参（`params`）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `vipId` | `string` | 是 | 会员编号 |
| `beginDate` | `string` | 否 | ISO 日期字符串，如 `2025-01-01` |

## 2 返回结构（分块隔离）

返回对象不是扁平 `items`，而是按业务域分块：

- `crmOrders`
  - `posPadOrders`: POS/PAD 列表
  - `miniProgramOrders`: 小程序收单列表
  - `mallCirclePointsOrders`: 商圈积分列表
  - `manualSupplementOrders`: 手工补分列表
  - `supermarketOrders`: 超市订单列表（`hyxfjl_wxt`）
  - `all`: 上述 5 类 CRM 列表合并并按 `saleTime` 倒序
- `parkingOrders`: 停车订单列表
- `zhgOrders`: 智慧购订单列表

### 2.1 CRM 订单字段（`crmOrders.*`）

`crmOrders.posPadOrders` 是一个数组（列表）。  
`crmOrders.miniProgramOrders`、`crmOrders.mallCirclePointsOrders`、`crmOrders.manualSupplementOrders`、`crmOrders.supermarketOrders`、`crmOrders.all` 也都是同结构的数组。

下面表格描述的是**这些数组中每个元素**的字段结构：

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderSourceName` | `string` | 订单来源 |
| `orderNo` | `string` | 订单号（`mdid-sktno-jlbh`） |
| `storeId` | `string \| null` | 门店 id |
| `storeName` | `string \| null` | 门店名称 |
| `terminalNo` | `string \| null` | 机台号 |
| `receiptNo` | `string \| null` | 小票号 |
| `saleOrRefund` | `string \| null` | 消费/退货 |
| `saleTime` | `string` | 交易时间 |
| `saleAmount` | `number` | 交易金额 |
| `fee` | `number` | 附加费 |
| `vipPoints` | `number` | 本单积分 |
| `saleStatus` | `string \| null` | 交易状态 |

### 2.2 停车订单字段（`parkingOrders`）

`parkingOrders` 是一个数组（列表）。  
下面表格描述的是**数组中每个元素**的字段结构：

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderSourceName` | `string` | 来源（停车订单） |
| `storeId` | `string \| null` | 门店 id |
| `storeName` | `string \| null` | 门店名称 |
| `orderCode` | `string \| null` | 订单号（`fee_id`） |
| `parkingAmount` | `number` | 应收金额 |
| `payAmount` | `number` | 实付金额 |
| `entryTime` | `string \| null` | 入场时间 |
| `outTime` | `string \| null` | 出场时间 |

### 2.3 智慧购订单字段（`zhgOrders`）

`zhgOrders` 是一个数组（列表）。  
下面表格描述的是**数组中每个元素**的字段结构：

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderSourceName` | `string` | 来源（智慧购订单） |
| `saleOrRefund` | `string \| null` | 消费/退货 |
| `orderCode` | `string \| null` | 订单号 |
| `storeId` | `string \| null` | 门店 id |
| `storeName` | `string \| null` | 门店名称 |
| `createTime` | `string` | 创建时间 |
| `successTime` | `string \| null` | 成功时间 |
| `amount` | `number` | 金额 |
| `fee` | `number` | 运费 |
| `status` | `string \| null` | 状态文案 |

## 3 能力清单（工具 `callApi`）

在 MCP 服务 **`mcp-api-suite`** 上调用 **`callApi`**，请求体为 JSON，至少包含：

| 字段 | 含义 |
|------|------|
| `apiName` | `listMemberOrdersByVipId` 或 `listMemberAllOrdersByVipId` |
| `params` | `vipId` 必填；`beginDate` 可选（**不含** `datasourceId`） |

### 3.1 按会员编号查询聚合订单

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listMemberOrdersByVipId`（或别名 `listMemberAllOrdersByVipId`） |
| `params` | `vipId`（必填）；`beginDate`（可选） |
| 返回 | 分块对象，字段见 **§2** |

调用示例：

```json
{
  "apiName": "listMemberOrdersByVipId",
  "params": {
    "vipId": "10001",
    "beginDate": "2025-01-01"
  }
}
```

等价别名示例：

```json
{
  "apiName": "listMemberAllOrdersByVipId",
  "params": {
    "vipId": "10001",
    "beginDate": "2025-01-01"
  }
}
```

## 4 说明

- 该接口用于「聚合展示」，便于按块渲染不同来源订单；回答时建议分 CRM / 停车 / 智慧购 三块摘要，必要时再展开 `crmOrders.all` 或分项列表。
- 如只需要某单一来源，建议直接调用对应分项接口（CRM / 停车 / 智慧购文档中的接口）。
- 若需要 **CRM 侧单笔订单头 + 商品明细**（含超市），见 **`orders-detail.crm`** 中的 `getMemberCrmPosOrderDetail` 与 `listMemberCrmPosOrdersWithLinesByVipId`（本 Skill 不覆盖）。
- **会员 / CRM / ZHG 数据源**由服务端固定，调用方**勿**在 `params` 中传 `datasourceId`。

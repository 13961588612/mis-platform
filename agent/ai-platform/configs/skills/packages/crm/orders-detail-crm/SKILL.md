---
name: orders-detail.crm
skill_id: orders-detail.crm
description: CRM 订单详情（单笔按单号/机台；或按会员+日期批量头+行）。当用户需要 百购POS/PAD、小程序收单、商圈积分、手工补分、超市 的订单头与商品明细时触发此 Skill。
version: "1.0.0"
category: crm
tags:
  - 会员
  - 订单
  - 订单详情
  - 商品明细
  - vipId
  - CRM
  - POS
  - 超市
  - orders-detail.crm
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
      description: CRM 订单详情域接口名
      enum:
        - getMemberCrmPosOrderDetail
        - listMemberCrmPosOrdersWithLinesByVipId
    params:
      type: object
      additionalProperties: false
      description: CRM 订单详情参数，勿传 datasourceId 或 serviceName
      properties:
        orderSourceName:
          type: string
          description: 订单来源（仅 getMemberCrmPosOrderDetail 必填）
        orderCode:
          type: string
          description: 订单号（与列表 orderNo 一致）；与 storeId+terminalNo 二选一
        storeId:
          type: string
          description: 门店 mdid；与 terminalNo 成对使用
        terminalNo:
          type: string
          description: 机台号 sktno
        receiptNo:
          type: string
          description: 小票号 jlbh（可选）
        vipId:
          type: string
          description: 会员编号（仅 listMemberCrmPosOrdersWithLinesByVipId 必填）
        beginDate:
          type: string
          description: 起始日期（ISO，可选；仅批量接口）
  required:
    - apiName
    - params
---

# CRM 订单详情（orders-detail.crm）

本文档供 **WorkBuddy / QwenPaw** 生成 Skill 使用：描述 CRM 订单详情字段，以及如何通过 MCP 工具 **`callApi`** 查询**单笔**订单头与商品明细，或按 **`vipId` + `beginDate`** 一次拉取多笔订单（头+行）。

## MCP 与调用前提

- WorkBuddy / QwenPaw 中已配置 MCP 服务，**名称为 `mcp-api-suite`**（与下文的工具调用对应）。
- 所有接口均通过该服务上的工具 **`callApi`** 调用：传入 **`apiName`**（字符串）与 **`params`**（对象）。
- **`params` 必须是对象**，不要写成 JSON 字符串。
- 进程内查询时不要传 **`serviceName`**，或传空/省略。
- **会员域**接口的 **`params` 中不需要、也不要传 `datasourceId`**（CRM 数据源由服务端固定）。

## 会员身份前提（批量接口）

- `listMemberCrmPosOrdersWithLinesByVipId` 以 **`vipId`** 为条件。
- 若用户仅提供手机号、会员卡号等，**先**通过 `member.profile` 解析出 `vipId`，再调用本 Skill。
- 聚合列表（无明细）见 `orders.member-all`；本 Skill 负责**头 + 商品行**。

## 1 数据与字段说明

### 1.1 CRM 订单详情（`MemberCrmPosOrderDetailResult`）

返回结构为：
- `order`：订单头（对象；查不到时为 `null`）
- `lines`：商品行数组

#### 订单头（`order`）

与代码类型 `MemberCrmPosOrderHeader`（`src/modules/membership/data/member.order-detail.ts`）一致。

| 字段 | 类型 | 含义 |
|------|------|------|
| `orderSourceName` | `string` | 来源文案（与入参 `orderSourceName` 解析后的字面量一致，如 `百购POS/PAD`、`小程序收单`、`商圈积分`、`手工补分`） |
| `orderCode` | `string` | 订单号（`sktno` + `-` + `jlbh`） |
| `storeId` | `string \| null` | 门店编码（`mdid`） |
| `storeName` | `string \| null` | 门店名称（`mdmc`） |
| `saleTime` | `string` | 交易时间 |
| `saleAmount` | `number` | 交易金额 |
| `fee` | `number` | 运费 |
| `vipPoints` | `number` | 本单积分 |
| `saleStatus` | `string \| null` | 交易状态（当前多为「交易完成」） |
| `saleOrRefund` | `string \| null` | `消费` / `退货`（由金额正负推断） |
| `terminalNo` | `string \| null` | 机台号（`sktno`） |
| `receiptNo` | `string \| null` | 小票号（`jlbh`；库内为空时返回 `null`） |
| `counterCode` | `string \| null` | 收款员编码（`skydm`） |
| `specialPointsDefineBillNo` | `string \| null` | 特殊积分定义单号（`tdjfdydbh` > 0 时取原值，否则 `null`） |
| `vipSaleId` | `string \| null` | 销售流水主键（`xfjlid`；用于拉取商品行） |
| `memberCardNo` | `string \| null` | 会员卡号（`hyk_no`） |
| `vipId` | `string \| null` | 会员编号（`hyid`） |

#### 商品行（`lines[]`）

与代码类型 `MemberCrmPosOrderLine` 一致。明细来自 `hyxfjl_sp` ∪ `hyk_xfjl_sp` ∪ `hyxfjl_sp_wxt`（超市）；百购两分支经 `shbm`、`hyk_zsfl_pp` 与两级 `hyk_zsfl` 带出品牌与一二三级品类；超市分支无品类维表关联时，品牌与三类目列均为字面量「超市」。**按 `goodsCode` 升序**排列。

| 字段 | 类型 | 含义 |
|------|------|------|
| `goodsCode` | `string \| null` | 商品编码 |
| `goodsName` | `string \| null` | 商品名称 |
| `amount` | `number` | 金额 |
| `total` | `number` | 数量 |
| `points` | `number` | 本行积分合计（`jf`）；业务口径为 基础积分 + 促销积分；基础积分无独立返回字段，促销部分见 `promotionPoints` |
| `promotionPoints` | `number` | 促销积分（`cxjf`，空作 `0`）：多倍积分活动中额外赠送给顾客的分 |
| `multiple` | `number` | 积分倍率（`bs`）；大于 1 表示存在消费多倍积分活动 |
| `pointsDefineBillNo` | `string \| null` | 积分定义单号（`jfdydbh`） |
| `brand` | `string \| null` | 品牌（超市明细为「超市」） |
| `tertiaryCategory` | `string \| null` | 三级品类(小分类)名称（超市为「超市」） |
| `secondaryCategory` | `string \| null` | 二级品类(小分类)名称（超市为「超市」） |
| `primaryCategory` | `string \| null` | 一级品类(小分类)名称（超市为「超市」） |

### 1.2 按会员批量（`MemberCrmPosOrderDetailBatchItem[]`）

接口 `listMemberCrmPosOrdersWithLinesByVipId` 的返回为**数组**，每个元素：

| 字段 | 类型 | 含义 |
|------|------|------|
| `order` | 对象 | 与 **1.1** 中订单头 `MemberCrmPosOrderHeader` 相同（单笔场景里 `order` 可为 `null`；批量接口里每项必有 `order`） |
| `lines` | 数组 | 与 **1.1** 中 `MemberCrmPosOrderLine` 相同；该单无商品行时为 `[]` |

整体顺序：按 `order.saleTime` **降序**；同一单内 `lines` 按 `goodsCode` **升序**。

## 2 能力清单 — CRM 订单详情（工具 `callApi`）

在 MCP 服务 **`mcp-api-suite`** 上调用 **`callApi`**，请求体为 JSON，至少包含：

| 字段 | 含义 |
|------|------|
| `apiName` | 接口名 |
| `params` | 参数对象（**不含** `datasourceId`） |

### 2.1 查询单笔订单头与商品行

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `getMemberCrmPosOrderDetail` |
| `params` 必填 | `orderSourceName` |
| `params` 条件键 | **二选一**：① `orderCode`（与列表 `orderNo` 一致）；② **`storeId` + `terminalNo`** 必填成对（可选 `receiptNo`）。`storeId` 为门店 `mdid`，与列表 `storeId` 或 `orderNo` 首段一致。 |
| `orderSourceName` 允许值 | `百购POS/PAD`、`百购POS/PAD订单`、`百购pos/pad`、`百购pos/pad订单`（大小写不敏感）、`小程序收单`、`商圈积分`、`手工补分`、`超市订单`；未知值接口会报错 |
| 返回 | `{ "order": {...} \| null, "lines": [...] }`，字段见 **1.1** |

示例：

```json
{
  "apiName": "getMemberCrmPosOrderDetail",
  "params": {
    "orderSourceName": "百购POS/PAD",
    "orderCode": "1001-01-100233"
  }
}
```

示例（无 `orderCode`，用门店 + 机台，建议再传 `receiptNo`）：

```json
{
  "apiName": "getMemberCrmPosOrderDetail",
  "params": {
    "orderSourceName": "百购POS/PAD",
    "storeId": "1001",
    "terminalNo": "01",
    "receiptNo": "100233"
  }
}
```

### 2.2 按 `vipId` + `beginDate` 批量查询（单笔 SQL：头 + 商品行）

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listMemberCrmPosOrdersWithLinesByVipId` |
| `params` 必填 | `vipId` |
| `params` 可选 | `beginDate`（ISO 日期/时间字符串；省略时 SQL 使用 `NVL(?, …)` 默认下界，与 CRM 列表订单接口一致） |
| 覆盖来源 | `hyxfjl`（lyid 0/1/3/4）、`hyk_xfjl` 同 lyid、`hyxfjl_wxt`（超市）；时间列分别为 `crmjzrq` / `xfsj` / `crmjzrq` |
| 返回 | **`MemberCrmPosOrderDetailBatchItem[]`**，见 **1.2** |

示例：

```json
{
  "apiName": "listMemberCrmPosOrdersWithLinesByVipId",
  "params": {
    "vipId": "10001",
    "beginDate": "2025-01-01"
  }
}
```

## 3 术语

- **订单来源**：`orderSourceName` 经 `resolveCrmPosOrderByOrderSourceName` 映射为 `lyid`（`POS/PAD` 与 `POS/PAD订单` 均为 `lyid=0`），再查 `hyxfjl` ∪ `hyk_xfjl` 订单头。
- **订单号 / 门店+机台**：`orderCode` 与列表 `orderNo` 一致，为 `门店id-机台号-小票号`；若不传 `orderCode`，须同时传 **`storeId`（mdid）** 与 **`terminalNo`**，可选 **`receiptNo`**（与头 SQL 中可选条件一致）。
- **商品行**：以订单头返回的 **`vipSaleId`（`xfjlid`）** 绑定明细 SQL（`hyxfjl_sp` / `hyk_xfjl_sp` / `hyxfjl_wxt_sp` 三分支各一占位，同一值传三次）。
- **批量头+行**：`listMemberCrmPosOrdersWithLinesByVipId` 在库侧用一条 SQL 将头与行扁平行返回，再在服务端按 `vipSaleId`（否则 `orderCode`）聚合成 **1.2** 的数组结构。
- **会员数据源**：由服务端固定为 **`crm`**，调用方**勿**在 `params` 中传 `datasourceId`。

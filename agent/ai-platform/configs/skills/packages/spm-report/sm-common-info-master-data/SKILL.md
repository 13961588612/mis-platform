---
name: sm-common-info-master-data
skill_id: sm-common-info-master-data
description: 超市（大统华）基础资料查询（区域、门店、有权限门店、分类层级与树）。当用户需要查门店列表、区域、自己能看哪些店、商品分类/部门/柜组/大中小类、按编号查分类或查下级分类时触发。禁止用知识库回答门店清单。
version: "1.0.2"
category: supermarket
tags:
  - 超市
  - 大统华
  - 门店
  - 区域
  - 分类
  - 主数据
  - sm-common-info-master-data
source: package
status: active
timeout: 30
requires_approval: false
required_permissions:
  - spm:report:read
handler: mcp:mcp-sm-api-suite:callCommonInfoApi
mcp_server: mcp-sm-api-suite
---

# 基础资料查询（sm-common-info-master-data）

通过 MCP 工具 **`callCommonInfoApi`** 查询区域、门店、分类等基础资料。

---

## MCP 与调用前提

- MCP 服务已配置，名称为 **`mcp-sm-api-suite`**
- 基础资料一律通过工具 **`callCommonInfoApi`** 调用（**不是** `callShopSaleApi`；平台工具名形如 `mcp__mcp-sm-api-suite__callCommonInfoApi`）
- 传入 **`apiName`**（字符串）与 **`params`**（对象）
- **不要传 `serviceName`**，或传空/省略
- **不要**在 `params` 里传 `datasourceId`（数据源由服务端固定为 StarRocks）
- **不要传、不要构造 `identity`**：调用方身份由 MCP 调用链自动注入，大模型无需关心

---

## 1 数据与字段说明

### 1.1 区域（AreaInfo）

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `areaId` | `string` | 区域编号（库字段 `aeraid`） | 否 | `"01"` |
| `areaname` | `string` | 区域名称 | 否 | `"东区"` |

### 1.2 门店（StoreInfo）

在营超市口径：`shopstatus = 0` AND `shoptype = 11` AND `store_name NOT LIKE '%香烟%'`。

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `storeId` | `string` | 门店号 | 否 | `"6001"` |
| `storeName` | `string` | 门店名称（短名） | 否 | `"朝阳社区店"` |
| `shoplevel` | `string` | 店型编号 | 否 | `"1"` |
| `shoplevelname` | `string` | 店型名称 | 否 | `"社区店"` |
| `areaId` | `string` | 区域编号 | 否 | `"01"` |
| `areaname` | `string` | 区域名称 | 否 | `"东区"` |

### 1.3 分类级别（CategoryLevel）

体系约定：`deptlevelid` — **部门(0)** / 柜组(1) / 大类(2) / 中类(3) / 小类(4)。

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `deptLevelId` | `string` | 分类级别编码 | 否 | `"0"` |
| `deptLevelName` | `string` | 级别名称 | 否 | `"部门"` |

### 1.4 分类（CategoryInfo）

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `categoryId` | `string` | 分类编号 | 否 | `"1024107"` |
| `categoryName` | `string` | 分类名称 | 否 | `"瓜果类"` |
| `deptLevelId` | `string` | 分类级别 | 否 | `"3"` |
| `deptLevelName` | `string` | 级别名称 | 否 | `"中类"` |
| `parentCategoryId` | `string \| null` | 父分类代码 | 是 | `"1024"` |

> **聚合铁律（后续销售分析也适用）**：按类目汇总时一律 `GROUP BY categoryId, categoryName`，禁止只按名称分组（存在同名不同 id）。

---

## 2 能力清单（工具 `callCommonInfoApi`）

请求体至少包含：

| 字段 | 含义 |
|------|------|
| `apiName` | 下表「接口名」 |
| `params` | 各接口参数对象；无参传 `{}` |

通用成功列表示例：

```json
{
  "items": [ /* 见各字段表 */ ]
}
```

---

### 2.1 查询所有区域

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listAreas` |
| `params` | `{}` |
| 返回 | `{ items: AreaInfo[] }`，字段见 **1.1** |
| 权限 | 无 |

```json
{ "apiName": "listAreas", "params": {} }
```

---

### 2.2 查询所有门店

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listStores` |
| `params` | `{}` |
| 返回 | `{ items: StoreInfo[] }`，字段见 **1.2** |
| 权限 | 无（全量在营超市门店） |

```json
{ "apiName": "listStores", "params": {} }
```

---

### 2.3 查询有权限的门店列表

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listAuthorizedStores` |
| `params` | `{}` |
| 返回 | `{ items: StoreInfo[]; userId; resolvedBy; notice }`，字段见 **1.2**（仅当前用户权限内门店） |
| 权限 | **有**（服务端按自动注入的身份过滤；大模型无需传身份参数） |

**使用建议：**

- 用户问「我能看哪些店 / 我的门店权限」→ 用本接口，**不要**用 `listStores`
- 后续销售查询选店前，优先用本接口结果中的 `storeId`
- 人员在权限库找不到时：**不报错**，`items=[]`，读 `notice` 提示用户

```json
{ "apiName": "listAuthorizedStores", "params": {} }
```

---

### 2.4 查询所有分类级别

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listCategoryLevels` |
| `params` | `{}` |
| 返回 | `{ items: CategoryLevel[] }`，字段见 **1.3** |
| 权限 | 无 |

```json
{ "apiName": "listCategoryLevels", "params": {} }
```

---

### 2.5 查询所有部门分类（可按级别过滤）

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listCategories` |
| `params` | 可选 `deptLevelId`（`"0"` 部门 / `"1"` 柜组 / `"2"` 大类 / `"3"` 中类 / `"4"` 小类） |
| 返回 | `{ items: CategoryInfo[] }`，字段见 **1.4** |
| 权限 | 无 |

```json
{ "apiName": "listCategories", "params": {} }
```

```json
{ "apiName": "listCategories", "params": { "deptLevelId": "2" } }
```

---

### 2.6 根据分类编号查询分类信息

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `getCategoryById` |
| `params` | `categoryId`（必填） |
| 返回 | 单条 `CategoryInfo`；未找到 `{ "found": false }` |
| 权限 | 无 |

```json
{
  "apiName": "getCategoryById",
  "params": { "categoryId": "1024107" }
}
```

---

### 2.7 查询指定分类的下级分类

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listChildCategories` |
| `params` | `categoryId`（父分类编号，必填） |
| 返回 | `{ items: CategoryInfo[] }` |
| 权限 | 无 |

```json
{
  "apiName": "listChildCategories",
  "params": { "categoryId": "1024" }
}
```

---

### 2.8 查询所有顶级分类

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listTopCategories` |
| `params` | `{}` |
| 返回 | `{ items: CategoryInfo[] }`（`deptLevelId = "0"`，即**部门**级） |
| 权限 | 无 |

```json
{ "apiName": "listTopCategories", "params": {} }
```

---

### 2.9 查询所有部门级别分类

| 项目 | 说明 |
|------|------|
| 接口名 `apiName` | `listDeptLevelCategories` |
| `params` | `{}` |
| 返回 | **与 `listTopCategories` 完全相同**（`deptlevelid = 0` / 同出参） |
| 权限 | 无 |

```json
{ "apiName": "listDeptLevelCategories", "params": {} }
```

---

## 3 选用指引

| 用户意图 | 推荐 `apiName` |
|----------|----------------|
| 有哪些区域 | `listAreas` |
| 全部超市门店（不鉴权） | `listStores` |
| 我能看哪些门店 / 权限内门店 | `listAuthorizedStores` |
| 分类有几级 / 级别字典 | `listCategoryLevels` |
| 拉全部分类或某一级分类 | `listCategories`（可选 `deptLevelId`） |
| 某个分类编号是什么 | `getCategoryById` |
| 某分类下面有哪些子类 | `listChildCategories` |
| 顶级 / 部门级分类树根 | `listTopCategories` 或 `listDeptLevelCategories` |
| 某年有哪些天 / 周 / 月、周月起止日 | 见 Skill **`sm-common-info-calendar`**（`listYearDates` / `listYearWeeks` / `listYearMonths`） |

---

## 4 系统辅助接口（同工具，一般不问业务时不用）

| `apiName` | 说明 |
|-----------|------|
| `commonInfoHealthCheck` | 模块健康检查 |
| `listDatasources` | 数据源列表 |
| `ping` | `params.datasourceId` 连通性 |
| `echo` | `params.message` 回显 |

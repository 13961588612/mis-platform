# CRM callApi 调用约定

## MCP 连接

- **MCP 服务名**：`mcp-api-suite`
- **工具名**：`callApi`
- **请求体**：`{ "apiName": "<接口名>", "params": { ... } }`

## 约束

- 勿传 `serviceName`
- 会员域 **勿传 `datasourceId`**

## 身份字段默认约定

- 用户只给一串数字且未说明字段类型时，优先这样理解（查不到可换一种再试）：11 位且以 1 开头（如 139）按手机号调用 `getMemberProfileByMobile`；以 8 开头按会员卡号调用 `getMemberProfileByMemberCardNo`
- 用户明确为会员编号/卡号/车牌时，改用对应 Skill

## 档案返回字段（1.1）

| 字段 | 含义 |
|------|------|
| vipId | 会员编号 |
| memberCardNo | 会员卡号 |
| userName | 会员姓名 |
| sex | 性别 |
| birthday | 生日 |
| cardTypeName | 卡类型 |
| mobile | 手机号 |
| storeName | 归属门店 |
| registeTime | 注册时间 |
| plateNoList | 绑定车牌列表 |

## 变更记录返回字段（1.2）

| 字段 | 含义 |
|------|------|
| vipId | 会员编号 |
| birthday | 变更后生日 |
| change_day | 变更日期 |

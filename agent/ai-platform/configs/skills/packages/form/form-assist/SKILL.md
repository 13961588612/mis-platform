---
name: form-assist
skill_id: form-assist
description: 业务表单辅助录入（挂在 mis-extract）。当用户在填单页上传文档/图片或用自然语言描述单据内容时使用：按给定 schema 的 key 抽取字段，只输出 JSON。
version: "1.0.0"
category: form
tags:
  - 表单
  - 填单
  - 辅助录入
  - form-assist
source: package
status: active
timeout: 120
requires_approval: false
---

# 表单辅助录入（form-assist）

本 Skill **不调业务写接口**，不发起流程。只从用户文字与附件中抽出字段。

## 输入（由填单页注入，必须遵守）

用户消息里会给出：

- `formCode`
- `schema`：数组，每项含 `key`、`label`、`type`、可选 `options: [{value,label}]`
- `current_values`：当前表单已填值（可覆盖）
- 用户说明与附件（PDF / 图片 / Office / 文本）

## 输出（唯一允许的最终回复形态）

只输出一个 JSON 对象（可包在 ` ```json ` 代码块中），形状：

```json
{
  "fields": {
    "<schema.key>": "<value>"
  }
}
```

可选：`"confidence": { "<key>": 0.0 }`（0～1）。抽不出的字段不要写进 `fields`。

## 对应规则

- JSON 的键 **必须等于** `schema[].key`（如 `orderNo`），禁止用中文 `label` 当键。
- 禁止嵌套对象。表单数据是扁平的。
- `select`：写入 `options.value`（如 `HIGH`），不要写 `高`。
- `multi`：`options.value` 的数组。
- `number`：纯数字，无千分位、无「元」。
- `date`：`YYYY-MM-DD`。
- `bool`：`true` / `false`。
- 没有依据不要编造。

## 禁止

- 不要调用保存单据、发起审批、改流程的工具。
- 不要输出表格、Markdown 报告或与 JSON 无关的长说明（代码块外最多一行）。

# MIS 平台项目记忆

## 门户原型与系统管理单文件集成
- 门户原型：`docs/frontend/design-proposal/mis-portal-prototype.html`（登录→门户→子系统，含 Light/Dark、流程中心、系统管理）。
- 系统管理（14 页 CRUD）已**合并进**门户「系统管理」子系统（单文件，数据驱动引擎 `sa*` 命名空间 + `.sa-app` 作用域 CSS + `sa-` 前缀持久 overlay）。
- 改 SA 引擎后重做单文件集成：编辑 `.workbuddy/_sa_engine.js` 与 `.workbuddy/_sa_css.css`，再 `node .workbuddy/_splice.js`（会先 `git restore` 门户到干净态再注入，避免重复合并）；回归测试 `node .workbuddy/_smoke.js`（需 jsdom，装在 `node/workspace`）。
- 注意：`sa-` 前缀转换要同步改「查询选择器」与「HTML 字符串里的 id」；调用 `toast(` 改名 `saToast(` 时必须同时补 `saToast` 定义；overlay 必须放在 `#view-subsystem` 之外（门户 `buildChrome` 会重写内部 overlay）。详见 2026-07-20 日志。

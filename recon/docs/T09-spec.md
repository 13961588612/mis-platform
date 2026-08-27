# T09 前端规格（recon-admin-web）

> 归属：架构师锁定（高见远）→ 前端实施
> 版本：v1.0（2026-08-14）
> 前置：T01~T06 后端已交付（6 控制器 API 全部可用）；原型 v5.5 为交互参考；mis-admin-web 为技术栈参考
> 验收模式：**页面完整配置 → 实库验收**（用户拍板：不做 curl 级验收，待前端完成后在页面配置完整数据源/场景/检查并触发对账）

---

## 1. 目标与验收

**目标**：把 v5.5 演示原型升级为对接真实 API 的对账平台管理后台，4 个核心页面真实读写后端（连接/数据源/场景与检查/差异查询），2 个页面保留占位（报告/运行监控，标注「T07 后接入」）。

**验收标准**（与后端实库验收联动，T05/T06 验收序列改由页面执行）：
1. **配置链路**：页面创建连接 → 测试连接（真实连通性反馈）→ 创建数据源（含取数 SQL/字段/金额声明 JSON）→ 创建场景 → 创建检查（consume/match/compare 规则 JSON）→ 列表/详情回显正确；
2. **运行链路**：页面触发手动拉取（数据源页）→ 触发对账（场景页）→ 差异页实时查询并复核（状态/类型/匹配键筛选 + 统计条）；
3. **T06 行为可观测**：对账运行记录（running/success/failed/skipped）在场景页可见；差异 pending/confirmed 状态流转可在差异页看到；
4. **构建**：`pnpm build`（tsc --noEmit + vite build）零错误；`pnpm lint` 零 error。

---

## 2. 工程与技术栈

| 项 | 决策 |
|---|---|
| 工程位置 | `D:/work/mis-platform/recon/recon-admin-web/`（与 recon-service 同级，recon 子平台自包含；技术栈参考同仓库 frontend/mis-admin-web，不共用 node_modules） |
| 技术栈 | **React 18 + TypeScript 5 + Vite 5 + Tailwind 3 + shadcn/ui（Radix）**，与 mis-admin-web 同栈（用户拍板参考） |
| 状态管理 | TanStack Query（服务端状态）+ zustand（UI 状态，如侧栏折叠/筛选暂存） |
| 校验 | zod（配置表单校验，前端先校验再提交，后端 V20~V35 仍兜底） |
| HTTP | axios 实例 + 统一 ApiResponse<T> 解包 + 错误 toast（sonner） |
| 路由 | react-router-dom v6，布局=侧栏 + 顶栏 + 内容区 |

**目录骨架**（与 mis-admin-web 对齐）：

```
recon-admin-web/
├── src/
│   ├── app/                # 路由表（RouterProvider）
│   ├── components/
│   │   ├── layout/         # AppLayout（侧栏/顶栏/面包屑）
│   │   └── ui/             # shadcn/ui 基础组件
│   ├── features/
│   │   ├── connections/    # 连接管理页
│   │   ├── datasources/    # 数据源管理页
│   │   ├── scenarios/      # 场景与检查页
│   │   ├── diffs/          # 差异查询页
│   │   ├── reports/        # 报告页（占位）
│   │   └── monitor/        # 运行监控页（占位）
│   ├── lib/api/            # axios 封装 + 各域 API 函数 + 类型
│   ├── lib/query/          # QueryClient 配置
│   ├── stores/             # zustand
│   ├── types/              # 共享类型（API DTO 镜像）
│   └── styles/             # globals.css（令牌映射）
```

---

## 3. 页面清单与路由

| 路由 | 页面 | 后端对接 | 原型对应 Tab |
|---|---|---|---|
| `/connections` | 连接管理 | ✅ 真实 CRUD + 测试连接 | Tab A |
| `/datasources` | 数据源管理 | ✅ 真实 CRUD + 测试 + 手动拉取 + 试拉 | Tab B |
| `/scenarios` | 场景与检查 | ✅ 真实 CRUD（场景 + 检查两段式） + 触发对账 | Tab C |
| `/diffs` | 差异查询 | ✅ 真实列表 + 统计条（只读，处理操作 T07 后接入） | Tab D |
| `/reports` | 报告中心 | 🚧 占位（卡片说明 T07 后接入） | Tab E |
| `/monitor` | 运行监控 | 🚧 占位（pull_run/recon_run 时间线，T07 后接入） | Tab F |
| `/` | 重定向 → `/connections` | — | — |

> 差异页对 pending/confirmed 状态**只读展示**（状态机引擎内已判，人工处理属 T07）；「处理」按钮渲染但点击提示「T07 后接入」。

---

## 4. API 对接契约（全部 6 控制器）

**约定**：全局前缀 `/internal/v1/recon`；响应 `{code, message, data}`（code=0 成功，非 0 为业务错误码，message 可直接展示）；分页请求 `page` 1-based、`size≤100`；响应 `{list,total,page,size,pages}`；后端 jackson 全局 snake_case，前端 axios 层**不做命名转换**（直接消费 snake_case JSON，TypeScript 类型用 snake_case 字段镜像）。

### 4.1 连接管理

| 方法 | 路径 | 说明 | 关键字段 |
|---|---|---|---|
| GET | `/connections?page&size` | 连接列表 | — |
| GET | `/connections/{code}` | 连接详情 | — |
| POST | `/connections` | 新建（conn_code 唯一） | `conn_code,name,type(mysql/oracle/postgresql),jdbc_url,username,password,enabled,db_timezone,fetch_overlap_sec` |
| PUT | `/connections/{code}` | 更新 | 同上（password 空串=不改） |
| DELETE | `/connections/{code}` | 删除（被数据源引用 → code=2002 拦截） | — |
| POST | `/connections/{code}/test` | 测试连通 | → 成功 data=连通信息；失败 code=2004+原因 |

### 4.2 数据源管理

| 方法 | 路径 | 说明 | 关键字段 |
|---|---|---|---|
| GET | `/datasources?page&size` | 数据源列表 | — |
| GET | `/datasources/{code}` | 详情 | — |
| POST | `/datasources` | 新建（ds_code 唯一） | `ds_code,name,conn_code,pull_cron,record_key_expression,time_field,fetch_type,grain,key_case_mode,delete_mode,enabled,fetch_config_json,fields_json,health_rules_json,amount_fields_json,refund_sign_rule` |
| PUT | `/datasources/{code}` | 更新 | 同上 |
| DELETE | `/datasources/{code}` | 删除 | — |
| POST | `/datasources/{code}/test` | 试拉探针（回填窗口） | → ProbeResp `{ok,columnCount,sample,message}` |

> JSON 字段在表单中**以文本域编辑**（首次自动格式化缩进，校验 JSON 合法），降低表单复杂度，与原型「高级配置 JSON 编辑」交互一致。

### 4.3 场景与检查

| 方法 | 路径 | 说明 | 关键字段 |
|---|---|---|---|
| GET | `/scenarios?page&size` | 场景列表 | — |
| GET | `/scenarios/{code}` | 详情（含 uses_json） | — |
| POST | `/scenarios` | 新建 | `scenario_code,name,cron_expr,report_cron,enabled,pending_max_wait_hours,pool_max_age_hours,hooks_json` |
| PUT | `/scenarios/{code}` | 更新 | 同上 |
| DELETE | `/scenarios/{code}` | 删除 | — |
| GET | `/checks?scenarioCode&page&size` | 场景下检查列表 | — |
| GET | `/checks/{scenarioCode}/{checkName}` | 检查详情 | — |
| POST | `/checks` | 新建（三表事务：check+match_rule+compare_rule） | `scenario_code,check_name,seq_no,consume_json,match_rule{strategy,datasets_json,key_fields_json},compare_rule{rules_json},enabled` |
| PUT | `/checks/{scenarioCode}/{checkName}` | 更新（check_name 禁改 → code=5002） | 同上 |
| DELETE | `/checks/{scenarioCode}/{checkName}` | 删除 | — |

> 检查表单分三区：基本信息 + 消费清单（consume_json）+ 匹配规则 + 比较规则；JSON 区文本域编辑 + 语法高亮提示。场景详情页展示该场景全部 check 列表与最近 recon_run 状态。

### 4.4 运维触发（Ops）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/ops/pull/{dsCode}` | 手动拉取；body 可选 `{start,end}` 覆盖窗口（yyyy-MM-dd HH:mm:ss） |
| POST | `/ops/recon/{scenarioCode}` | 手动触发对账；body 可选 `{start,end}` 覆盖窗口 |
| POST | `/ops/fetch-one/{dsCode}` | 单条重拉，body `{record_key}` |
| POST | `/ops/probe/{dsCode}` | 试拉（ProbeResp 同数据源 test） |

### 4.5 差异查询（Diff）

| 方法 | 路径 | 参数 | 说明 |
|---|---|---|---|
| GET | `/diffs` | `scenarioCode,checkName,status,diffType,handleStatus,matchKey,dateFrom,dateTo,page,size` | 差异列表（JPA Specification 多条件 AND） |
| GET | `/diffs/stats` | `scenarioCode` | 统计条：`total_unhandled,total_confirmed_unhandled,amount_cent_total,diff_type_ratio` |

**差异列表行字段**（ReconDetailEntity 镜像）：`id, scenario_code, check_name, pair_segment, match_key_hash, match_key_display, raw_key, left_value_json, right_value_json, diff_type(unmatched/field_mismatch/anomaly), status(pending/confirmed/resolved), handle_status(unhandled/handled), diff_amount_cent, diff_desc, diff_diagnosis_json, first_seen_at, updated_at`。

---

## 5. 设计令牌（继承原型 v5.5 + mis-admin-web）

**原则**：复用原型 v5.5 已锁定的视觉语言（indigo 主色 + 浅色管理后台），映射到 shadcn/ui 的 CSS 变量体系（hsl()），保证组件库与令牌兼容。**禁紫粉渐变/AI 模板味**（延续后端 P0 规则；indigo #4F46E5 为原型锁定主色，非渐变，合规）。

| 令牌 | 原型 v5.5 | shadcn 变量映射 |
|---|---|---|
| 主色 | `--primary-600:#4F46E5` | `--primary: 243 75% 59%`（#4F46E5） |
| 主色 hover | `--primary-700:#4338CA` | `--primary-foreground: 0 0% 100%` |
| 页面背景 | `--bg-page:#F7F8FA` | `--background: 220 14% 97%` |
| 卡片/表面 | `--bg-surface:#FFFFFF` | `--card: 0 0% 100%` |
| 次表面 | `--bg-subtle:#F2F3F5` | `--muted: 220 10% 95%` |
| 主文本 | `--text-primary:#1F2328` | `--foreground: 220 12% 15%` |
| 次文本 | `--text-secondary:#5C6368` | `--muted-foreground: 215 8% 40%` |
| 边框 | `--border:#E5E6E8` | `--border: 220 8% 88%` |
| 成功 | 绿 `#16A34A` | `--success: 142 71% 36%` |
| 警告 | 琥珀 `#D97706` | `--warning: 38 92% 44%` |
| 危险 | 红 `#DC2626` | `--destructive: 0 84% 60%` |

**差异状态/类型色板**（差异页用，语义色）：
- status：pending=琥珀、confirmed=红、resolved=绿（后台处理语义：红=待处理差异，绿=已解决）
- diff_type：unmatched=红、field_mismatch=琥珀、anomaly=紫蓝（indigo）

> 金额显示约定（中国习惯）：差异金额 `diff_amount_cent` 为分，页面转元展示（÷100，两位小数）；**涨红跌绿不适用**（对账差异非行情），红=差异需关注。

**侧栏导航**：6 项（连接管理/数据源/场景与检查/差异查询/报告中心/运行监控），图标 lucide-react；激活项左侧 indigo 竖条 + 浅底（同原型 `.nav-item.active`）。

---

## 6. 数据层设计

```ts
// lib/api/client.ts —— axios 实例 + 统一解包
const client = axios.create({ baseURL: '/internal/v1/recon' });
client.interceptors.response.use(
  (res) => {
    const body = res.data as ApiResponse<unknown>;
    if (body.code !== 0) return Promise.reject(new BizError(body.code, body.message));
    return body.data;                 // 直接解包 data，业务代码拿纯数据
  },
  (err) => Promise.reject(new ApiError(err))  // 网络/HTTP 错误统一转换
);

// features/connections/api.ts —— 域 API
export const connectionsApi = {
  list: (params) => client.get<Page<ConnVO>>('/connections', { params }),
  create: (body) => client.post('/connections', body),
  test: (code) => client.post(`/connections/${code}/test`),
  // ...
};
```

- **QueryClient 默认**：`staleTime: 10s`、`retry: 1`（测试连接/触发对账等写操作不用 Query，直接 mutation）；
- **失效策略**：mutation 成功后按域 invalidate（如数据源变更 → 失效 connections 域数据源下拉、场景 uses_json）；
- **zod schema**：连接/数据源/场景/检查 4 张表单各 1 个 schema（必填校验 + JSON 文本域 parse 校验 + tolerance 整数校验镜像 V21），提交前 validate，错误 inline 展示；
- **类型镜像**：`src/types/` 下 DTO 接口与后端字段一一对应（snake_case），从 T03/T05-spec 契约手写（后端无 openapi 生成）。

---

## 7. 联调方式

| 项 | 配置 |
|---|---|
| 后端端口 | 8110（application.yml） |
| Vite dev proxy | `/internal` → `http://localhost:8110`（mis-admin-web 同款 proxy 模式） |
| 启动后端 | `MIS_REMOTE=false` + `DB_HOST=10.254.16.6 DB_PORT=5432 DB_NAME=recon DB_USER=mis DB_PASSWORD=mis123` + `RECON_SCHEDULER_ENABLED=false`（验收期关调度，防 ConfirmJob 干扰）→ `mvn spring-boot:run` |
| 启动前端 | `pnpm dev`（5174 端口，与 mis-admin-web 错开） |
| CORS | 后端已配 `RECON_CORS_ALLOWED_ORIGINS` 默认含 5173/8081，dev 走 proxy 无跨域；如需直连补 5174 |

> 验收期 `RECON_SCHEDULER_ENABLED=false` 避免 Quartz 自动拉取/对账/巡检干扰手动验收序列；验收完开启验证调度链路。

---

## 8. 页面交互要点（继承原型 v5.5 操作流）

1. **连接管理**：表格（code/名称/类型/地址/enabled 开关）→ 行操作[测试][编辑][删除]；新建弹窗表单；测试结果 toast（成功/失败原因）。删除被引用 → 后端 2002 message 含 ds_code，直接展示。
2. **数据源管理**：表格 + 详情抽屉（展示 fetch_config_json/fields_json/health_rules_json/amount_fields_json 格式化 JSON）；行操作[测试][拉取][编辑][删除]；拉取弹窗可选窗口覆盖（默认空=增量续拉）。
3. **场景与检查**：左侧场景列表 + 右侧场景详情（基本信息 + check 列表 + 最近运行记录）；场景操作[新建][编辑][删除][触发对账]；check 行操作[编辑][删除][新增检查]；检查表单三区 JSON 文本域。
4. **差异查询**：筛选条（场景/检查/状态/类型/处理状态/匹配键/日期区间）+ 统计条（未处理总数/已确认未处理/金额合计(元)/类型占比）+ 分页表格（match_key_display/diff_type/status/diff_amount_cent(元)/diff_desc/first_seen_at）+ 行展开看左右值 JSON。
5. **报告/监控占位页**：居中卡片说明「T07 报告与预警交付后接入」，列出将包含内容（日报/周报/渠道/告警），不渲染假数据。

---

## 9. 风险与裁决

| # | 风险/待确认 | 决策 |
|---|---|---|
| 1 | 后端无 OpenAPI/Swagger，类型手写 | 从 T03/T05-spec 契约手写镜像类型；后端字段变更需同步（联调期对齐） |
| 2 | JSON 配置字段（consume_json 等）表单化复杂 | 文本域编辑 + JSON 校验 + 格式化；对象模板/列表兼容等价由后端快照解析兜底（G 裁决已定），前端**统一对象格式**提交 |
| 3 | 差异人工处理未实现（T07） | 差异页只读 + 「处理」按钮占位提示；统计条不渲染「待处理动作」 |
| 4 | 运行监控依赖 pull_run/recon_run 查询端点（T07） | 占位；不 mock 数据（防误当真实） |
| 5 | 与 mis-admin-web 共用 node_modules？ | 不共用，独立 pnpm 工程（避免依赖版本互相污染）；工程放 recon 下与后端同级 |
| 6 | 验收期调度干扰 | RECON_SCHEDULER_ENABLED=false 启动；验收调度链路时再开启 |

---

## 10. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-14 | 初版：T09 前端规格锁定（技术栈参考 mis-admin-web / 4 页真实对接 + 2 页占位 / API 契约 / 令牌映射 / 页面验收联动） | T09 规格锁定，供前端工程师落地 | 全文档 |
| 2026-08-14 | **前端交付完成**：工程 `recon/recon-admin-web`（用户拍板放 recon 下，非 frontend/）；35 个源文件 + 6 控制器 API 层 + 4 页真实对接 + 2 页占位；`pnpm build`（tsc --noEmit + vite build）零错误；dev server 5174 已起（proxy /internal → 8110）。验收模式=页面完整配置（用户拍板）；踩坑：pnpm 10 需 `--store-dir` 本地 store（safe-delete 拦截）、vite 清空 dist 需手动 `rm -rf dist`（bulk guard） | T09 交付完成 | §2/§7/§9 |

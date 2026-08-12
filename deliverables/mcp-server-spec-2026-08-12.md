# 外部 MCP Server 接入 MIS 平台规格说明（实现级）

> **文档性质**：接口契约 / 接入手册（面向第三方开发团队，可直接照此实现）。
> **适用范围**：定义「外部 MCP Server（被连方）」必须实现什么，才能被 MIS 平台的「智能体运营控制台」正常登记、连接、探活、发现工具、被 Agent 调用。
> **约束**：本文所有断言均来自对 `mis-platform` 代码的逆向确认（见各节"依据"）。凡无法从已确认事实推导的内容，一律标注 **「待测 / 需平台侧确认」**，不做臆测。

---

## 1. 概述

### 1.1 目的
给第三方团队一份可执行的接入契约：只要 Server 端满足本文要求的传输实现、MCP 方法与工具定义，就能被平台无改造地纳管。

### 1.2 适用对象
- 计划将自有能力以 MCP Server 形式暴露给 MIS 平台的 backend / 算法 / 工具团队。
- 负责平台侧 MCP 接入排障的运营与 SRE。

### 1.3 平台侧调用拓扑
```
前端 (mis-admin-web / agent-mcp-page.tsx)
   → BFF (mis-admin-bff)
      → ai-platform (FastAPI :8000) 的 GET /api/v1/mcp/* 系列接口
         → ai-platform 作为 MCP client (官方 mcp Python SDK)
            → 你的外部 MCP Server (被连方)
```
- 平台侧 `GET /api/v1/mcp/*` 仅作为管理面（登记 / 连接 / 断开 / 发现 / 授权）入口。
- 真正的 MCP 协议交互（initialize / tools/list / tools/call / 探活）发生在 **ai-platform 的 MCP client ↔ 你的 Server** 之间。
- 平台当前**只使用 tools 能力**（发现与调用工具），不依赖 resources / prompts / completion / sampling / roots / logging。

### 1.4 角色定位
本文档的"你" = 外部 MCP Server 实现方（被连方）。平台侧（`ai-platform` client、`mis-admin-bff`、`mis-admin-web`）不在本文实现范围内，仅作为约束来源被引用。

---

## 2. 支持清单（三种传输方式）

平台客户端按注册时填写的 `transport` 字段选择 SDK 传输（`backend/src/mcp/client.py`）。Server 端必须按所选传输实现对应协议。

| 传输方式 | `transport` 取值 | `endpoint` 含义 | Server 端必须实现的协议 | SDK 调用（平台侧，仅供参考） |
|---|---|---|---|---|
| **stdio** | `stdio` | 本地可执行命令路径 | 作为本地子进程被拉起，通过 stdin/stdout 走 JSON-RPC | `StdioServerParameters(command=endpoint, args, env)` → `stdio_client` |
| **SSE（legacy）** | `sse` | SSE URL（如 `http://host:port/sse`） | 传统 SSE 传输：`GET {url}` 返回 SSE 流（含 `endpoint` 事件给出消息 POST 地址）；`POST {消息地址}` 收客户端→服务端消息 | `sse_client(url=endpoint, timeout, sse_read_timeout=max(timeout*2,60))` |
| **Streamable HTTP** | `streamable_http` | HTTP URL（如 `http://host:port/mcp`） | MCP Streamable HTTP：在 `{url}` 接受 `POST`（必选）与可选 `GET`（用于 SSE 流式）；`Accept: application/json, text/event-stream`；正确处理 `mcp-session-id` 头与 `DELETE` 终止 | `streamable_http_client(url=endpoint, terminate_on_close=True)`（基于 `create_mcp_http_client`） |

**字段说明（注册时 Server 不直接实现，仅说明平台会传什么）：**
- `stdio`：`endpoint` = 命令路径；`args`（可选，命令行参数数组）、`env`（可选，环境变量字典）一并传入。
- `sse` / `streamable_http`：`endpoint` = 可达 URL；HTTP/SSE 场景下平台客户端**当前不发送任何认证头**（见第 8 节）。

**选型建议**：新接入优先用 **Streamable HTTP**（当前标准、会话语义清晰）；`sse` 仅用于兼容旧实现（legacy）；`stdio` 仅适合与平台同机部署、由平台拉起进程的托管场景。

---

## 3. 必须实现的 MCP 方法

所有方法遵循 JSON-RPC 2.0 over 所选传输。以下 method 名为 MCP 标准名。

| method | 是否必须 | 说明 / 请求-响应要点 |
|---|---|---|
| `initialize` | 必须 | 含 `protocolVersion` 协商；使用官方 SDK 时由 SDK 自动处理，无需手写。Server 应返回 `capabilities`（本场景至少声明 `tools`）、`serverInfo`、`protocolVersion`。 |
| `tools/list` | **必须（核心）** | 返回 `{ tools: [...] }`。每个 tool 必须含 `name`、`description`、`inputSchema`（见第 6 节）。**这是健康探测的核心方法**（见第 5 节）。 |
| `tools/call` | 必须 | 入参 `{ name, arguments }`；返回 `{ content: [...] }` 标准 MCP content 数组。结果请尽量用 `{ "type": "text", "text": "..." }` 块（见第 6.4 节）。 |
| `ping` | 可选 | 用于保活/连通性确认；不实现不影响兼容（平台探活走 `tools/list`，不依赖 `ping`）。 |
| `notifications/initialized` | 可选 | 初始化完成通知；SDK 通常自动发送/处理。 |
| `notifications/*` | 可选 | 单向通知类方法；不实现不影响 tools 纳管。 |

**能力声明约束**：平台当前只消费 `tools` 能力。Server 可额外实现 `resources` / `prompts` / `completion` / `sampling` / `roots` / `logging`，**不影响兼容**；但平台不会主动使用它们，请勿假设平台会调用。

---

## 4. 连接与会话模型

### 4.1 长驻 session
- 平台对每个**已连接**的 Server 维护一个长驻 `ClientSession`（由 `initialize` 建立的会话）。
- 该 session 在连接生命周期内复用，用于 `tools/list`、`tools/call`、健康探测等所有交互。

### 4.2 连接建立时机
- **手动连接**：运营在 MCP 管理页点击「连接」，平台对目标 Server 建立客户端并 `initialize`，进入"已连接"态。
- **自动连接**：注册时若 `auto_connect=true`，平台启动阶段通过 `auto_connect_all` 自动建立连接，无需人工操作。
- **未连接态**：仅"已登记但未连接"的 Server 不产出健康探测结果（前端显示「未探测」，见第 5 节）。

### 4.3 断开
- 运营在页面「断开」，或进程/网络不可达导致异常，session 进入未连接态。

---

## 5. 健康探测契约（最关键）

### 5.1 探测逻辑（平台侧）
平台健康探测链路：`manager.health_check_all` → `client.health_check` → **对长驻 session 调一次 `session.list_tools()`**。
- 成功返回 → 探测结果 `True`（正常）。
- 抛异常 / 被判定未连接 → 探测结果 `False`（异常）。

### 5.2 「探测正常」的充要条件
1. Server 处于**已连接**态（session 已建立）；
2. `tools/list` 能在超时内**成功返回**（哪怕工具数为 0 也行）。

二者同时满足 ⇒ 页面健康列显示「探测正常」（值 `true`）。

### 5.3 状态语义区分（易混淆）
- **探测正常**：已连接 + `tools/list` 成功。
- **探测异常**（值为 `false`）：`tools/list` 抛错 / 超时 / Server 根本没连上。常见根因见 5.4。
- **未探测**：Server 处于"已登记但未连接"态。`health_check_all` **只遍历已连接的客户端（`_clients`）**，不会为未连接的 Server 产出结果 ⇒ 前端显示「未探测」而非「探测异常」。

> 排障提示：用户在页面看到"一直探测异常"，真实根因通常是 (a) Server 没实现好 `tools/list`，或 (b) 连接根本没建立（如 URL 不可达、进程未拉起）。而非平台逻辑问题。

### 5.4 「探测异常」常见原因自查清单（排障用）
照此逐项排查，定位到"✓"项即根因：
- [ ] **Server 是否真的连上了？** 先确认页面状态不是「未探测」。未连接时永远不会有"正常/异常"，只会有"未探测"。
- [ ] **`tools/list` 是否实现且返回合法结构？** 必须返回 `{ "tools": [...] }`，每个元素含 `name`/`description`/`inputSchema`。
- [ ] **`inputSchema` 是否是合法 JSON Schema 对象？** 非法 schema 会导致 `tools/list` 解析失败 ⇒ 探测异常。
- [ ] **`tools/list` 是否在超时内返回？** 默认单次请求超时 30s（见第 7 节）；处理过慢或死锁会超时。
- [ ] **（HTTP/SSE）`endpoint` URL 是否可达？** 网络不通 / 端口未监听 / 路径错误 ⇒ 连接建立失败 ⇒ 未连接 ⇒ 探测异常。
- [ ] **（stdio）`endpoint` 命令路径是否正确、可执行？** 命令不存在或无执行权限 ⇒ 子进程起不来 ⇒ 连接失败。
- [ ] **（stdio）`args` / `env` 是否正确？** 参数或环境变量缺失导致 Server 启动即退出。
- [ ] **（Streamable HTTP）是否正确回 `mcp-session-id`？** 未正确处理会话头会导致后续 `tools/list` 失败。
- [ ] **Server 是否在 `initialize` 阶段崩溃？** 初始化报错则 session 从未成功建立。

---

## 6. 工具定义规范

### 6.1 字段要求（`tools/list` 每个 tool）
- `name`：字符串，**必填**。
- `description`：字符串，**必填**（建议清晰描述用途，便于运营授权判断）。
- `inputSchema`：**合法 JSON Schema 对象**，必填。用于描述 `arguments` 结构；非法 schema 会导致 `tools/list` 解析失败（见 5.4）。

### 6.2 命名约束
- **Server 名（`name` 注册字段）**：字符集 `[A-Za-z0-9._-]`，**不含** `/`、空格、中文。
- **工具名（`tool.name`）建议**：同样只用 `[A-Za-z0-9_-]`。
  - 平台侧**不净化工具名**（可含点号），但保持简单最稳妥。
  - 当多个 Server 名互为前缀时，工具名保持简单可避免与 server 名拼接后产生歧义或撞名（平台靠 `mcp_server` 字段精确归属，但简洁命名能减少人为误读）。

### 6.3 skill_id 拼接规则
平台将工具映射为技能：
```
skill_id = "mcp-" + <server_name> + "-" + <tool_name>
```
- 使用**原始工具名**拼接（不净化，可含点号）。
- 平台展示名会把 `-` 替换为 `__`（展示层行为，不影响 `skill_id` 本身）。
- 示例：`server=weather`，`tool=get_forecast` ⇒ `skill_id = "mcp-weather-get_forecast"`。

### 6.4 工具结果 content 格式要求（`tools/call`）
- 返回必须是**标准 MCP content 数组**：`{ "content": [ ... ] }`。
- 平台会把 `type:"text"` 的 content 块**展平到 `data.text`**，便于后端落库与前端展示。
- **强烈建议**：返回结果尽量用 `{ "type": "text", "text": "..." }` 块；避免仅返回非 text 类型（如 image/resource）导致落库/展示信息缺失。
- 错误应通过 JSON-RPC `error` 或在 content 中以 text 说明，便于 Agent 与运营感知。

---

## 7. 超时与重试

### 7.1 默认值（平台侧）
- **连接与单次请求超时**：`timeout = 30.0s`。
- **SSE 读超时**：`sse_read_timeout = max(timeout*2, 60)`，即至少 **60s**。
- **Streamable HTTP**：基于 `create_mcp_http_client`，超时同样受 `timeout` 约束（具体细分待测 / 需平台侧确认）。

### 7.2 可调项
- 注册 Server 时可配置 `timeout` 字段调大（平台入参，Server 侧无需实现，仅需"能在该超时内响应"）。
- Server 实现方应保证：`initialize` / `tools/list` / `tools/call` 在相应超时内返回，避免被判定异常。

### 7.3 重试
- 本文档不规定 Server 侧需实现重试；平台侧的探活/重连策略待测 / 需平台侧确认。Server 应做到**幂等**地响应重复请求（尤其 `tools/call`），以防平台重连/重试造成副作用。

---

## 8. 认证与网络安全

### 8.1 现状（硬事实）
- `ai-platform` 的 MCP 客户端**当前不发送任何认证头**（HTTP / SSE 均如此）。
- 因此 Server 端**不能依赖**收到 `Authorization` 等凭证。

### 8.2 应对建议
- **方案 A（推荐）**：Server 不要求认证即可访问，但将其部署在平台**可信网络 / 内网**，靠网络层隔离（防火墙、VPC、私有网段）保障安全。
- **方案 B**：若必须做访问控制，放在反向代理 / 网关层做 IP 白名单或 mTLS，而非依赖应用层 Authorization 头。
- **禁止假设**：开发 Server 时**不要假设平台会带 auth**；任何依赖 `Authorization` 头才能响应的实现都会导致连接/探测失败。

### 8.3 未来
- 若需平台侧改造以支持认证，属于平台侧工作，**不在本规格范围内**。

---

## 9. 最小参考实现

下面两个骨架均可被平台 `tools/list` 探测通过。任选其一，按目标传输替换启动方式。

### 9.1 Python（官方 `mcp` SDK `FastMCP`）

依赖：`mcp>=1.2.0`（提供 `FastMCP` 与 `streamable-http` 传输）。

```python
# server.py
from mcp.server.fastmcp import FastMCP

# 服务名需满足 [A-Za-z0-9._-]
mcp = FastMCP("demo-server")


@mcp.tool()
def echo(message: str) -> str:
    """回显输入文本。

    Args:
        message: 要回显的内容
    """
    # FastMCP 会将返回值自动包装为 {type:"text", text:...} content
    return f"echo: {message}"


@mcp.tool()
def add(a: int, b: int) -> int:
    """两个整数相加。"""
    return a + b


if __name__ == "__main__":
    # —— stdio 启动（endpoint 填本文件/命令路径，如 python server.py）——
    mcp.run(transport="stdio")

    # —— Streamable HTTP 启动（endpoint 填 http://host:port/mcp）——
    # mcp.settings.host = "0.0.0.0"
    # mcp.settings.port = 8001
    # mcp.run(transport="streamable-http")

    # —— legacy SSE 启动（endpoint 填 http://host:port/sse）——
    # mcp.run(transport="sse")
```

要点：
- `@mcp.tool()` 装饰器自动从类型注解与 docstring 生成 `inputSchema`，并保证 `tools/list` 返回标准结构。
- 返回值（str / int 等）会被 SDK 自动包成 `text` content，满足第 6.4 节要求。
- 服务名 `demo-server` 满足 `[A-Za-z0-9._-]`。

### 9.2 TypeScript（官方 `@modelcontextprotocol/sdk`）

依赖：`@modelcontextprotocol/sdk`、`zod`、`express`（HTTP 传输用）。

**(a) stdio 启动**

```typescript
// server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "demo-server", version: "1.0.0" });

server.tool(
  "echo",
  "回显输入文本。",
  { message: z.string() },
  async ({ message }) => {
    return { content: [{ type: "text", text: `echo: ${message}` }] };
  }
);

server.tool(
  "add",
  "两个整数相加。",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => {
    return { content: [{ type: "text", text: String(a + b) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**(b) Streamable HTTP 启动**

```typescript
// server-http.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const server = new McpServer({ name: "demo-server", version: "1.0.0" });

server.tool("echo", "回显输入文本。", { message: z.string() }, async ({ message }) => {
  return { content: [{ type: "text", text: `echo: ${message}` }] };
});

const app = express();
app.use(express.json());

// 按 SDK 推荐模式维护 transport 与会话（此处为无状态/单会话最简骨架）
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // 无状态模式；如需会话态可自定义生成器
});

app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

await server.connect(transport);
app.listen(8001, () => console.log("MCP Streamable HTTP on :8001/mcp"));
```

要点：
- TS SDK 的 `server.tool(name, description, schema, handler)` 自动生成 `inputSchema`；handler 返回 `{ content: [{ type: "text", text }] }` 满足第 6.4 节。
- Streamable HTTP 需正确处理 `mcp-session-id`、`DELETE` 终止与 `Accept` 头；具体会话态管理请参照 SDK 官方示例（无状态/有状态两种模式）。**「会话态细节待测 / 需平台侧确认」平台 `streamable_http_client(terminate_on_close=True)` 会在关闭时发 `DELETE`**，Server 需能优雅处理。
- 服务名 `demo-server` 满足 `[A-Za-z0-9._-]`。

---

## 10. 接入验收清单（Checklist）

> 照此逐项确认，全部 ✓ 即 Server 可被平台正常纳管。

### 10.1 注册前准备
- [ ] Server 名仅含 `[A-Za-z0-9._-]`（无 `/`、空格、中文）。
- [ ] 工具名仅用 `[A-Za-z0-9_-]`，描述清晰。
- [ ] 选定传输：`stdio` / `sse` / `streamable_http`，并准备好对应 `endpoint`。
- [ ] （HTTP/SSE）Server 部署在平台可达网络；不依赖 Authorization 头。
- [ ] （stdio）命令路径可执行，`args`/`env` 就绪。

### 10.2 平台登记与连接
- [ ] 在 MCP 管理页登记 Server（`name`/`transport`/`endpoint`/`args`/`env`/`timeout`/`auto_connect`/`description`）。
- [ ] 若为 `auto_connect=true`：平台启动后自动出现"已连接"态；否则在页面手动点「连接」。
- [ ] 页面连接状态显示**已连接**（非「未探测」）。

### 10.3 健康探测
- [ ] 页面健康列显示**「探测正常」**（值 `true`）。
- [ ] 若显示「探测异常」，按第 5.4 节自查（`tools/list` 实现、超时、URL/命令可达性、会话头）。

### 10.4 工具发现
- [ ] 点击「发现工具」后，列表出现预期数量的工具（记为 N 个）。
- [ ] 每个工具均展示 `name` / `description` / `inputSchema`，且 `inputSchema` 合法。
- [ ] （核对）`skill_id` 形如 `mcp-<server>-<tool>`。

### 10.5 授权与调用
- [ ] 对目标工具执行「授权」操作。
- [ ] Agent 经平台调用该工具，返回结果能在平台/对话中正常展示（text content 已正确落库与展平）。
- [ ] 调用结果以 `{type:"text", text:"..."}` 形式被平台接收（第 6.4 节）。

### 10.6 稳定性（建议）
- [ ] 长时间运行后健康探测仍稳定（无偶发超时）。
- [ ] `tools/call` 幂等，重复调用不产生副作用。

---

## 附录：关键约束速查

| 项 | 约束 |
|---|---|
| 支持的传输 | `stdio` / `sse`（legacy）/ `streamable_http` |
| 必须实现的方法 | `initialize`、`tools/list`、`tools/call` |
| 健康探测本质 | 对长驻 session 调一次 `tools/list` 成功 ⇒ 正常 |
| 未连接 vs 异常 | 未连接 ⇒「未探测」；连上但 `tools/list` 失败 ⇒「探测异常」 |
| Server 名字符集 | `[A-Za-z0-9._-]` |
| 工具必备字段 | `name`(str)、`description`(str)、`inputSchema`(JSON Schema) |
| skill_id | `mcp-` + server + `-` + tool（原始名拼接） |
| 工具结果 | 标准 content 数组，优先 `{type:"text", text}` |
| 默认超时 | 连接/请求 30s；SSE 读超时 ≥60s |
| 认证 | 平台客户端**不发送** auth 头；Server 不可依赖 |
| 能力范围 | 平台仅用 tools；resources/prompts 等不影响兼容但不被调用 |

*（文档结束 — 所有断言以 `mis-platform` 逆向确认事实为准；标注「待测 / 需平台侧确认」处为超出已确认事实范围、需进一步核实的内容。）*

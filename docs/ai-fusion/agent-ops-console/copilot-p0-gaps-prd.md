# MIS 平台 AI Copilot「P0 缺口补齐」增量 PRD

> 文档类型：增量 PRD（简单 PRD，聚焦 P0，无竞品分析）
> 版本：v1.0（初稿，待架构师评审）
> 作者：许清楚（产品经理）
> 关联文档：`docs/ai-fusion/agent-ops-console/prd.md`、`spec.md`、`impl-plan.md`

---

## 0. 范围边界声明（必读）

本 PRD **仅**覆盖经代码核对确认的两个 P0 硬缺口，不做架构设计与代码实现（架构交高见远）。

- **在范围内（P0）**：① 发送附件 / 文件上传 / 粘贴截图；② 进入会话自动加载历史。
- **不在范围内（仅记录，本次不实现）**：多会话管理（P1）、新建会话语义错位（P1）、自动滚动到底（P2）、附件预览/下载（P2）、历史分页（P2）。
- **重要约定**：为避免因当前「单全局 session」模型与未来「多会话」冲突，本 PRD 在 P0 实现中**显式以单 session 模型落地**，并在 §6 标注多会话为后续范围，要求附件/历史逻辑在接口设计上预留「随会话切换」扩展点。

### 0.1 三套对话壳（路径已核对实际代码，与初稿描述略有出入）

| 壳 | 实际文件路径 | 路由 | 是否业务 Copilot | 用 chat-core `useChat` |
|---|---|---|---|---|
| 全局 Copilot 抽屉 | `src/components/chat/CopilotPanel.tsx` | 全局挂载（无独立路由） | 是 | 是 |
| 页面级对话面板 | `src/features/agent/ai/ai-chat-panel.tsx` | `/ai/qa`、`/iqd/data-query`、`/iqd/test-chat` | 是 | 是 |
| 运营调试台 | `src/features/agent/chat/agent-chat-page.tsx` | `/agent/chat` | 否（运营排障） | 否（自有状态） |

> 核心对话逻辑实际位于 `src/lib/chat/useChat.ts`（hook）+ `src/stores/chat-store.ts`（全局 session 状态），而非初稿所述 `src/features/ai/` 下。A2UI 动态渲染层齐备（`src/lib/a2ui/`）。本 PRD 的 P0 改造落点即这层 chat-core，使两个业务壳（全局抽屉 + 页面级面板）同时受益。

---

## 1. 产品目标

补齐后，用户可在 Copilot 中**发送附件/截图、并在进入会话时自动恢复历史对话**，使其能力对齐旧实现、满足真实业务诉求（如基于报错截图求助、跨刷新延续上下文），消除当前「只能发纯文本、刷新即丢历史」的硬伤。

---

## 2. 用户故事

### P0-1 发送附件 / 上传 / 粘贴截图

- 作为**运营/客服**，我想在对话中发送截图或文件，以便让 AI 基于附件内容解答（如报错截图、数据表、日志），而非只能手敲描述。
- 作为**用户**，我想通过「点击 + 按钮 / 拖拽到对话区 / 直接粘贴图片」三种方式快速附文件，降低操作成本。
- 作为**用户**，我想在发送前查看并删除误选的附件（chip 可删），避免发错内容。

### P0-2 自动加载对话历史

- 作为**用户**，我刷新页面或重新打开 Copilot 后希望看到之前的对话，不必重新描述上下文。
- 作为**客服**，我希望每次进入会话都自动恢复历史，保证服务连续性。
- 作为**用户**，我希望恢复历史时先看到「加载中」骨架、再看到完整消息，体验连贯不突兀。

---

## 3. 需求池（优先级）

### P0（Must have，本次必须实现）

#### P0-1 附件上传
- **P0-1.1** 点击输入框附近「+」按钮 → 打开文件选择器；支持类型：图片 `png/jpg/jpeg/gif/webp`、文档 `pdf/doc/docx/xlsx/csv`、文本 `txt/md`；单文件 ≤ 10MB，单条消息 ≤ 5 个附件（上限为建议值，待确认）。
- **P0-1.2** 拖拽文件到对话区：拖拽悬停时对话区高亮，释放即加入待发送附件。
- **P0-1.3** 粘贴图片（`Ctrl/Cmd+V`）：自动将剪贴板图片转为待发送附件。
- **P0-1.4** 发送前展示待发送附件 chip（文件名 + 图标/缩略图 + 大小），支持逐个删除。
- **P0-1.5** 发送态/失败态：附件随消息先发出（占位），失败可重试；类型不符或超限在选取时即拦截并提示。
- **P0-1.6** 附件先随消息发出（含附件引用），关联 SSE 流式回复（关联机制见 §5 待确认 #3）。

#### P0-2 历史自动加载
- **P0-2.1** 进入任意业务会话（全局抽屉 / 页面级面板）即触发历史拉取，会话区展示「加载中」骨架。
- **P0-2.2** 拉取成功后渲染历史消息（区分 user / assistant 气泡，含 A2UI 卡片），恢复后滚动定位到最近消息。
- **P0-2.3** 刷新页面 / 重开抽屉后基于同一 `sid` 恢复（前端已持久化 sid 到 localStorage，需补齐「消息恢复」分支）。
- **P0-2.4** 无历史 / 拉取失败：降级为空会话，不报错阻塞主流程。

### P1（Should have，本次不实现，仅记录）
- **P1-1** 多会话管理 / 会话列表。
- **P1-2** 新建会话语义错位修复（当前「新建」未真正重置后端会话）。
- **P1-3** 附件类型/大小策略可配置化（后台下发上限）。

### P2（Nice to have，本次不实现，仅记录）
- **P2-1** 新消息自动滚动到底。
- **P2-2** 附件预览大图 / 下载。
- **P2-3** 历史分页 / 无限滚动加载更早消息。

---

## 4. UI 设计稿（文字/结构描述，不画图）

### 4.1 附件交互区（输入框附近）
- **「+」按钮**：位于输入框左侧/上方，点击唤起 `<input type="file" multiple accept="...">`。
- **拖拽覆盖层**：文件拖入对话区时，对话容器高亮边框（如蓝色虚线），释放后加入待发送列表。
- **粘贴监听**：在输入框 `onPaste` 中拦截 `ClipboardItem` 的图片类型，自动转为待发送附件。
- **待发送附件区**：输入框上方一行 chip 列表，每个 chip = 文件图标/缩略图 + 文件名 + 大小；右侧「×」可删除；超出数量/超限类型时按钮禁用并显示提示。
- **发送态**：附件 chip 随消息上屏后显示「上传中」占位；失败显示红色感叹号 + 重试按钮。

### 4.2 历史恢复区（会话主体）
- **进入会话**：顶部优先渲染「加载中」骨架（若干占位气泡），同时后台拉取历史。
- **恢复完成**：按时间顺序渲染历史消息，user 右/assistant 左气泡区分；A2UI 卡片按原样还原；渲染结束后自动滚动到底部（最近消息）。
- **空/失败**：骨架消失，呈现空白输入框态，无报错弹窗。

---

## 5. 待确认问题（交付架构师 高见远）

以下为阻塞 P0 实现的关键未知项，需架构师核实后端（mis-admin-bff / ai-platform）后回填：

1. **附件存储位置与中转**：附件存哪里？BFF 直存对象存储/本地磁盘，还是转发 `ai-platform`？大小/类型上限由谁校验？（需核实 `mis-admin-bff` 是否已有 `sys_*` 或 `file` 相关上传 Controller，避免重复造轮子。）
2. **历史 API 是否存在 / 可复用**：后端是否已有会话历史接口？返回 schema？是否分页？
   - **补充发现（已核对代码）**：chat 域**已存在** `GET /agent-ops/chat/sessions/{id}/messages`（`src/features/agent/api/agent-chat-api.ts:174`，被运营调试台 `agent-chat-page.tsx` 的 `syncMessages` 复用）。请确认：① Copilot 是否可直接复用该端点；② 其 `id` 空间是否与 Copilot 当前客户端生成的 `sid`（`generateClientId('web')`，存 localStorage）一致，还是需后端 session 落地。
3. **附件与 SSE 流式响应关联**：消息先发（含附件引用）后流式补充文本，前端如何把附件与回包绑定？`InboundMessage`（WS 上行）与 `ChatMessage`（前端消息模型）当前**均无 attachments 字段**（`src/lib/chat/types.ts:27`、`122`），需明确由前端加字段、还是 Gateway/WS 协议同步改。
4. **会话标识（sid）语义**：当前前端单全局 session，`sid` 由客户端 `generateClientId('web')` 生成（非后端落地），`ensureSession` 仅从 localStorage 恢复 sid、不恢复消息（`src/lib/chat/useChat.ts:260`）；历史加载按什么 sid 拉取？是否需要后端为 Copilot 创建/持久化 session。
5. **类型契约扩展点**：`ChatMessage` / `InboundMessage` 需新增 `attachments?: {...}[]`；请确认扩展位置与向后兼容（旧 text 通道灰度回退不受影响）。

---

## 6. 风险与依赖

- **后端依赖**：P0 完全依赖 `mis-admin-bff`（上传端点）与 `ai-platform`（历史存储 / `agent_session`、消息表，库 `ai_platform`）的可用性；若端点缺失，需评估后端工作量并可能调整排期。
- **多会话冲突规避**：本 PRD 以「单 session」模型落地 P0；架构师在 §5 接口设计时应预留「按 sessionId 切换附件/历史」的扩展点，以便 P1 多会话接入时不返工。
- **灰度回退**：存量 text 通道（`a2uiEnabled:false`）应不受附件/历史改造破坏；新增字段需可选（optional）。
- **传输约束**：发送为 WS、接收为 SSE 双通道（`/ws/chat` + SSE）；附件引用走 WS 上行的 `InboundMessage`，历史走独立 HTTP GET，二者协议需对齐。

---

## 附：代码核对证据（供架构师快速定位）

| 结论 | 证据（实际文件:行） |
|---|---|
| P0-1 附件零实现 | `src/lib/chat/useChat.ts:301` `sendMessage(content: string)` 仅收 string；`src/lib/chat/types.ts:27` `ChatMessage` 无 attachments；`:122` `InboundMessage.chat` 仅 `content?`；全域 chat 壳无 `type="file"` 输入 |
| P0-2 历史零拉取 | `src/lib/chat/useChat.ts:260` `ensureSession` 仅从 localStorage 恢复 sid、不恢复消息；`:281` `persistSession` 仅存 sid 字符串；`:454` `closeSession` 调 `persistSession(null)` 清空；`chat-store.setMessages` 在 Copilot 流程从未被历史数据调用 |
| 后端已有 chat 历史能力（未接入 Copilot） | `src/features/agent/api/agent-chat-api.ts:174` `GET /agent-ops/chat/sessions/{id}/messages`；`src/features/agent/chat/agent-chat-page.tsx:96` `syncMessages` 调用并上屏 |
| 三套壳路径 | 见 §0.1 表格 |

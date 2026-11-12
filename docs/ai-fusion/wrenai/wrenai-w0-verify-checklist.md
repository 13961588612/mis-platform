# WrenAI 跨机器部署（方案 A v0.2）W0 真机验证清单

> 文档角色：W0 真机逐项执行表，配合 `wrenai-ops-runbook.md`（**第二部分 §2.2 W0-B**）与 `mis-iqd-mcp-deploy-incremental.md`（v0.2 设计）使用。
> 状态：🔶 W0 待测（逐项勾选）｜日期：2026-08-28｜语言：中文
> 设计终态：ai-platform（管控面）↔ wren 机（数据面 `WrenMcpAgent` + `wren serve mcp`）**跨机器**；bearer-token + 内网网络隔离，已免 mTLS。
> 占位说明：命令中的 `<AI_PLATFORM_HOST>` / `<WREN_HOST>` / `<WREN_AGENT_TOKEN>` / `<CONN_ID>` / `<CONN_ID_A|B>` 请按真机替换；ai-platform 源 IP 即 `<AI_PLATFORM_HOST>` 出口 IP。

---

## 全局前置条件（全部项共用，先做）

- [ ] wren 机：Linux + systemd + 持久卷已挂 `/var/lib/mis-iqd/wren-projects`；Python 3.11+、wren CLI 在 PATH（`wren --version` = 0.13.3，`wren serve mcp` 可用）。
- [ ] wren 机：`WrenMcpAgent` 已部署并 `systemctl enable --now wren-mcp-agent`（见 `wren-mcp-agent-deploy.md` §2）；`journalctl -u wren-mcp-agent` 无致命报错。
- [ ] 防火墙：仅放行 **ai-platform 源 IP ↔ wren 机 9100/9101**（见 `wren-mcp-agent-deploy.md` §2.4）。
- [ ] ai-platform：`WREN_AGENT_ENDPOINT` 已配（非空，指向 wren 机控制面基址），`WREN_AGENT_TOKEN` 与 wren 机一致；路由判定 `WrenMcpAgentClient.enabled == true`。
- [ ] mis-iqd：已先起跑并执行 **Flyway V85**（`iqd_connection` 已加 `mcp_host` / `agent_handle` 两列）——顺序约束见 runbook **§3.7**。
- [ ] 管理后台：连接表单可填凭证（提交走 secretRef）；「启用 / 创建项目」按钮已接线（见 runbook **§3.5**）。

---

## W0-1. 自服务「启用 → agent 远程 bootstrap」端到端

- **目的**：验证管理后台点「启用/创建项目」后，ai-platform 经 `WrenMcpAgentClient.ensure` 在 wren 机远程拉起 `wren serve mcp` 并回报 `mcp_status=running`，无需运维登机。
- **前置条件**：全局前置已满足；待验证连接 `<CONN_ID>` 已建（secretRef 已存，未启用）。
- **执行步骤**：
  ```bash
  # ① 管理后台填连接表单（含凭证）→ 保存；用 API 确认明文不回（应恒为 ******）
  curl -s "<AI_PLATFORM_HOST>/api/v1/iqd/connections/<CONN_ID>" \
    -H "Authorization: Bearer <MIS_JWT>" | grep -o '"secretRef":"[^"]*"\|"credential":"[^"]*"'

  # ② 管理后台点「启用 / 创建项目」（等价于 BFF POST /iqd/mcp/enable）
  curl -s -X POST "<AI_PLATFORM_HOST>/iqd/mcp/enable" \
    -H "Authorization: Bearer <MIS_JWT>" \
    -H "Content-Type: application/json" \
    -d '{"conn_id":"<CONN_ID>"}'

  # ③ wren 机：确认 agent 已拉起该连接 wren 进程
  ps -ef | grep 'wren serve mcp' | grep "<CONN_ID>"
  curl -s "http://<WREN_HOST>:9100/internal/v1/wren-mcp/status?conn_id=<CONN_ID>" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>"

  # ④ mis-iqd：确认回写 mcp_host / agent_handle / mcp_status
  mysql -e "SELECT id, mcp_status, mcp_host, agent_handle FROM iqd_connection WHERE id=<CONN_ID>;"
  ```
- **预期结果**：
  - 步骤①API 返回中 `credential`/`secretRef` 可见但**无明文**（前端/API 恒回 `******`）。
  - 步骤②后 wren 机出现该连接 `wren serve mcp` 进程（绑定 `127.0.0.1:{local_port}`，18080-18180 内）。
  - 步骤③ agent `status` 返回 `status=running` + `agent_handle` 非空 + `mcp_endpoint` 指向 `:9101/mcp/<CONN_ID>`。
  - 步骤④ `mcp_status=running`、`mcp_host`=wren 机地址、`agent_handle` 非空。
- **通过标准**：③④均返回 running 且 `mcp_host`/`agent_handle` 有值；全程**未**人工 SSH 登 wren 机。
- **失败排查**：
  - `ensure` 返回 401/403 → `WREN_AGENT_TOKEN` 两端不一致 / 防火墙未放行 ai-platform 源 IP（runbook **§1.3** / **§3.2**）。
  - `ensure` 超时/不可达 → `systemctl status wren-mcp-agent`；`firewall-cmd --list-rich-rules`；确认 `WREN_AGENT_ENDPOINT` 正确。
  - `mcp_status=crashed` → 查 wren 机 `journalctl -u wren-mcp-agent`（凭证 env / wren CLI 报错）。
  - `mcp_host` 空 → 仍走本地 PlanA（未配 `WREN_AGENT_ENDPOINT`）→ 配置后重新 enable。
  - 回写失败 → 检查 V85 是否已执行（mis-iqd 先起跑，runbook **§3.7**）。

---

## W0-2. 凭证链经管控通道下发注入不落盘

- **目的**：验证 S1 完整链路——mis-iqd 仅存 secretRef；ai-platform 解 ref → 经 bearer+内网管控通道下发 wren 机 agent → 注入 wren 进程 env；明文仅内存、wren 机/ai-platform/mis-iqd 磁盘均无明文。
- **前置条件**：W0-1 已成功（连接 `<CONN_ID>` 已 running，wren 进程持有凭证 env）。
- **执行步骤**：
  ```bash
  # ① wren 机：project 目录磁盘不应有凭证明文（临时文件 chmod600 用即删）
  grep -RIn "WREN_PG_PASSWORD\|WREN_PG_DATABASE\|WREN_IQD_CREDENTIAL_JSON" \
    /var/lib/mis-iqd/wren-projects/<CONN_ID>/ || echo "OK: 无明文命中"

  # ② wren 机：agent 日志不应落明文凭证
  journalctl -u wren-mcp-agent --since "1 hour ago" \
    | grep -iE "password|secret|credential" | grep -v "credential_json_ref\|secret_ref" || echo "OK: 日志无明文"

  # ③ wren 机：确认 wren 进程 env 确有凭证（明文仅在内存）
  WREN_PID=$(pgrep -f "wren serve mcp.*<CONN_ID>")
  tr '\0' '\n' < /proc/$WREN_PID/environ | grep -E "WREN_PG_|WREN_IQD_CREDENTIAL_JSON"

  # ④ ai-platform / mis-iqd 机器：全局搜凭证明文（应无）
  sudo grep -RIn "<真实库密码>" /opt /var/lib/mis-iqd /var/log 2>/dev/null || echo "OK: 平台侧无明文"

  # ⑤ 功能验证：对该连接问数能连业务库（dry_run/run_sql 成功）
  ```
- **预期结果**：
  - ①③④均无明文命中；②日志无明文；③wren 进程 env 含 `WREN_PG_*` / `WREN_IQD_CREDENTIAL_JSON` 且能成功连库。
  - `wren serve mcp` 能联真实业务库（问数不报认证失败）。
- **通过标准**：磁盘三处（wren project / agent 日志 / 平台侧）均无明文；wren 进程 env 有凭证且功能可用；wren 机**不接 Vault**（凭证未写 Vault，仅经通道一次性下发）。
- **失败排查**：
  - ③ env 无凭证 → agent 未注入；查 ai-platform `CredentialVault` 是否解析到 secretRef；确认 `WREN_PG_*` 占位与 profile 模板一致（runbook **§3.6**）。
  - 问数连库失败 → 占位名/格式不匹配；核对 profile 模板与业务库驱动（postgres/mysql/...）。
  - 磁盘出现明文 → 临时文件未删；查 agent `_build_env` 的 `chmod 600` + `os.remove` 逻辑。

---

## W0-3. 问数按 connection_id 远程路由到 wren 机 agent 数据面（无串台）

- **目的**：验证 `IqdMcpClient.for_connection(connId)` 按连接路由到 wren 机 agent 数据面 `/mcp/{conn_id}`，连接 A 问数只打 A 的 wren 进程，连接 B 只打 B（多连接隔离）。
- **前置条件**：≥2 个连接已启用（`<CONN_ID_A>`、`<CONN_ID_B>`），各自 running、端口不同。
- **执行步骤**：
  ```bash
  # ① 确认两连接 wren 进程端口不同
  curl -s "http://<WREN_HOST>:9100/internal/v1/wren-mcp/status?conn_id=<CONN_ID_A>" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" | grep -o '"local_port":[0-9]*'
  curl -s "http://<WREN_HOST>:9100/internal/v1/wren-mcp/status?conn_id=<CONN_ID_B>" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" | grep -o '"local_port":[0-9]*'

  # ② 对连接 A 问数（走 agent 数据面 /mcp/<CONN_ID_A>）
  #   观察 wren 机 agent 访问日志命中 /mcp/<CONN_ID_A>，且 wren 进程日志仅 A 的 project
  journalctl -u wren-mcp-agent -f &   # 另开终端观察
  # 触发连接 A 问数（前端/工具 ask(conn_id=<CONN_ID_A>)

  # ③ 对连接 B 问数，同理核对仅命中 /mcp/<CONN_ID_B> 与 B 的 wren 进程
  ```
- **预期结果**：
  - ①两连接 `local_port` 不同（均在 18080-18180）。
  - ②agent 日志仅出现 `/mcp/<CONN_ID_A>` 转发到 A 的 `127.0.0.1:{portA}`；A 的 wren 进程日志有活动，B 的无活动。
  - ③同理 B 仅命中 B。
- **通过标准**：A/B 问数各自只命中对应路径与对应 wren 进程，**无串台**；`orchestrator` 按 `connection_id` 取到正确 ingress。
- **失败排查**：
  - 串台 → 检查 agent 路由 `conn_id` 解析与注册表 `wren_host`/`mcp_endpoint`；确认 orchestrator `for_connection` 缓存按 connId 隔离（修复跨连接串台）。
  - 问数报双路不可达 → 先 `ensure`/启用该连接（runbook **§3.5** / **§3.10**）。

---

## W0-4. 端口段 18080-18180 分配 / 回收

- **目的**：验证每连接在 wren 机本机获得唯一端口，停止/删除后端口回收，可复用；超段显式报错。
- **前置条件**：W0-1 已成功，存在若干启用连接。
- **执行步骤**：
  ```bash
  # ① 列出 wren 机 wren 进程监听端口（应都在 18080-18180 且唯一）
  ss -ltnp | grep -E ':(1808[0-9]|1809[0-9]|181[0-7][0-9]|18180)\b'

  # ② 停止/删除一个连接，确认端口释放
  #   （管理后台停用连接，或 agent stop）
  curl -s -X POST "http://<WREN_HOST>:9100/internal/v1/wren-mcp/stop" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" \
    -H "Content-Type: application/json" -d '{"conn_id":"<CONN_ID>"}'
  ss -ltnp | grep ":<刚才的端口>\b" || echo "OK: 端口已回收"

  # ③ 新建/启用另一连接，确认复用该回收端口（或新分配且唯一）
  # ④ 端口段耗尽：临时将 WREN_AGENT_MAX_CONNECTIONS 调小 / 连超 10 个，确认显式报错
  ```
- **预期结果**：
  - ①所有 wren 进程端口落在 18080-18180 且互不重复。
  - ②停用后该端口不再监听（已回收）。
  - ③新连接可分配/复用端口且仍唯一。
  - ④超上限时 ai-platform/agent 显式报错（非静默）。
- **通过标准**：分配唯一、回收及时、超段报错、无端口冲突。
- **失败排查**：
  - 端口冲突 → 查 agent reconcile 端口分配逻辑；确认 `WREN_AGENT_WREN_PORT_RANGE` 配置。
  - 不回收 → 确认 `disabled`/`deleted` 触发 agent `stop` + 端口回收（runbook **§3.2** / W0-4）。

---

## W0-5. 进程崩溃自动重启 + 详情页「重启」按钮

- **目的**：验证 wren 进程崩溃后 wren 机 agent reconcile 自动拉起；前端连接详情页「重启」按钮可手动触发重启。
- **前置条件**：连接 `<CONN_ID>` running。
- **执行步骤**：
  ```bash
  # ① 记录当前 wren 进程 PID
  OLD_PID=$(pgrep -f "wren serve mcp.*<CONN_ID>")
  echo "OLD_PID=$OLD_PID"

  # ② 模拟崩溃
  kill -9 $OLD_PID

  # ③ 观察 agent reconcile 自动拉起（数秒内新 PID 出现，status 回 running）
  sleep 10
  NEW_PID=$(pgrep -f "wren serve mcp.*<CONN_ID>")
  echo "NEW_PID=$NEW_PID"   # 应非空且 ≠ OLD_PID
  curl -s "http://<WREN_HOST>:9100/internal/v1/wren-mcp/status?conn_id=<CONN_ID>" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" | grep -o '"status":"running"'

  # ④ 前端连接详情页点「重启」按钮 → 触发 agent restart
  curl -s -X POST "http://<WREN_HOST>:9100/internal/v1/wren-mcp/restart" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" \
    -H "Content-Type: application/json" -d '{"conn_id":"<CONN_ID>","credential":{}}'
  # 再次核对进程已重启且仍可问数
  ```
- **预期结果**：
  - ②③agent 自动拉起新进程（NEW_PID 非空且 ≠ OLD_PID），`status=running`，端口不变（复用）。
  - ④前端「重启」按钮成功触发 agent `restart`，进程重启后问数正常。
- **通过标准**：崩溃→自动重启成功；手动重启按钮可用；问数链路不中断。
- **失败排查**：
  - 不自动重启 → 查 agent reconcile 循环 / systemd `Restart=always`；`journalctl -u wren-mcp-agent`。
  - 重启后凭证失效 → agent 重启时重注凭证（S1，runbook **§3.6**）；确认凭证经管控通道重新下发。

---

## W0-6. SSH 兜底 bootstrap（Day-1 bootstrap）

- **目的**：验证 agent 通道不可达时，仍可在 wren 机经 SSH 手动 bootstrap project，保证 Day-1 可拉起。
- **前置条件**：wren 机 SSH 可达；可临时置 `WREN_AGENT_ENDPOINT` 为空（退回本地 PlanA）或停 agent 模拟通道不可达。
- **执行步骤**：
  ```bash
  # ① 模拟 agent 不可达（停 agent 或改 ai-platform WREN_AGENT_ENDPOINT 为空）
  ssh <WREN_HOST> "sudo systemctl stop wren-mcp-agent"

  # ② SSH 登 wren 机手动 bootstrap（决策 ⑨ Day-1 兜底）
  ssh <WREN_HOST> bash -s <<'EOF'
    set -e
    cd /var/lib/mis-iqd/wren-projects/<CONN_ID>
    wren context init
    wren profile add <CONN_ID> --connector <type>   # 用本地临时凭证文件（用即删）
    wren context set-profile <CONN_ID>
    wren context build
    wren memory index
    wren serve mcp --transport http --host 127.0.0.1 --port <local_port> &
    sleep 5
    ps -ef | grep 'wren serve mcp' | grep <CONN_ID>
  EOF

  # ③ 验证问数在本机可达（127.0.0.1）后，恢复 agent：重启 agent / 复原 WREN_AGENT_ENDPOINT 并重新 enable
  ssh <WREN_HOST> "sudo systemctl start wren-mcp-agent"
  # 恢复后回到管理后台重新「启用 / 创建项目」接管为常驻管控
  ```
- **预期结果**：
  - ②SSH 手动 bootstrap 成功拉起 wren 进程、build 完成、可本机问数。
  - ③agent 恢复后重新 `ensure` 接管，无需重写 project 目录；SSH 退居兜底。
- **通过标准**：agent 不可达时 SSH 仍能 bootstrap 并问数；恢复后 agent 接管无冲突。
- **失败排查**：
  - bootstrap 失败 → 查 wren CLI/Python 版本（≥3.11）、`wren.cli-bin` PATH、project 目录持久卷挂载。
  - agent 恢复后端口冲突 → 先停 SSH 手动进程再 `ensure`，或复用同端口。

---

## W0-7. 防火墙仅放行 ai-platform 源 IP

- **目的**：验证非 ai-platform 机器访问 wren 机 9100/9101 被拒；仅 ai-platform 源 IP 可达。
- **前置条件**：全局前置防火墙规则已配（仅放行 ai-platform 源 IP）。
- **执行步骤**：
  ```bash
  # ① 从【非 ai-platform】机器访问 wren 机（应被拒：timeout / connection refused）
  curl -m 5 -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" \
    "http://<WREN_HOST>:9100/internal/v1/wren-mcp/health" || echo "BLOCKED: 非授权源被拒(符合预期)"

  # ② 从 ai-platform 机器访问（应 200）
  ssh <AI_PLATFORM_HOST> "curl -m 5 -s -o /dev/null -w '%{http_code}\n' \
    -H 'Authorization: Bearer <WREN_AGENT_TOKEN>' \
    http://<WREN_HOST>:9100/internal/v1/wren-mcp/health"

  # ③ 核对 wren 机防火墙规则（仅 ai-platform 源 IP ACCEPT，其余 DROP）
  ssh <WREN_HOST> "sudo firewall-cmd --zone=public --list-rich-rules | grep -E '9100|9101'"
  ```
- **预期结果**：
  - ①非 ai-platform 源返回非 2xx（连接被拒/超时）。
  - ②ai-platform 源返回 `200`。
  - ③firewalld rich-rule 仅 `<AI_PLATFORM_HOST>` 源 IP 对 9100/9101 accept，其余 drop。
- **通过标准**：跨机通道仅 ai-platform 源 IP 可达；未授权源不可达（纵深防御 = bearer + 内网隔离，已免 mTLS）。
- **失败排查**：
  - ①可达 → 防火墙源 IP 未收敛；收紧 firewalld 仅放行 ai-platform 出口 IP（runbook **§1.3**）。
  - ②不可达 → ai-platform 源 IP 未加入白名单；确认出口 IP。

---

## W0-8. 多连接进程生命周期隔离

- **目的**：验证新增/删除连接不影响其它已运行连接进程（互不影响、独立生命周期）。
- **前置条件**：≥2 个连接运行中（`<CONN_ID_A>`、`<CONN_ID_B>`）。
- **执行步骤**：
  ```bash
  # ① 记录 A/B 进程状态
  ps -ef | grep 'wren serve mcp' | grep -E "<CONN_ID_A>|<CONN_ID_B>"

  # ② 删除/停用连接 A
  #   （管理后台删除连接 A，或 agent stop conn_id=A）
  curl -s -X POST "http://<WREN_HOST>:9100/internal/v1/wren-mcp/stop" \
    -H "Authorization: Bearer <WREN_AGENT_TOKEN>" \
    -H "Content-Type: application/json" -d '{"conn_id":"<CONN_ID_A>"}'

  # ③ 确认 B 仍 running、问数正常；A 进程消失、端口回收
  ps -ef | grep 'wren serve mcp' | grep "<CONN_ID_B>"   # 应仍在
  # 对 B 触发一次问数，确认正常

  # ④ 新增连接 C 并启用，确认不影响 A(已停)/B(在跑)
  #   启用 C → 确认仅新增 C 进程，B 不受影响
  ```
- **预期结果**：
  - ②③停用 A 后，B 进程与问数**不受影响**；A 进程退出、端口回收。
  - ④新增 C 仅增加 C 进程，B 维持运行。
- **通过标准**：单连接启停不影响其它连接；各连接进程独立、隔离。
- **失败排查**：
  - 删 A 影响 B → 检查 agent 是否按 connId 隔离 supervisor/端口；确认非全局重启。
  - B 问数断 → 查 agent reconcile 是否误杀；核对注册表 `desired_state`。

---

## W0-9. V85 迁移 + 数据回流（mcp_host/agent_handle 入库且不暴露）

- **目的**：验证 Flyway V85 加列成功、mis-iqd 先起跑；启用后 `mcp_host`/`agent_handle` 正确落 `iqd_connection` 表，且 API（VO）不暴露这两字段。
- **前置条件**：mis-iqd 已先起跑执行 V85（见全局前置）；W0-1 已成功（启用连接 `<CONN_ID>`）。
- **执行步骤**：
  ```bash
  # ① 确认 V85 迁移已执行（表已加列）
  mysql -e "SHOW COLUMNS FROM iqd_connection LIKE 'mcp_host'; SHOW COLUMNS FROM iqd_connection LIKE 'agent_handle';"

  # ② 确认启用后两列有值
  mysql -e "SELECT id, mcp_host, agent_handle, mcp_status FROM iqd_connection WHERE id=<CONN_ID>;"

  # ③ API 返回不应暴露 mcpHost / agentHandle（IqdConnectionVO getter 加 @JsonIgnore）
  curl -s "<AI_PLATFORM_HOST>/api/v1/iqd/connections/<CONN_ID>" \
    -H "Authorization: Bearer <MIS_JWT>" \
    | grep -o '"mcpHost"\|"agentHandle"' && echo "FAIL: 暴露了敏感字段" || echo "OK: VO 未暴露 mcpHost/agentHandle"

  # ④ mis-iqd 日志/库不应出现凭证明文
  sudo grep -RIn "<真实库密码>" /var/log/mis-iqd 2>/dev/null || echo "OK: 无明文"
  ```
- **预期结果**：
  - ①`iqd_connection` 表存在 `mcp_host` / `agent_handle` 两列。
  - ②启用连接后两列非空（wren 机地址 / agent 句柄），`mcp_status=running`。
  - ③GET 连接详情 JSON **不含** `mcpHost` / `agentHandle` 字段（@JsonIgnore 生效）。
  - ④平台侧日志/库无凭证明文。
- **通过标准**：V85 已执行、数据正确回流、`mcp_host`/`agent_handle` 入库且 API 不暴露、无明文泄漏。
- **失败排查**：
  - ①②回写失败/列为空 → mis-iqd 未先起跑 V85（顺序约束，runbook **§3.7**）；确认 `IqdAdminService.reportMcpDeployment` / `IqdInternalController.POST /internal/v1/iqd/mcp-deploy` 已接线。
  - ③仍暴露 → 确认 `IqdConnectionVO` 的 `mcpHost`/`agentHandle` getter 加 `@JsonIgnore`。

---

## 汇总

| 项 | 验证点 | 状态 |
|---|---|---|
| W0-1 | 自服务启用 → 远程 bootstrap 端到端 | ☐ |
| W0-2 | 凭证链 S1 跨机器下发不落盘 | ☐ |
| W0-3 | 按 connId 路由到 agent 数据面（无串台） | ☐ |
| W0-4 | 端口段 18080-18180 分配/回收 | ☐ |
| W0-5 | 崩溃自动重启 + 详情页重启按钮 | ☐ |
| W0-6 | SSH 兜底 bootstrap | ☐ |
| W0-7 | 防火墙仅放行 ai-platform 源 IP | ☐ |
| W0-8 | 多连接进程生命周期隔离 | ☐ |
| W0-9 | V85 迁移 + 数据回流（不暴露） | ☐ |

> 全部 ✅ 后即具备 W0 真机放行条件；未决项回到 `wrenai-ops-runbook.md` 对应章节处置。

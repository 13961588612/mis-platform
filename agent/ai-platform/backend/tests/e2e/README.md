# T11 多 Gateway + 多 Core 集群 E2E 测试

本目录验证 `ai-platform` 在「多 Gateway + 多 Agent Core」横向扩展拓扑下的**集群契约**：

- Bot / Agent 所有权唯一性（选主不重复）
- 出站事件**不重不丢**（精确一次）
- 崩溃后消息**恰好一次**重投
- H5 粘滞负载均衡（跨语言键逐字节一致）
- Core 故障转移（崩溃后新 owner 经 `refresh_streams` 重新订阅并消费）

> 设计约束：所有分布式原语（CoreOwnership / RedisSessionLock / StreamProducer /
> InboundStreamWorker）均 **import 真实生产模块**，测试层只做编排与断言，**不重写逻辑**。
> 仅网关侧 bot 租约的 Lua 由 `_ClusterRedis` 逐字复刻自
> `gateway/src/cluster/ownership.ts` 的 `BotOwnership.claim/release`（fakeredis 不支持
> EVAL，复用 `tests/_lua_fakeredis.py` 的 in-memory double 思路），并与各节点共享同一
> 内存 store，以模拟「单一共享 Redis」承载全部所有权契约。

---

## 交付物

| 文件 | 说明 |
| --- | --- |
| `test_e2e_cluster_contracts.py` | 6 场景 fakeredis 多连接契约测试 |
| `run_fault_injection.py` | 真实 Redis 故障注入 harness（env-gate，默认 SKIP） |
| `README.md` | 本文件 |
| `../../deploy/docker-compose.e2e.yml` | 真实集群拓扑（redis + gw-a/gw-b + core-1/core-2） |

---

## 本地运行（fakeredis 模拟，CI / 开发默认）

无需外部 Redis，fakeredis 多连接共享 `FakeServer` 即可复刻集群语义：

```bash
cd backend
.venv/Scripts/python -m pytest tests/e2e -q
# 或单文件
.venv/Scripts/python -m pytest tests/e2e/test_e2e_cluster_contracts.py -q
```

预期：**7 passed**（6 个场景测试 + 1 个入站串行测试）。

> `run_fault_injection.py` 以 `run_` 前缀命名，pytest 不会收集执行；需显式调用（见下）。

全量回归（T11 不应引入回归）：

```bash
.venv/Scripts/python -m pytest tests/ -q
```

 gateway 侧不受 T11 影响（`backend/tests/e2e` 不触碰 `gateway/src`），但发布前仍建议：

```bash
cd gateway && npx tsc --noEmit
```

---

## 真实运行（kill-9 多进程验证）

### 1. 起集群

```bash
cd deploy
docker compose -f docker-compose.e2e.yml up -d
```

拓扑：`redis`(db=2) + `gw-a`/`gw-b`(注入 `GATEWAY_ID`) + `core-1`/`core-2`
(注入 `CORE_ID`，`AGENT_RESYNC_S=15` < `AGENT_LEASE_TTL_S=30`，闭环 T9 故障转移缺口)。

所有服务经 `REDIS_HOST=redis`、`REDIS_DB=2`、`REDIS_KEY_PREFIX=aip:` 共享同一 Redis。

### 2. 逻辑层冒烟（真实 Redis，无 kill）

复用与单测相同的真实模块，在逻辑层注入「节点宕机」并断言优雅降级：

```bash
E2E_REAL_REDIS=1 REDIS_URL=redis://redis:6379/2 \
  python backend/tests/e2e/run_fault_injection.py
```

（本地换 `REDIS_URL=redis://localhost:6379/2`。不设 `E2E_REAL_REDIS=1` 时打印 SKIP 并退出 0。）

### 3. 注入 Core 崩溃（kill -9）

```bash
docker kill -s KILL <core-1 容器名>
```

观察：`core-2` 在 `AGENT_RESYNC_S(15s)` < `AGENT_LEASE_TTL_S(30s)` 内接管 agent 租约，
并重订阅 `aip:stream:agent:{agentId}`（T9 收口缺口闭环），崩溃期间入站消息经 XAUTOCLAIM
**恰好一次**重投。

### 4. 注入 Gateway 崩溃（kill -9）

```bash
docker kill -s KILL <gw-a 容器名>
```

观察：`gw-b` 接管 bot 租约、出站事件改投 `gw-b` 流；崩溃瞬间孤儿消息经 `pending` 兜底流
**不丢**，待 bot owner 重新认领后正确路由。

### 5. 断言口径

故障窗口内消息满足「**不丢不重恰好一次**」，与 `test_e2e_cluster_contracts.py` 的 6 场景
逻辑层契约一致（前者 fakeredis 模拟，后者对接真实 Redis）。

### 6. 收尾

```bash
docker compose -f docker-compose.e2e.yml down
```

---

## 6 个场景说明

| # | 场景 | 关键契约 | 验证点 |
| --- | --- | --- | --- |
| ① | **Bot 唯一 owner** | 选主唯一性 + 路由尊重 owner | 并发抢注同 bot 仅 1 赢家；真实 `StreamProducer` 按 `aip:bot:{botId}:owner` 路由无串台；无 bot 绑定的事件落入 `PENDING_OUTBOUND_STREAM` 不丢失；fencing：非 owner 释放被拒 |
| ② | **出站不重不丢** | 精确一次 + 兜底不丢 | 5 条同 bot 事件精确一次进入 owner 流（无重复）；无绑定会话的事件进 `pending` 流（不丢） |
| ③ | **崩溃重投恰好一次** | XAUTOCLAIM 重投语义 | 崩溃遗留 PEL 孤儿被存活者 XAUTOCLAIM 恰好重投 1 次；ACK 后再次重投窗口不再重投 |
| ④ | **H5 粘滞跨语言键** | 粘滞优先 + TS↔Py 键一致 | `aip:session:{sid}:gateway` 粘滞优先于 bot owner 链（gw-a 持 WS 而 bot 归 gw-b → 落 gw-a）；`sessionGatewayKey` TS 模板 == `_session_gateway_key` Py 实现（逐字节 `aip:session:{sessionId}:gateway`） |
| ⑤ | **Core agent 唯一 owner + 入站串行 + 故障转移** | 选主 + 串行 + 重订阅 | 并发 claim 同 agent 仅 1 赢家；同会话经 `RedisSessionLock` 严格串行（`retry>0` 等待而非放弃）；胜者崩溃后幸存者认领并 `refresh_streams` 重新订阅 agent 流并消费 |
| ⑥ | **故障注入逻辑层** | core 崩溃 + gateway 崩溃降级 | 注入 core 崩溃（释放租约 → 新 owner 接管 + 重订阅 + 消费）；注入 gateway 崩溃（删 bot owner 键 → 事件降级 `pending` 不丢、重认领后正确路由到新 owner） |

> 注：`test_e2e_scenario5_inbound_serial` 单独覆盖「同会话并发入站経分布式锁串行」这一子契约，
> 与 ⑤ 互为补充。

---

## 已知缺口 / 范围说明

1. **Lua 复刻边界**：fakeredis 2.x 不支持 `EVAL`，bot 租约 Lua 由 `_ClusterRedis` 按
   `ownership.ts` 字面量复刻。该复刻是「语义等价 double」而非字节级执行真实脚本；真正的
   EVAL 路径由真实 Redis 的 kill-9 流程（`run_fault_injection.py`）兜底验证。
2. **Core Ownership / SessionLock 走 Lua double**：二者依赖 Lua（`_lua_fakeredis.py`），
   故其 `redis` 必须绑定 `_ClusterRedis`（支持 EVAL），而 Stream 读写走 fakeredis（支持
   XAUTOCLAIM / XREADGROUP）。二者共享同一进程内存 store，但分属不同连接实例。
3. **时序未做严格墙钟断言**：场景 ⑤/⑥ 断言「故障转移后能重新订阅并消费」的状态结果，
   不强制 15s/30s 精确时延——时延契约由 docker-compose 拓扑 + 真实运行验证。
4. **不验证网络分区 / 脑裂**：本 E2E 聚焦单 Redis 共享键空间下的选主与路由契约；网络层
   分区、Redis 自身故障不在范围内（属基础设施 SLA）。
5. **不触发 commit**：T11 产物仅落于本地工作树，待用户放行后再提交（与 C+D 一致）。
6. **Dockerfile 前置**：`docker-compose.e2e.yml` 默认 `build: ../gateway` 与 `build: ../backend`，
   需两目录已存在可用 Dockerfile；否则改为 `image:` 指定基础镜像。

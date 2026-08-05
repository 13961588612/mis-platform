# RAGFlow 引擎部署（本地 / 测试）

> 对应设计：[docs/backend/knowledge-base.md](../../docs/backend/knowledge-base.md) · [ADR-018](../../docs/adr/ADR-018-knowledge-base-mis-kb.md)
> **硬要求：** 开发 `mis-kb` / 知识检索适配时，须同步维护本目录，保证**测试环境**可用同一套脚本拉起引擎。

## 1. 形态说明

RAGFlow **不是**单进程 JAR，官方以 **Docker Compose** 运行。本目录提供**可直接拉起的完整依赖栈**：

| 服务 | 容器名 | 作用 |
|------|--------|------|
| `ragflow` | `mis-ragflow` | 应用（API + Web + 文档解析 worker） |
| `mysql` | `mis-ragflow-mysql` | 元数据：租户 / 知识库 / 文档解析状态 |
| `minio` | `mis-ragflow-minio` | 对象存储：原始文件与切片产物 |
| `redis` | `mis-ragflow-redis` | 任务队列 / 缓存（上游自 v0.15 起用 Valkey，Redis 协议兼容） |
| `es01` | `mis-ragflow-es` | Elasticsearch：向量 + 全文检索 |

依赖关系通过 `depends_on: condition: service_healthy` 串起，`ragflow` 会等四个依赖 healthy 后再启动。

## 2. 版本钉扎

所有镜像 tag 均在 `.env.example` 中钉死，**禁止 `latest`**。

**已钉扎版本：**

| 组件 | 变量 | 版本 |
|------|------|------|
| RAGFlow | `RAGFLOW_IMAGE` | `infiniflow/ragflow:v0.26.4` |
| MySQL | `MYSQL_IMAGE_TAG` | `8.0.39` |
| MinIO | `MINIO_IMAGE_TAG` | `RELEASE.2023-12-20T01-00-02Z` |
| Valkey | `VALKEY_IMAGE_TAG` | `8` |
| Elasticsearch | `STACK_VERSION` | `8.11.3` |

主机建议：≥4 核 / ≥16GB RAM / ≥50GB 盘（ES + 解析 worker 吃内存）。低配机可在 `.env` 调小 `ES_HEAP_SIZE`。

## 3. 端口规划（已相对 MIS 开发栈偏移）

为可与 `deploy/docker-compose.dev.yml` **同时运行**，宿主机端口全部避开 MIS 现有占用：

| 变量 | 默认 | 容器内 | 避让对象 |
|------|------|--------|---------|
| `RAGFLOW_HTTP_PORT` | 9380 | 80 | — |
| `MYSQL_HOST_PORT` | 5455 | 3306 | mis-postgres 5432 |
| `MINIO_HOST_PORT` | 9100 | 9000 | mis-minio 9000 |
| `MINIO_CONSOLE_HOST_PORT` | 9101 | 9001 | mis-minio 9001 |
| `REDIS_HOST_PORT` | 6479 | 6379 | mis-redis 6379 |
| `ES_HOST_PORT` | 1200 | 9200 | — |

## 4. 快速启动

### 4.1 准备（**第一步必做：先生成 `.env`**）

> ⚠️ **任何 `docker compose` 命令之前**（包括 `config` / `up` / `ps`），都必须先由 `.env.example`
> 复制出 `.env`。`.env` **未纳入 git**（含真实密码），全新克隆的仓库里不存在它。

```powershell
cd deploy/ragflow
copy .env.example .env        # Linux/macOS: cp .env.example .env
# 必填强密码：MYSQL_PASSWORD / MINIO_PASSWORD / REDIS_PASSWORD / ELASTIC_PASSWORD
# 这四项未设置时 compose 会直接报错拒绝启动（`:?` 约束），不会静默用弱口令
```

**关于「没有 `.env` 时会怎样」：**

| 场景 | 结果 | 说明 |
|------|------|------|
| 无 `.env`，`docker compose config` | ❌ 失败：`required variable MYSQL_PASSWORD is missing a value` | **预期行为**：`:?` 强口令约束生效，拒绝空密码启动 |
| 无 `.env`，`docker compose --env-file .env.example config -q` | ✅ 通过 | 仅用于 **CI/静态校验** compose 文件语法；`.env.example` 里是占位口令，**不可用于真实启动** |
| 有 `.env`，`docker compose config -q` | ✅ 通过 | 正常路径 |

`ragflow` 服务的 `env_file` 采用 Compose **v2.24+ 长语法** `{path: .env, required: false}`，
因此缺少 `.env` 时**不会**再报 `env file ... not found` 这类工具层错误，只会剩下上表中那条
「缺强口令」的业务性报错——信息更明确。（注意：`--env-file` 只影响 **插值**，
无法替代服务级 `env_file` 声明，二者不是同一机制。）

### 4.2 启动

**方式 A（推荐联调）：** 与 MIS 开发栈共用网络，`mis-kb` 可用 `http://ragflow:80` 直连：

```powershell
# 先把 .env 里的 RAGFLOW_NETWORK 改成 dev 栈网络名
docker compose -f deploy/docker-compose.dev.yml -f deploy/ragflow/docker-compose.yml up -d
```

**方式 B（独立引擎栈）：**

```powershell
cd deploy/ragflow
docker compose --env-file .env up -d
```

### 4.3 验收

```powershell
cd deploy/ragflow
docker compose ps            # 五个服务均为 running/healthy
docker compose logs -f ragflow
```

1. 首次启动 ES 与解析 worker 较慢，`ragflow` 的 `start_period` 给了 120s，请耐心等待
2. 浏览器访问 `http://localhost:9380`（仅运维，勿对公网暴露）
3. 在 RAGFlow 控制台创建 **API Key**
4. 把 API Key 写入 `mis-kb` 的 Nacos 配置后，调 health 与建库 PoC：

```yaml
mis:
  kb:
    engine:
      type: ragflow            # 默认 noop；改为 ragflow 才走真实引擎
      base-url: http://ragflow:80
      api-key: ${RAGFLOW_API_KEY}   # 由 Secret / 环境变量注入
```

验证：`GET /api/v1/kb/engine/health` 应返回可用状态。

## 5. 可选：引擎原生同义词 `synonym.json`（运维补充，非产品主路径）

> 🟡 **本节是运维可选补充。业务侧不需要配置此文件。**
>
> 产品主路径见 [knowledge-base-phase2-plan.md Wave D](../../docs/backend/knowledge-base-phase2-plan.md)：
> **同义词由 MIS 持有（S-07 术语表页面），在 `mis-kb` 检索前做查询扩展**。
> **不挂载本文件，MIS 的同义词功能照常完整可用**——两者不是「引擎能力 + 上层开关」的关系，
> 而是**两套彼此独立的扩展实现**。规划文档已明确把「引擎原生词表双写」列为本波次**不做**
> （见 Wave D 决策表第 5 条：多副本/升级时文件难同步，与 MIS 双写易漂移）。

### 5.1 先判断你是否真的需要它

| 场景 | 是否需要挂载 | 说明 |
|------|------------|------|
| 日常业务运营、配置业务同义词 | ❌ **不需要** | 走 MIS **S-07 术语表**页面，这是唯一的业务维护入口 |
| MIS 侧扩展效果排障，想确认「是引擎分词的问题还是词表的问题」 | ⭕ 可临时用 | 用完**建议摘掉**，避免长期两套词表并存 |
| 引擎侧做关键字召回对照实验（不经 MIS 链路，直连 RAGFlow 控制台） | ⭕ 可用 | 属引擎调优实验，不影响 MIS 产品口径 |
| 想「把 MIS 词表同步进引擎，两边一致」 | ❌ **不要做** | 即规划里的 WD-23，本波次明确不做；没有同步机制的双写=必然漂移 |

### 5.2 词表格式

键与值都是**分词后的词元**，引擎按 token 查表，**不做整句匹配**。
**必须显式写双向**——引擎不会自动互推：

```json
{
  "okr": ["目标与关键结果", "objectives and key results"],
  "目标与关键结果": ["okr", "objectives and key results"]
}
```

补充两点（来自上游 `rag/nlp/synonym.py` 的加载与查表逻辑）：

- 新版本加载时会把**键统一转小写**，查表前也对待查词元转小写 ⇒ 英文键**大小写不敏感**，
  但**不要**依赖这一点写出 `OKR` / `okr` 两个键，行为随版本变动
- 每个词元的扩展结果有**条数上限**（上游 `lookup(tk, topn=8)`，默认 8 条），
  写再多别名也只会取前若干条

### 5.3 挂载步骤

**容器内路径：`/ragflow/rag/res/synonym.json`**

> **路径依据（请连同 caveat 一起读）**
>
> - 上游 `rag/nlp/synonym.py` 中 `Dealer.__init__` 按
>   `os.path.join(get_project_base_directory(), "rag/res", "synonym.json")` 定位词表；
> - 镜像内项目根目录为 `/ragflow`——这一点由**本仓库自身的 compose 佐证**：
>   `docker-compose.yml` 里 `ragflow` 服务已有挂载 `ragflow-logs:/ragflow/logs`；
> - ⚠️ **本路径未在 `infiniflow/ragflow:v0.26.4` 镜像内实测**（当前环境无法拉起容器核验）。
>   **路径以 v0.26.4 为准，升级镜像后必须按 5.4 的第 ② 步复核。** 上游确实动过这块
>   （同一文件的依赖 import 曾从 `api.utils.file_utils` 迁到 `common.file_utils`），
>   不要假定路径跨大版本恒定。

**步骤：**

1. 在 `deploy/ragflow/` 下新建 `synonym.json`（非密文件，可提交仓库），内容见 5.2

2. 给 `ragflow` 服务追加只读挂载。**推荐用 override 文件，不动仓库里已跟踪的 `docker-compose.yml`**：

   ```yaml
   # deploy/ragflow/docker-compose.override.yml（新建，仅运维需要时才创建）
   services:
     ragflow:
       volumes:
         - ./synonym.json:/ragflow/rag/res/synonym.json:ro
   ```

   > `:ro` 不是可选项——引擎侧没有任何写这个文件的场景，只读挂载可避免容器内误改后
   > 与宿主机文件不一致。

3. 重启引擎使其生效：

   ```powershell
   cd deploy/ragflow
   docker compose --env-file .env up -d ragflow    # 会自动合并同目录的 override 文件
   ```

**两个必踩的坑：**

- ⚠️ **不是热加载。** 词表只在引擎进程构造 `Dealer` 时读一次，
  **改完 `synonym.json` 必须重启 `ragflow` 容器**，否则改了不生效且没有任何报错。
- ⚠️ **挂载前宿主机文件必须已存在。** 单文件 bind mount 时，若宿主机路径不存在，
  Docker 会**创建一个同名目录**顶上去；引擎读到目录会解析失败并静默退化为空词表
  （只在日志留一行 warning，见 5.4）。

**⚠️ 用「方式 A」与 MIS 开发栈叠加时的路径陷阱：**

Docker 官方规则——多个 `-f` 时，**所有相对路径以第一个 `-f` 文件所在目录为基准**。
故 `docker compose -f deploy/docker-compose.dev.yml -f deploy/ragflow/docker-compose.yml ...`
会把 `./synonym.json` 解析成 `deploy/synonym.json`（**不是** `deploy/ragflow/synonym.json`）。
两种解法任选：

```powershell
# 解法 1：显式指定项目目录（推荐）
docker compose --project-directory deploy/ragflow `
  -f deploy/docker-compose.dev.yml -f deploy/ragflow/docker-compose.yml `
  -f deploy/ragflow/docker-compose.override.yml up -d

# 解法 2：override 里直接写宿主机绝对路径，绕开相对路径解析
```

### 5.4 验证步骤（三级，**不要只做第 ① 级**）

只确认「文件挂进去了」是不够的——上游对词表加载失败的处理是**吞掉异常 + 退化为空字典**，
不会启动失败。所以必须验到「引擎真的加载了」这一层。

**① 文件确实在容器内、且是文件不是目录**

```powershell
docker exec mis-ragflow ls -l /ragflow/rag/res/synonym.json
docker exec mis-ragflow head -c 200 /ragflow/rag/res/synonym.json
```

期望：输出以 `-`（普通文件）开头，且能打印出 JSON 内容。
若显示 `d`（目录）开头，即踩了 5.3 的第二个坑。

**② 引擎确实加载了这份词表（关键的一步）**

看启动日志里**有没有**这几行 warning：

```powershell
docker compose logs ragflow | Select-String -Pattern "synonym"
```

| 日志 | 含义 |
|------|------|
| `Missing synonym.json`（旧版本作 `Miss synonym.json`） | ❌ **没找到文件**——路径错了，或挂载没生效（升级后复核路径就看这条） |
| `Fail to load synonym` | ❌ 文件找到了但**词表为空**：JSON 空对象，或 5.3 的目录坑 |
| `Realtime synonym is disabled, since no redis connection.` | ⭕ 仅表示 Redis 实时词表未启用（见 5.6），**不影响**静态文件生效 |
| 以上前两条**都没有** | ✅ 静态词表加载成功 |

需要更硬的证据时，直接在容器内让引擎自己把词表打出来：

```powershell
docker exec mis-ragflow python -c "from rag.nlp.synonym import Dealer; print(Dealer().dictionary)"
```

期望打印出你写入的键值。打印 `{}` 即未加载成功。

**③ 检索链路确实用上了（端到端 A/B）**

在 RAGFlow 控制台对同一知识库做两次检索：先用**原词**、再用只在词表里出现的**别名**。
若别名能召回原词的文档，说明扩展在检索链路生效。

> 做这一步请**直连 RAGFlow 控制台**，不要走 MIS 命中测试页——
> 后者会叠加 MIS 侧扩展，两个变量混在一起，测不出引擎侧到底有没有生效（原因见 5.5）。

### 5.5 与 MIS 侧的关系：叠加生效 + 轨迹只覆盖一半

> ⚠️ **这是本节最需要记住的一条。**

**两侧词表会叠加生效，且只有 MIS 侧的扩展在命中测试里看得见：**

```
用户问句
  └─> mis-kb：SynonymExpandService 按 MIS 词表扩展   ← 扩展轨迹【看得见】
        └─> RAGFlow：再按 synonym.json 对词元二次扩展 ← 扩展轨迹【看不见】
              └─> 实际召回
```

后果：**同时启用两侧词表时，命中测试页显示的「实际检索 query」并不是引擎最终用于召回的
query**。排查召回异常（召回过多 / 召回了看似无关的文档）时必须**两边一起看**：

1. 先看 MIS 命中测试页的扩展轨迹，确认 MIS 侧扩展了哪些词；
2. 再按 5.4 的第 ② 步 dump 引擎词表，确认引擎侧还额外扩了什么；
3. 临时摘掉 `synonym.json` 挂载并重启，若异常消失即可定位到引擎侧。

**关于 `capabilities.synonym` 能力码——请注意当前代码现状：**

| 项 | 现状 |
|----|------|
| 规划口径 | `synonym` 码值属 **Wave D**，语义为「引擎侧是否另有原生词表可运维同步」，取值为「有挂载/配置才 true」 |
| **代码现状** | **尚未实现。** `EngineCapabilities` 目前只有 `hybrid` / `rerank` / `metadata_filter` / `replace` 四位；`RagflowAdapter.capabilities()` 返回 `EngineCapabilities.of(rerankAvailable, true, true, true)`，**不含也不探测 `synonym`** |
| 因此 | **挂不挂载 `synonym.json`，都不会改变任何 capability 取值**，MIS 前端也不会因此变化。别指望用能力码来判断「引擎侧词表挂没挂」——只能用 5.4 的方法查 |

> 反过来同样重要（规划文档原话）：MIS 侧查询扩展**不依赖** `synonym` capability。
> 不要把「未挂载 `synonym.json`」误读成「平台不能做同义词」。

### 5.6 Redis 实时词表（比静态文件更不推荐）

上游支持从 Redis 键 `kevin_synonyms` 读取同一份 JSON 结构覆盖静态词表。
**不建议在 MIS 场景使用**，因为它的刷新是**双重延迟**的：需同时满足
「距上次加载 ≥ 1 小时」**且**「自上次加载后已发生 ≥ 100 次查表」才会重新拉取。
写进去之后长时间不生效是**预期行为**，极易被误判成故障。真要用，改完请直接重启 `ragflow`。

### 5.7 ⚠️ MIS 侧同义词开关是「双闸」——库内开了还不够（U2 / 设计 §8.3）

与 §5 的引擎侧词表无关，但**运维必须同时知道**这一条：MIS 自己的同义词扩展受**两个开关**
控制，是**与（AND）**关系，任一为 `false` 即完全不扩展：

| 闸 | 位置 | 谁能改 |
|----|------|--------|
| `kb_synonym_config.enabled` | **库内**（PostgreSQL） | 管理员在「同义词配置」页面自助开关 |
| `killSwitchEnabled` | **Nacos** 配置项 `mis.kb.synonym.enabled`（默认 `true`） | **只有运维**，页面只读 |

页面上显示的 `effective = enabled && killSwitchEnabled` 才是真正生效状态。

> **运维动作**：当业务方在库内把同义词开关打开后，**需同步确认 / 将 Nacos 对应熔断闸
> `mis.kb.synonym.enabled`（即页面上的 `killSwitchEnabled`）置为 `true`**，否则库内开关
> 开了也不会扩展，页面 `effective` 仍为 `false`。
>
> 该项默认即为 `true`；只有此前因故障熔断把它降为 `false` 过，才需要显式改回。
> 排障口诀：**用户说「开关明明开了却没效果」，先看 `killSwitchEnabled`。**

## 6. 与 MIS 的边界约定

- `mis-kb` **不得**把 API Key 下发前端；调用链只能是 前端 → BFF → mis-kb → RAGFlow
- 引擎原生标识（`engine_library_ref` / `engine_document_ref`）只存在于 `mis-kb` 库内，**不出现在** BFF 响应与引用（citation）中
- 未配置引擎时 `mis.kb.engine.type=noop`，`mis-kb` 主流程（建库/上传/权限/问答落库）仍可跑通，仅检索返回空
- 业务同义词以 MIS **S-07 术语表**为准；引擎 `synonym.json` 仅为可选运维补充（见 §5），
  **业务侧不需要配置该文件**

## 7. 升级引擎

1. 改 `.env.example` 中对应 tag + 同步更新上文「已钉扎版本」表
2. 回归 `mis-kb` Adapter 单测与联调清单
3. 切换 `DOC_ENGINE`（elasticsearch ↔ infinity）需先清空 `mis-ragflow-es` 卷再重建
4. **若挂载了可选的 `synonym.json`（§5）**：按 §5.4 第 ② 步复核容器内路径是否仍为
   `/ragflow/rag/res/synonym.json`——该路径由上游代码决定，跨版本可能变动

## 8. 不要做的事

- 不要在业务镜像内嵌 RAGFlow
- 不要用 `latest` 上测试/生产
- 不要让测试验收依赖「开发者本机手工 docker run」而无仓库脚本
- 不要把 `.env`（含真实密码 / API Key）提交 Git

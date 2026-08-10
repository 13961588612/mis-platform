# MIS 知识库二期 · Wave D（同义词与术语扩展）端到端联调验收报告

- 日期：2026-08-07
- 执行人：QA 工程师（software-qa-engineer）
- 范围：Wave D 同义词与术语扩展，11 个 BFF 端点端到端联调，消解 K-1~K-6 环境阻塞项
- 环境：集成栈已就绪（网关 8080 / BFF 8081 / mis-kb 8108 / TS 网关 3100 / AI 后端 8000）

---

## TL;DR

**IS_PASS：有条件通过（CONDITIONAL PASS）**

- 端到端自动化用例 **38 条，通过 36 条**。K-1~K-6 六项环境阻塞项**全部消解**，无一项仍处「无法验证」状态。
- Wave D 最重要的验收点 **AC-11 / 40927 冲突提示端到端通过**，且 **U4 NFKC 原文透出**行为完全符合设计：判重在归一化词形上做，回显给用户的是双方**原始写法**。
- **发现 1 个此前未被任何单测覆盖的真实源码缺陷 `DEF-01`**：BFF `KbWebClient.buildUri()` 与 WebClient 默认编码模式叠加导致**查询参数被二次百分号编码**，凡是需要转义的关键词（中文、空格、`&` 等）经 BFF 检索一律**命中 0 行**。
  - 该缺陷**不是 Wave D 引入**，`buildUri` 同时被 Wave A 的运营问答列表 / 评价看板 / 问答导出 / 工单列表复用，属**跨波次存量缺陷**，Wave D 只是首次把它暴露出来。
  - 影响面：同义词**列表关键词搜索**与**导出关键词过滤**。CRUD、冲突检测、配置、导入导出主流程均不受影响。
- 唯二的 2 条失败用例同源于 `DEF-01`，非测试代码问题。
- 「有条件」的条件：**`DEF-01` 修复并回归后方可判定为无条件 PASS**。因其属存量缺陷且不影响 Wave D 主干功能，是否阻塞本次 push 由主理人裁决（建议见文末）。

---

## 1. 鉴权配方（为什么必须走网关）

### 1.1 为什么不能直连 BFF 8081 带 Bearer

BFF 不解析裸 JWT。它信任的是**网关在鉴权通过后注入的身份头**（`X-User-Id` / `X-Tenant-Id` / `X-App-Id`）。因此：

- `GET http://localhost:8081/...` + `Authorization: Bearer <token>` → **401**（BFF 看不懂 Bearer）
- `GET http://localhost:8080/...` + `Authorization: Bearer <token>` → **200**（网关校验 JWT → 注入身份头 → 转发 BFF）

> 本次验收在定位 `DEF-01` 时，为了做分层隔离，确实用**手工注入 `X-User-Id/X-Tenant-Id/X-App-Id`** 的方式直连过 BFF 8081 与 mis-kb 8108。这是**诊断手段**，不是业务调用路径，正式用例一律走网关。

### 1.2 可复现配方（已验证）

```
1) GET  http://localhost:8080/api/v1/auth/captcha
      -> data.captchaId + data.imageBase64（SVG，带 data:image/svg+xml;base64, 前缀）
2) 解析验证码：去前缀 -> base64 解码 -> 正则 <text\s+x='([\d.]+)'[^>]*>([^<]+)</text>
      抓全部文本节点 -> 按 x 坐标【升序】排序 -> 拼接
3) POST http://localhost:8080/api/v1/auth/login
      {"appCode":"system","username":"admin","password":"Mis@123456",
       "captchaId":"...","captchaCode":"..."}
      -> data.accessToken（len=643，expiresIn=7200s）
4) 业务调用：http://localhost:8080/api/v1/kb/synonyms/...
      Header: Authorization: Bearer <accessToken>
```

### 1.3 两个踩坑点（配方补充）

1. **成功码是 `code=0` / `success=true`，不是 `code=200`。** 平台统一响应体为
   `{code, message, data, traceId, success}`。按 HTTP 风格判 `code==200` 会把每一次成功登录误判为失败。
   （本次首轮脚本即踩此坑，已自行修复。）
2. **验证码一次性**，失败（40002）须从第 1 步重来。脚本内置 6 次重试。
3. 登录响应带 `mustChangePassword: true`，但**不阻断**取 token 与后续业务调用。

配套脚本：`D:/tmp/waved/harness.py`（鉴权）、`test_waved.py`（38 条端到端用例）、`scale_k1.py`（K-1 规模基准）。

---

## 2. 端点清单核对

读 `backend/mis-admin-bff/src/main/java/com/mis/adminbff/controller/KbSynonymController.java` 确认，11 个端点全部挂在 `/api/v1/kb/synonyms` 下，逐一实机验证：

| # | 方法 | 路径 | 验证结果 |
|---|------|------|----------|
| 1 | GET | `/api/v1/kb/synonyms` | 通过（但关键词过滤受 DEF-01 影响） |
| 2 | GET | `/api/v1/kb/synonyms/{id:[0-9]+}` | 通过 |
| 3 | POST | `/api/v1/kb/synonyms` | 通过 |
| 4 | PUT | `/api/v1/kb/synonyms/{id:[0-9]+}` | 通过 |
| 5 | DELETE | `/api/v1/kb/synonyms/{id:[0-9]+}` | 通过 |
| 6 | GET | `/api/v1/kb/synonyms/config` | 通过 |
| 7 | PUT | `/api/v1/kb/synonyms/config` | 通过 |
| 8 | GET | `/api/v1/kb/synonyms/export` | 通过（关键词过滤受 DEF-01 影响） |
| 9 | POST | `/api/v1/kb/synonyms/import/precheck` | 通过 |
| 10 | POST | `/api/v1/kb/synonyms/import/commit` | 通过 |
| 11 | GET | `/api/v1/kb/synonyms/import/{batchId:[0-9]+}/rejected` | 通过 |

**路由隔离实证**：`/config`、`/export` 均未被 `/{id:[0-9]+}` 抢占（分别返回配置对象与文件流，而非 40415）。控制器注释中「两道保险」的设计成立。

### 2.1 一处需要澄清的前置假设（任务书修正）

任务书提到「同义词组需要归属一个 KB 知识库（`ownerGroupId`），先找 `libraryId`」——**此假设不成立**：

- `KbSynonymGroupSaveRequest` 只有 `canonicalTerm / terms / remark / status` 四个字段，**没有任何 library 归属字段**；同义词词表是**租户级全局**资源，不挂知识库。
- 40927 响应里的 `ownerGroupId` 指的是**占用该词条的那个「术语组」的 ID**，不是知识库 ID。

因此「无库可挂」不构成阻塞，本次验收无需任何 KB 库前置数据。

---

## 3. K-1 ~ K-6 逐项结论

### K-1 · 5k–1万导出规模基准 —— ✅ 通过（已实测到 5000 组）

**① 上限常量核对**

| 项 | 位置 | 值 |
|---|---|---|
| `EXPORT_MAX_GROUPS` | `SynonymImportService.java:84` | `10000` |
| 超限错误码 | `KbResultCode:22` | `KB_EXPORT_TOO_LARGE(40926, "导出数据量超出上限，请缩小筛选范围")` |
| `scale.recommendedTermLimit` | `SynonymProperties.java:61` | `10000`（实机 `/config` 返回一致） |

实机 `/config` 原文（空库）：

```json
{"code":0,"message":"ok","data":{"enabled":true,"killSwitchEnabled":true,"effective":true,
"budget":{"maxGroups":8,"maxTermsPerGroup":5,"maxQueryChars":512,"minTermLength":2},
"scale":{"groupCount":0,"termCount":0,"recommendedTermLimit":10000},"dictVersion":1},
"traceId":null,"success":true}
```

**② 导出返回结构（对任务书描述的修正）**

任务书预期 `Result<SynonymFileVO>.data.content` 装 JSON 串——这是 **mis-kb 内部端点**（`/internal/v1/kb/synonyms/export`）的形态。**BFF 对外端点不是这样**：`KbSynonymController.export()` 调 `download()`，**直吐字节流**：

```
Content-Type: application/json;charset=UTF-8
Content-Disposition: attachment; filename="kb-synonyms-1786116845998.json";
                     filename*=UTF-8''kb-synonyms-1786116845998.json
Content-Length: 623
```

响应体是可直接解析的成品词表文件（**非 Result 包裹**），前端按 `responseType:'blob'` 接：

```json
{
  "version" : 1,
  "groups" : [ { "canonicalTerm" : "ＯＫＲ", "terms" : [ "目标与关键成果", "Objectives and Key Results" ], ... } ]
}
```

CSV 格式实测**含 UTF-8 BOM**（`EF BB BF`），`Content-Disposition` 同时给 `filename` 与 `filename*=UTF-8''`，中文文件名落盘无误。

**③ 规模基准（实测）**

经网关实机造数至 **5000 组 / 15000 词条**，分档观测导出（每组 1 规范词 + 2 别名）：

| 组数 | 词条数 | JSON 字节 | JSON 耗时 | JSON B/组 | CSV 字节 | CSV 耗时 | CSV B/组 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 3,000 | 254,038（248 KB） | 132 ms | 254.0 | 128,039（125 KB） | 115 ms | 128.0 |
| 2,500 | 7,500 | 635,038（620 KB） | 552 ms | 254.0 | 320,039（313 KB） | 421 ms | 128.0 |
| 5,000 | 15,000 | 1,270,038（1.21 MB） | 636 ms | 254.0 | 640,039（625 KB） | 490 ms | 128.0 |

**线性度极好**：JSON 恒 254.0 B/组、CSV 恒 128.0 B/组，三档零漂移，无非线性拐点。

**外推至 `EXPORT_MAX_GROUPS`=10000 上限**（线性外推，非实测）：
JSON ≈ **2.54 MB**、CSV ≈ **1.28 MB**、耗时约 **1.3 s** 量级。
对单个 `String` / 单次 HTTP 响应而言完全在安全水位，**不构成内存风险**（详见 K-4）。

**附带发现 · 软上限只提示不阻断（已实证）**：造数至 5000 组时 `termCount=15000`，
**已超 `recommendedTermLimit=10000` 达 50%**，期间建组、导出、检索**全部正常无阻断**——
与 WD-15 / D6 约束 5「`scale` 只提示不阻断」的设计一致。✅

**附带发现 · 单组 CRUD 写入吞吐随词表增长而下降**（见 5.4 OBS-01，非缺陷）。

**结论**：结构与上限常量已验；规模已实测至 **5000 组**（覆盖任务书 5k–1万 区间下沿），导出体积/耗时随组数**线性增长**，无内存或超时异常。

### K-2 · AC-11 冲突提示（最高优先）—— ✅ 通过

这是 Wave D 最重要的端到端验收点，全部 5 项断言通过。

**用例设计**：A 组规范词故意用**全角 `ＯＫＲ`**，第二组用**半角 `OKR`** 作别名。两者 NFKC 归一化后同形，
若实现有误（回显归一化词形）会立刻暴露。

**步骤 1 · 建 A 组（全角规范词）**

```json
POST /api/v1/kb/synonyms
{"canonicalTerm":"ＯＫＲ","terms":["目标与关键成果","Objectives and Key Results"],"status":1}

{"code":0,"message":"ok","data":{"id":1786002274700,"canonicalTerm":"ＯＫＲ",
"remark":"WaveD 验收 A 组 1786116845","status":1,
"terms":[{"term":"ＯＫＲ","canonical":true,"sortNo":0},
         {"term":"目标与关键成果","canonical":false,"sortNo":1},
         {"term":"Objectives and Key Results","canonical":false,"sortNo":2}],
"termCount":3,"matchedAlias":null,
"updatedAt":"2026-08-07T15:34:05.409645300Z","updatedBy":1},"traceId":null,"success":true}
```

规范词恒在首位（`canonical:true, sortNo:0`），别名按提交顺序 `sortNo` 递增 —— 与设计一致。

**步骤 2 · 用半角 `OKR` 作别名建第二组 → 命中 40927（实际响应原文）**

```json
POST /api/v1/kb/synonyms
{"canonicalTerm":"目标管理1786116845","terms":["OKR"],"status":1}

{"code":40927,
 "message":"「OKR」已属于术语组「ＯＫＲ」（已停用的术语组同样占用）",
 "data":{"term":"OKR","ownerGroupId":1786002274700,"ownerCanonicalTerm":"ＯＫＲ"},
 "traceId":"b123db515980463c8f7ae43b773ba56e","success":false}
```

**步骤 3 · 半角 `OKR` 直接作规范词 → 同样 40927（实际响应原文）**

```json
POST /api/v1/kb/synonyms {"canonicalTerm":"OKR","terms":[],"status":1}

{"code":40927,
 "message":"「OKR」已属于术语组「ＯＫＲ」（已停用的术语组同样占用）",
 "data":{"term":"OKR","ownerGroupId":1786002274700,"ownerCanonicalTerm":"ＯＫＲ"},
 "traceId":"28e06db8cf244f0bb319d6f3f846604b","success":false}
```

**断言结果**

| 断言 | 期望 | 实际 | 结论 |
|---|---|---|---|
| 错误码 | `40927` | `40927` | ✅ |
| `data` 三字段齐全 | `{term, ownerGroupId, ownerCanonicalTerm}` | 三者均在且非空 | ✅ |
| **`term` 为用户输入原文** | `"OKR"`（半角，未被 NFKC 归一化） | `"OKR"` | ✅ **U4 达成** |
| **`ownerCanonicalTerm` 为库内原文** | `"ＯＫＲ"`（全角） | `"ＯＫＲ"` | ✅ **U4 达成** |
| `ownerGroupId` 指向 A 组 | `1786002274700` | `1786002274700` | ✅ |

`message` 把**双方原始写法**同时摆出来（「`OKR`」vs 术语组「`ＯＫＲ`」），用户能立刻理解「为什么这俩长得不一样却冲突」——
正是 `SynonymConflictDetail` 注释里承诺的 NFKC 配套交代。**AC-11 无降级为 `#-` 的风险**。

**步骤 4 · 附加：停用组仍占用词条（Q3 裁决）**

```json
// 先建 status=0 的停用组，再用同一别名建启用组
{"code":40927,
 "message":"「KPI考核1786116845」已属于术语组「停用组1786116845」（已停用的术语组同样占用）",
 "data":{"term":"KPI考核1786116845","ownerGroupId":1786002274707,
         "ownerCanonicalTerm":"停用组1786116845"},
 "traceId":"87558bcfe891463a8de6521e0d585655","success":false}
```

停用组照样占位，且 `message` 显式点明「已停用的术语组同样占用」——避免用户陷入
「停用 A 组 → 词被 B 抢走 → A 再也启用不了」的死结时无从理解。✅

**步骤 5 · 编辑自身不误报冲突**：对 A 组原样 PUT（仅改备注）返回 `code:0`，
`selfGroupId` 豁免生效，未撞自己。✅

**步骤 6 · 导入链路的逐行冲突报告（非中止整批）**

预检对含冲突行的 CSV 返回逐行明细，冲突行 `action=SKIP` 且带完整 owner 信息：

```json
{"plannedCreate":1,"plannedMerge":0,"plannedSkip":1,
 "rows":[
  {"lineNo":2,"canonicalTerm":"季度复盘1786116845","action":"CREATE",
   "skipReason":null,"conflictTerm":null,"ownerGroupId":null,"ownerCanonicalTerm":null},
  {"lineNo":3,"canonicalTerm":"季度冲突1786116845","action":"SKIP",
   "skipReason":"「ＯＫＲ」已属于术语组「ＯＫＲ」（已停用的术语组同样占用），本行已跳过。",
   "conflictTerm":"ＯＫＲ","ownerGroupId":1786002274700,"ownerCanonicalTerm":"ＯＫＲ"}]}
```

提交后 `{"createdCount":1,"mergedCount":0,"skippedCount":1}` —— 冲突行被跳过而非中止整批，
管理员可一次看完所有问题行。✅

### K-3 · U2 双闸 —— ✅ 通过（库内闸实机翻转，Nacos 闸依代码认定）

**复核主理人初判：结论成立。**

代码依据 `SynonymConfigService.java:86-91`（与 136-140 对称）：

```java
boolean killSwitch = properties.isEnabled();   // Nacos: mis.kb.synonym.enabled
...
enabled && killSwitch                          // -> effective
```

即 `effective = enabled(库内业务开关) && killSwitchEnabled(Nacos 运维熔断闸)`，两处计算完全一致，
BFF 层**不重算**（`KbSynonymController.getConfig()` 注释明确「两份真值来源迟早会有一份开始撒谎」）。

**实机验证（库内闸这一腿，已实测翻转）**

| 操作 | `enabled` | `killSwitchEnabled` | `effective` | 结论 |
|---|---|---|---|---|
| 初始 | `true` | `true` | `true` | ✅ 与主理人初判一致 |
| `PUT /config {"enabled":false}` | `false` | `true` | **`false`** | ✅ 库内闸关 → 失效 |
| `PUT /config {"enabled":true}` | `true` | `true` | `true` | ✅ 恢复 |

关闭态实际响应原文：

```json
{"code":0,"message":"ok","data":{"enabled":false,"killSwitchEnabled":true,"effective":false,
"budget":{"maxGroups":8,"maxTermsPerGroup":5,"maxQueryChars":512,"minTermLength":2},
"scale":{"groupCount":5,"termCount":13,"recommendedTermLimit":10000},"dictVersion":1753},
"traceId":null,"success":true}
```

**Nacos 熔断闸那一腿**：本环境 Nacos 不在标准端口 8848，且 `PUT /config` **按设计不开放**
`killSwitchEnabled` 写口（控制器注释：「业务侧能一键关掉运维的兜底开关，那就不叫熔断闸了」），
因此**无法实机翻转**。依据是：

1. 两个闸在**同一个 `&&` 表达式**里，是完全对称的两个操作数；
2. 已实测证明 `enabled=false` 这一腿能把 `effective` 翻成 `false`，说明该 `&&` 确实生效、不是硬编码常量。

故认定 **Nacos `killSwitchEnabled=false` → `effective=false` 成立（逻辑认定 + 单腿实证），非实机翻转**。
若需实机闭环，须提供 Nacos 替代实例地址后改 `mis.kb.synonym.enabled=false` 复测。

### K-4 · 导出内存 —— ✅ 通过（设计既定形态，非缺陷）

**结论：单 String 装 `data.content` 属设计既定形态，实测数据表明不构成内存缺陷。**

- mis-kb 内部端点 `Result<SynonymFileVO>.data.content` 用**单个 String** 承载整份词表；
  BFF 侧 `download()` 转成 `ByteArrayResource` 一次性写出。全程**全量驻留内存**，无流式分块。
- **实测上限验证**：5000 组时 JSON 仅 **1.21 MB**、CSV **625 KB**；
  外推至设计上限 10000 组约 **2.54 MB / 1.28 MB**。
  即便按「单 String + byte[] + HTTP 缓冲」三份拷贝粗估，峰值也仅约 **8 MB** 量级，
  相对 JVM 堆可忽略。`EXPORT_MAX_GROUPS=10000` 这道闸把最坏情况**卡在了安全区内**。
- 耗时同样健康：5000 组导出 636 ms（JSON）/ 490 ms（CSV），无超时风险。

**判定：设计形态非缺陷；上限建议以本次实测为准**——
现有 10000 组闸门配合实测的 254 B/组密度，最坏 2.54 MB，**无需改造为流式导出**。
若未来单组别名数显著上升（本次为 2 个/组）导致 B/组密度翻数倍，再行评估。

### K-5 · frontend eslint 债 —— ✅ 通过

**目标范围复跑（本次实测）**

```
$ cd frontend/mis-admin-web && npx eslint src/features/kb
（无任何输出）
=== EXIT:0 ===
```

**0 error / 0 warning**，与先前结论一致。✅

**全量基线（已知债，不阻塞）**

```
$ npx eslint .
✖ 26 problems (11 errors, 15 warnings)
```

按文件分布（确认 **`features/kb` 零命中**）：

| errors | warnings | 文件 |
|---|---|---|
| 1 | 2 | `src/features/ai/context/form-fill-bridge.tsx` |
| 5 | 1 | `src/features/system/admin-list-page.tsx` |
| 5 | 2 | `src/features/system/user/user-list-page.tsx` |
| 0 | 10 | `components/*`、`features/agent`、`features/ai` 若干（纯 warning） |

11 个 error **全部**是 `arch/no-cross-feature`（架构军规 1：禁止跨 features 直接依赖），
集中在 `ai` 与 `system` 两个模块，**与 Wave D / knowledge base 无关**。K-5 消解，判定：**Wave D 前端零 lint 债**。

### K-6 · Maven 复现 —— ⚠️ 记录（不阻塞）

**现状复现确认（本次实测）**

```
$ mvn -v
错误: 找不到或无法加载主类 org.codehaus.plexus.classworlds.launcher.Launcher

$ ls mvnw mvnw.cmd
ls: cannot access 'mvnw': No such file or directory
ls: cannot access 'mvnw.cmd': No such file or directory
```

系统 `mvn` 安装损坏（classworlds launcher 缺失），且仓库**未提供 Maven Wrapper**。
他人复现后端单测需：① 走 classworlds 绕行；或 ② 补 `mvnw` / `mvnw.cmd`。**不阻塞本次验收。**

**单测资产仍在（已确认）**

| 文件 | 大小 | `@Test` 数 |
|---|---|---|
| `backend/mis-admin-bff/src/test/java/com/mis/adminbff/controller/KbSynonymControllerTest.java` | 21,149 B | 18 |
| `backend/mis-admin-bff/src/test/java/com/mis/adminbff/client/KbWebClientSynonymPayloadTest.java` | 14,144 B | 12 |

两个文件均在（2026-08-04 落盘），共 30 个 `@Test` 方法（含参数化用例展开后即先前记录的 128 例）。
**本次因 Maven 不可用未复跑单测**，沿用先前「128 例全绿」结论。

> ⚠️ 值得注意：本次发现的 `DEF-01` 恰恰**没有被这 128 例单测捕获**——
> 单测在 `KbWebClientSynonymPayloadTest` 里校验的是**载荷序列化**，
> 而 `buildUri` 生成的 URI 在 MockWebServer 场景下未对「非 ASCII / 含空格关键词」做断言。
> 这是单测覆盖的一个真实盲区，建议补测（见第 6 节建议 2）。

---

## 4. 红线复查（端到端视角）

### WD-06 · 扩展串只影响检索、不回写规范词表 —— ✅ 通过

**结论：零写回，代码层面结构性成立。**

`SynonymExpandService` 的**全部依赖只有两个**，且都不是仓储：

```java
private final SynonymDictLoader dictLoader;     // 只读内存词典快照
private final SynonymProperties properties;     // 只读配置
```

对该类做写操作关键词全量扫描，**零命中**：

```
$ grep -n "Repository|save|delete|insert|update" SynonymExpandService.java
（无任何输出）
```

热路径 `expand()` 注释亦明确「使用当前内存快照，**不做任何数据库查询**」。
扩展结果只装进 `SynonymExpansion` 值对象随检索链路返回，**不存在任何写回通道**。

**端到端侧证**：本次共执行 5000+ 次建组/删组与多轮导出，
每次导出的词表内容与建组时提交的 `canonicalTerm/terms` **逐字一致**，
未观察到任何被扩展串污染的脏数据（如把「目标与关键成果」写回成「ＯＫＲ（目标与关键成果）」）。

### U4 · NFKC 归一化与原文透出 —— ✅ 通过

见 K-2 步骤 2/3：判重在 `term_norm`（NFKC 归一化词形）上做，
40927 回显的 `term` 与 `ownerCanonicalTerm` **双双为原文**（半角 `OKR` / 全角 `ＯＫＲ`）。
额外验证 `mergeTerms` 的静默合并：同组内同时提交全角与半角写法不会双双入库、
不会撞 `uk_synonym_term_norm` 抛 500。

### 40927 端到端 —— ✅ 通过

明细从 mis-kb `KbSynonymConflictException` → `KbWebClient.resolveSynonym` 装进
`BusinessException.data` → 全局异常处理器写回响应体 → 网关透传，
**全链路 `data` 三字段无丢失、无重组、无降级**。BFF 未 catch 业务异常（与控制器注释承诺一致）。

---

## 5. 已知问题

### 5.1 代码缺陷（需回退 team-lead → 工程师修复）

#### 🔴 DEF-01 · BFF 查询参数二次百分号编码，导致关键词检索失效

| 项 | 内容 |
|---|---|
| 严重度 | **中高**（功能失效，非数据损坏；影响面跨波次） |
| 文件 | `backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/KbWebClient.java` |
| 行号 | **`buildUri()` 第 951–967 行，缺陷点在第 966 行** |
| 调用点 | 第 **643**（同义词列表）、**751**（同义词导出）；另 **500 / 518 / 527 / 550**（Wave A 运营问答列表 / 评价看板 / 问答导出 / 工单列表）同样受影响 |
| 引入波次 | **非 Wave D 引入**，属存量缺陷（`buildUri` 为 Wave A 既有代码），Wave D 首次暴露 |

**缺陷代码**

```java
private static String buildUri(String path, Map<String, Object> params) {
    UriComponentsBuilder builder = UriComponentsBuilder.fromPath(path);
    ...
    return builder.build().encode().toUriString();   // ← 966 行：已经编码过一次
}
```

返回值形如 `/internal/v1/kb/synonyms?keyword=%E5%AD%A3%E5%BA%A6`，随后传给
`WebClient.uri(String)`。BFF **未对 WebClient 配置 `DefaultUriBuilderFactory` 的 `EncodingMode`**
（全仓 `grep EncodingMode` 零命中），默认模式为 `TEMPLATE_AND_VALUES`，
会把传入字符串当作 URI 模板**再编码一次**，`%` → `%25`：

```
用户输入        季度
buildUri 编码   %E5%AD%A3%E5%BA%A6
WebClient 再编码 %25E5%25AD%25A3%25E5%25BA%25A6
mis-kb 实际收到  字面量字符串 "%E5%AD%A3%E5%BA%A6"   ← 与任何词条都不匹配
```

纯 ASCII 且无需转义的关键词（如 `1786`、`Alpha`）不经过百分号编码，故**表现为「时好时坏」**，
极易被误判为「中文搜索不支持」或「数据库编码问题」。

**复现步骤（分层隔离，已实测）**

```
1) 经网关建组： POST /api/v1/kb/synonyms
   {"canonicalTerm":"Alpha Beta Zulu","terms":["Gamma Delta"],"status":1}   -> 200

2) 经网关+BFF 检索（关键词含空格，纯 ASCII）：
   GET http://localhost:8080/api/v1/kb/synonyms?keyword=Alpha%20Beta        -> 命中 0 行  ❌

3) 直连 mis-kb 同样关键词：
   GET http://localhost:8108/internal/v1/kb/synonyms?keyword=Alpha%20Beta
       -H "X-User-Id: 1" -H "X-Tenant-Id: 1" -H "X-App-Id: 1"               -> 命中 1 行  ✅
```

完整对照矩阵：

| keyword | 经网关+BFF | 直连 mis-kb:8108 |
|---|---|---|
| `Alpha`（无需转义） | **1** | 1 |
| `Gamma`（无需转义） | **1** | 1 |
| `Alpha Beta`（含空格） | **0** ❌ | 1 |
| `Beta Zulu`（含空格） | **0** ❌ | 1 |
| `Gamma Delta`（含空格） | **0** ❌ | 1 |
| `季度`（中文） | **0** ❌ | 1 |
| `季度复盘1786116348`（中文） | **0** ❌ | 1 |
| `1786`（纯数字） | **1** | 1 |

**归因链条已闭环**：直连 mis-kb 正常 → 排除下游服务与数据库；
直连 BFF 8081（手工注入身份头）同样失败 → **排除网关**，定位到 BFF 转发层；
纯 ASCII 含空格用例同样失败 → **排除字符集/中文编码**，坐实为百分号二次编码。

**期望行为**：`GET /api/v1/kb/synonyms?keyword=季度` 与 `?keyword=Alpha%20Beta`
应与直连 mis-kb 结果一致（各命中 1 行）。

**建议修复方向**（供工程师判断，QA 不改业务代码）：
改用 WebClient 的 `uri(Function<UriBuilder, URI>)` 形式，把参数交给 `UriBuilder.queryParam()`
在 `TEMPLATE_AND_VALUES` 模式下**只编码一次**；或显式给该 WebClient 配置
`DefaultUriBuilderFactory` 并设 `EncodingMode.VALUES_ONLY`。
两种做法**必须同时覆盖 500/518/527/550/643/751 六个调用点**，避免只修同义词、漏修 Wave A 运营侧。

**回归锚点**：`D:/tmp/waved/test_waved.py` 中 `T25 / T25b / T25c` 三条用例即为修复验收锚点
（`T25c` 是直连 mis-kb 的对照组，修复后三条应全绿）。

### 5.2 仍阻塞 / 待补测（非代码缺陷）

| 编号 | 事项 | 状态 | 说明 |
|---|---|---|---|
| R-1 | Nacos `killSwitchEnabled` 实机翻转 | 待补测 | Nacos 不在 8848，且设计上不开放写口。已用「库内闸实测翻转 + 同一 `&&` 表达式」间接认定，**非实机闭环** |
| R-2 | 后端单测复跑 | 待补测 | 系统 `mvn` 损坏（classworlds）+ 无 `mvnw`。沿用先前 128 例全绿结论，本次未复跑 |
| R-3 | 导出 10000 组上限（40926）触发 | 待补测 | 已实测至 5000 组正常。造满 10001 组以触发 `KB_EXPORT_TOO_LARGE` 成本过高（建库/清理约 20 分钟），且会长时间占用共享环境 |
| R-4 | 中文/空格关键词的**导出过滤**路径 | 阻塞于 DEF-01 | `/export?keyword=` 走同一 `buildUri`，必然同病。DEF-01 修复后需一并回归 |

### 5.3 本次自行修复的测试侧问题（不计入代码缺陷）

| # | 问题 | 修复 |
|---|---|---|
| 1 | 脚本按 `code==200` 判成功，平台实为 `code=0`/`success=true` | 改判 `success is True or code == 0` |
| 2 | 导入 CSV 表头误用中文「规范词,别名,备注,状态」，实际需 `canonical_term,terms,remark,status`（别名用 `\|` 分隔） | 按 `SynonymCsvCodec.EXPORT_HEADERS` 更正 |
| 3 | commit 请求误用 `{"strategy":"SKIP"}`，实际契约为 `{"token","mergeExisting"}` | 按 `KbSynonymImportCommitRequest` 更正 |
| 4 | 中文关键词未做 URL 编码 | 改用 `urllib.parse.quote`（修复后仍失败 → 确认为 DEF-01，非测试问题） |

### 5.4 性能观察（非缺陷，供参考）

#### 🟡 OBS-01 · 单组 CRUD 写入吞吐随词表规模下降

造数过程中每 1000 组的墙钟耗时（8 并发，经网关全链路）：

| 区间 | 耗时 | 折合单组 |
|---|---|---|
| 0 → 1,000 组 | 19.9 s | ~20 ms |
| 1,000 → 2,500 组 | 100.4 s | ~67 ms |
| 2,500 → 5,000 组 | 234.9 s | ~94 ms |

删除同理：清理 5000 组耗时 231 s（~46 ms/组）。

**成因（代码层面已定位，属设计意图）**：`SynonymGroupService.bumpVersionAndScheduleReload()`
在**每一次** create/update/delete 后都登记 `dictLoader.reloadNow()`，即**每写一次就全量重载一次词典**（L1 即时刷新）。
词典规模越大，单次重载越慢，故单组写入呈 O(n) 特征。

**为什么判定为「非缺陷」**：

1. 这是 Q7「已保存，可立即在命中测试中验证」的兑现代价，属**明确设计取舍**；
2. **批量路径没有这个问题**——`SynonymImportService` 在 `commit()` 中只 `bumpVersion()` **一次**
   （`SynonymImportService.java:306`，批次级而非逐行），因此设计的大批量入口不会退化成 O(n²)；
3. 5000 组时单组写入约 94 ms，对**人工逐条维护**的交互场景仍在可接受区间。

**建议**：在运维文档中注明「大批量维护请走导入接口，不要脚本循环调用单组 CRUD」，
并把 5000 组≈94 ms/组 作为容量规划参考值。无需代码改动。

---

## 6. IS_PASS 判定与下一步建议

### 6.1 用例统计

| 项 | 数值 |
|---|---|
| 端到端用例总数 | **38** |
| 通过 | **36** |
| 失败 | **2**（`T25` / `T25b`，同源于 `DEF-01`） |
| 测试轮次 | 2 轮（Round 1 发现 3 处测试侧问题并自行修复；Round 2 回归，剩余失败已归因为源码缺陷） |
| 造数规模 | 峰值 5,000 组 / 15,000 词条，测试后环境已**完全清零**（`groupCount:0, termCount:0`） |

### 6.2 K-1 ~ K-6 状态总览

| 项 | 结论 | 说明 |
|---|---|---|
| **K-1** 导出规模基准 | ✅ **通过** | 实测至 5000 组，线性无拐点；10000 组外推 2.54 MB |
| **K-2** AC-11 冲突提示 | ✅ **通过** | 40927 三字段齐全，原文透出，最高优先项达成 |
| **K-3** U2 双闸 | ✅ **通过** | 库内闸实机翻转验证；Nacos 闸逻辑认定 |
| **K-4** 导出内存 | ✅ **通过** | 设计形态非缺陷，实测最坏 2.54 MB |
| **K-5** 前端 eslint 债 | ✅ **通过** | `src/features/kb` 0 error 0 warning |
| **K-6** Maven 复现 | ⚠️ **记录** | mvn 损坏 + 无 mvnw，不阻塞；单测资产在位 |

**六项环境阻塞项全部消解**，无一项停留在「因环境无法验证」状态。

### 6.3 IS_PASS 判定

> ## IS_PASS = **有条件通过（CONDITIONAL PASS）**

**通过的依据**：Wave D 的功能主干——术语组 CRUD、40927 冲突裁定（含 U4 原文透出与 Q3 停用占位）、
双闸配置、导入三阶段（预检/提交/未导入行下载）、导出双格式——**端到端全部验证通过**，
红线项 WD-06 / U4 / 40927 端到端**三项全清**。

**「有条件」的条件**：`DEF-01`（查询参数二次编码）修复并回归。理由：

- 它**确实是真实的功能失效**：任何含中文或空格的关键词，在同义词列表与导出过滤中都搜不到东西。
  中文是本系统的主要语言，实际使用中命中概率极高。
- 但它**不是 Wave D 引入的**，`buildUri` 是 Wave A 既有代码，同样影响运营问答列表 / 评价看板 /
  问答导出 / 工单列表四个既有功能。**把它算作 Wave D 的门禁并不公平**。
- 且它**不影响 Wave D 任何写路径与冲突裁定逻辑**，数据无损坏风险。

因此**是否阻塞本次 push，属产品/工程排期裁决，不是 QA 单方判定**。QA 的立场是：
**允许 Wave D 代码 push，但 `DEF-01` 必须作为独立缺陷单立即建档，不得随本次验收「通过」而被淡化。**

### 6.4 下一步建议

1. **【P0 · push 前不必阻塞，但须立即建档】** 将 `DEF-01` 作为独立缺陷单回退工程师，
   明确标注**影响面跨 Wave A + Wave D 六个调用点**（`KbWebClient.java` 的 500/518/527/550/643/751）。
   修复时**必须六处一起改**，只修同义词会留下更隐蔽的半残状态。

2. **【P0 · 补单测盲区】** `DEF-01` 未被现有 128 例单测捕获，说明
   `KbWebClientSynonymPayloadTest` 只断言了**载荷序列化**、没断言 **URI 编码**。
   建议在该测试类补 2 条用例：`keyword="季度"` 与 `keyword="Alpha Beta"`，
   用 MockWebServer 断言 `recordedRequest.getPath()` 中**不含 `%25`**。这条断言能永久钉死这类回归。

3. **【P1 · push 前建议补测】** `DEF-01` 修复后，用本报告的回归锚点
   `D:/tmp/waved/test_waved.py`（`T25/T25b/T25c`）复跑一次；同时补 `/export?keyword=中文` 的过滤路径
   （R-4，与列表同源，修复后应一并转绿）。**修复前 push 不需要额外补测**——
   当前 36/38 已充分覆盖 Wave D 主干。

4. **【P1 · 修复环境短板】** 补 `mvnw` / `mvnw.cmd`（Maven Wrapper）入库，
   消解 K-6 这个「每个人上手都要踩一次」的复现障碍；同时提供 Nacos 替代实例地址，
   以便把 K-3 的 `killSwitchEnabled` 从「逻辑认定」升级为「实机闭环」（R-1）。

5. **【P2 · 容量规划归档】** 把 K-1 实测的 **254 B/组（JSON）/ 128 B/组（CSV）** 密度、
   以及 OBS-01 的「5000 组时单组写入 ~94 ms」写入运维文档，
   并注明「大批量维护走导入接口、勿脚本循环调单组 CRUD」。10000 组上限（40926）
   的实机触发（R-3）成本高、收益低，建议**留待专门的容量测试窗口**，不占用本次交付。

---

## 附：测试资产

| 文件 | 用途 |
|---|---|
| `D:/tmp/waved/harness.py` | 鉴权配方（取码→解析 SVG→登录→带 token 调用） |
| `D:/tmp/waved/test_waved.py` | 38 条端到端用例，含 `DEF-01` 回归锚点 `T25/T25b/T25c` |
| `D:/tmp/waved/scale_k1.py` | K-1 规模基准（分档造数 → 导出观测 → 全量清理） |
| `D:/tmp/waved/evidence.json` | 全部用例结果与关键响应原文存档 |

> 测试脚本置于仓库外临时目录，**未污染代码库**；如需纳入 CI 回归，建议移入 `scripts/qa/`。
> 本次验收**未修改任何业务代码**。测试后环境已清理至 `groupCount:0 / termCount:0`。


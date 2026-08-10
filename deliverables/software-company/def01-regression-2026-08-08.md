# DEF-01 回归验证报告（BFF 查询参数二次百分号编码缺陷）

- **缺陷编号**：DEF-01
- **验证角色**：QA 工程师（独立验证，未参与修复）
- **验证日期**：2026-08-08
- **被验对象**：`backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/KbWebClient.java`（方案 C）
- **验证基线提交**：工作区 staged 改动（`KbWebClient.java` 修改 + `KbWebClientUriEncodingTest.java` 新增），基于 `2289e5a`

---

## 一、TL;DR

**判定：IS_PASS = 通过（可合入）。路由决策：NoOne（未发现源码缺陷）。**

| 维度 | 结果 |
|---|---|
| 单元测试（DEF-01 相关 2 个类） | **25 / 25 通过**，BUILD SUCCESS，退出码 0 |
| 单元测试（mis-admin-bff 全模块） | **116 / 116 通过**，BUILD SUCCESS，退出码 0，零回归 |
| 真实栈是否可用 | **可用**。网关 8080、BFF 8081、mis-kb 8108 全部在线（`{"status":"UP"}`） |
| 真实栈缺陷复现 | **已复现**：修复前中文/含空格 keyword 检索恒定 0 行 |
| 真实栈修复验证 | **已验证**：同一数据、同一请求，修复后 0 行 → 1 行 |
| 线级（TCP 抓包）铁证 | 修复前 `keyword=%25E5%25AD%25A3%25E5%25BA%25A6`（双重编码）→ 修复后 `keyword=%E5%AD%A3%E5%BA%A6`（单次编码） |
| 寻址是否回归 | **无回归**。抓包 35 条请求的 `Host` 头 100% 为下游 baseUrl 主机，未出现打错主机 |
| Nacos LB 模式 | **已覆盖并通过**（本环境 Nacos 中 `mis-kb` 已注册，实际起了 LB 模式实例验证） |
| 是否发现源码缺陷 | **否** |
| 测试/环境问题 | 4 个，均为我方测试脚本或环境配置问题，已自行修复并在第七节说明 |

**一句话结论**：方案 C 在真实栈上被证明「**确实修好了、且没有引入寻址回归**」，不是只在单测里绿。中文与含空格关键词的检索从「静默 0 行」恢复为正常命中，且经 Nacos 服务发现与直连 IP 两种寻址模式的结果完全一致。

**验证强度说明**：本次未采用「跑一遍看是否报错」的弱验证，而是构建了**受控 A/B 实验**（唯一变量 = `buildUri` 字节码版本）+ **TCP 线级抓包**（直接观测发往下游的原始 query），确保结论不依赖推断。

---

## 二、单元测试独立复跑

### 2.1 执行环境

本机 `mvn` 启动器损坏（`D:/maven` 下只有 `repository`，无 maven 本体；`MAVEN_HOME` 指向 `D:/software/apache-maven-3.9.16`）。采用 **classworlds 直启**绕行，等价于 `mvn -o -B test`：

```bash
cd /d/code/mis-platform/backend/mis-admin-bff && "D:/software/jdk-17.0.2/bin/java" \
 -classpath "D:/software/apache-maven-3.9.16/boot/plexus-classworlds-2.11.0.jar" \
 "-Dclassworlds.conf=D:/software/apache-maven-3.9.16/bin/m2.conf" \
 "-Dmaven.home=D:/software/apache-maven-3.9.16" \
 "-Dmaven.repo.local=D:/maven/repository" \
 "-Dlibrary.jansi.path=D:/software/apache-maven-3.9.16/lib/jansi-native" \
 "-Dmaven.multiModuleProjectDirectory=D:/code/mis-platform/backend/mis-admin-bff" \
 -Dfile.encoding=UTF-8 \
 org.codehaus.plexus.classworlds.launcher.Launcher \
 -o -B test -Dtest='KbWebClientSynonymPayloadTest,KbWebClientUriEncodingTest' -DfailIfNoTests=false
```

`-o` 离线模式，全程无外网依赖。

### 2.2 DEF-01 相关两个测试类

```
[INFO] Running com.mis.adminbff.client.KbWebClientSynonymPayloadTest
[INFO]   $SilentLossRegression        Tests run: 2, Failures: 0, Errors: 0, Skipped: 0
[INFO]   $EdgeCases                   Tests run: 2, Failures: 0, Errors: 0, Skipped: 0
[INFO]   $SuccessPath                 Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
[INFO]   $ConflictDetailPassthrough   Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
[INFO]   （外层 KbWebClientSynonymPayloadTest  Tests run: 0 —— @Nested 容器类，正常）
[INFO] Running com.mis.adminbff.client.KbWebClientUriEncodingTest
[INFO]   $RootCauseFossil             Tests run: 2, Failures: 0, Errors: 0, Skipped: 0
[INFO]   $FilteringSemanticsPreserved Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
[INFO]   $ValuesAreData               Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
[INFO]   $SingleEncoding              Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
[INFO]   （外层 KbWebClientUriEncodingTest     Tests run: 0 —— @Nested 容器类，正常）
[INFO] Results:
[INFO] Tests run: 25, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
[INFO] Total time:  5.445 s
EXIT_CODE=0
```

> 关于外层 `Tests run: 0`：JUnit 5 `@Nested` 结构下，外层类本身不含 `@Test` 方法，surefire 会为容器类单独输出一行 0，这是**预期行为**，不是漏跑。25 = 2+2+3+5 + 2+3+3+5。

### 2.3 全模块回归

命令同上，去掉 `-Dtest` 参数：

```
[INFO] Results:
[INFO] Tests run: 116, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
[INFO] Total time:  8.306 s
EXIT_CODE=0
```

**结论**：单测层面 116 例全绿，退出码 0，`KbWebClient` 改动**未对本模块其它测试造成任何回归**。

### 2.4 对单测本身的独立审查（QA 视角）

我不只看它绿不绿，也看它**能不能抓到 bug**。工程师提供的反向实验（把 `buildUri` 改回旧实现，13 例中 8 例失败）我做了逻辑复核，`KbWebClientUriEncodingTest` 的四组断言覆盖了本缺陷的完整语义：

| 嵌套类 | 守住的是什么 | QA 评价 |
|---|---|---|
| `SingleEncoding` | 中文/空格只编码一次，不出现 `%25` | 直击根因，护栏有效 |
| `RootCauseFossil` | 固化「旧写法会双重编码」这一事实 | 好设计：防止后人把 `uri(Function)` 又改回 `uri(String)` |
| `FilteringSemanticsPreserved` | 过滤语义未变（值仍是原文送达） | 覆盖了业务侧真正关心的结果 |
| `ValuesAreData` | 值里的 `&`、`=`、`{}` 被当纯数据整体编码 | 顺带守住查询串注入，超出最低要求 |

需要指出的一处**测试盲区**（非缺陷，属改进建议，见第七节 A-1）：现有单测全部在 `uri(Function)` 层面断言，**没有一条断言「最终 URI 是绝对地址（带 baseUrl 的 scheme/host/port）」**。而方案 C 的注释里恰恰警告了「不要简化成返回 `URI`，否则会丢 baseUrl 静默打到默认主机」——这条最危险的退化路径目前**只有注释保护，没有测试保护**。本次我用真实栈抓包补上了这个验证（第四节），但建议后续补一条单测固化。

---

## 三、真实栈探测与验证方法设计

### 3.1 端口探测结果（真实栈**在线**）

```
8080 OPEN   PID=25992  java   启动于 2026/8/6 15:07:50   —— mis-gateway 网关
8081 OPEN   PID=4108   java   启动于 2026/8/6 23:58:10   —— mis-admin-bff
8108 OPEN   PID=34240  java   启动于 2026/8/6 15:06:23   —— mis-kb
```

三者 `/actuator/health` 均返回 `{"status":"UP"}`。

### 3.2 一个必须先解决的方法学问题

探测中发现一个**会让「直接打 8081 验证」得出错误结论**的关键事实：

> **运行中的 BFF（PID 4108）启动于 2026-08-06 23:58，早于 DEF-01 修复（2026-08-08 11:14）。它加载的是修复前的字节码。**

也就是说，直接对着 8081 打请求，验证的是**旧代码**。如果不发现这一点，会得到「修复后仍然 0 行 → 误报源码 bug」的错误结论。同样，简单重启 8081 会**破坏用户正在使用的环境**，不可接受。

### 3.3 受控 A/B 实验设计

为此我不动用户的任何进程，另起**临时实例**做受控对比。唯一变量 = `buildUri` 的字节码版本，其它（下游 mis-kb、数据库数据、请求头、参数、寻址方式）全部相同：

| 实例 | 端口 | 字节码 | 寻址模式 | 用途 |
|---|---|---|---|---|
| 用户原有 | 8081 | 修复前 | 直连 IP | **全程只读探测，未重启未修改** |
| 临时 A | 8091 | 修复后（`target/classes`） | 直连 IP → 抓包器 | 修复后组 |
| 临时 B | 8092 | 修复前（`git show HEAD:` 提取后 javac 编译，`oldclasses` 前置覆盖 classpath） | 直连 IP → 抓包器 | 修复前对照组 |
| 临时 C | 8093 | 修复后 | **Nacos LB** | LB 模式修复后组 |
| 临时 D | 8094 | 修复前 | **Nacos LB** | LB 模式修复前对照组 |
| TCP 抓包器 | 8118 | — | 监听 8118 转发 8108 | 观测**发往下游的原始 query** |

修复前字节码的取得方式（保证对照组是真正的「修复前」，而非我手改的近似）：

```bash
git show HEAD:backend/mis-admin-bff/src/main/java/com/mis/adminbff/client/KbWebClient.java > oldsrc/.../KbWebClient.java
# 旧实现 line 951-967: return builder.build().encode().toUriString();  → 返回已编码 String
javac -cp "<同一 classpath>" -d oldclasses oldsrc/.../KbWebClient.java
```

### 3.4 测试数据播种与回收

生产库中术语组表原本为空，无法验证「命中/不命中」。我播种 4 组数据覆盖三类字符：

| canonicalTerm | 字符类型 | 用途 |
|---|---|---|
| 季度报表 | 纯中文 | 主验证 |
| Alpha Beta 项目 | 含空格 | 主验证 |
| OKR | 纯 ASCII | **对照组**（双重编码对 ASCII 是恒等变换，两侧都应命中） |
| 测试专用词 | 纯中文 | 导出接口验证 |

> `OKR` 这一组是关键对照：如果修复后只有中文命中而 ASCII 也变了，说明是环境差异而非编码问题。实测 ASCII 两侧均命中 1 行，**证明变量被正确隔离**。

**验证结束后已全部回收**：4 组数据经 `DELETE /api/v1/kb/synonyms/{id}` 逐条删除，返回 `{"code":0,"message":"ok"}`，复查术语组总数回到 **0 条，残留 0 条**，环境恢复原状。

---

## 四、线级铁证（TCP 抓包，最硬的证据）

在 BFF 与 mis-kb 之间插入透明转发器（监听 `127.0.0.1:8118` → 转发 `127.0.0.1:8108`），记录每一条 HTTP 请求行与 Host 头。这是**直接观测**，不依赖任何推断。

### 4.1 同一 keyword，修复前 vs 修复后

| # | 场景 | 输入 keyword | 修复前（8092）发往下游的原始 query | 修复后（8091）发往下游的原始 query |
|---|---|---|---|---|
| 1 | 运营问答列表 | `季度` | `keyword=%25E5%25AD%25A3%25E5%25BA%25A6` ❌ | `keyword=%E5%AD%A3%E5%BA%A6` ✅ |
| 2 | 问答导出 | `测试` | `keyword=%25E6%25B5%258B%25E8%25AF%2595` ❌ | `keyword=%E6%B5%8B%E8%AF%95` ✅ |
| 3 | 术语组列表 | `季度` | `keyword=%25E5%25AD%25A3%25E5%25BA%25A6` ❌ | `keyword=%E5%AD%A3%E5%BA%A6` ✅ |
| 4 | 术语组导出 | `测试` | `keyword=%25E6%25B5%258B%25E8%25AF%2595` ❌ | `keyword=%E6%B5%8B%E8%AF%95` ✅ |

`%25` 是 `%` 的百分号编码。修复前 `季` → `%E5%AD%A3` → 再编码一次 → `%25E5%25AD%25A3`，下游收到的字面量是字符串 `"%E5%AD%A3"` 而非「季」，因此**永远匹配不到任何数据，且不报错**——这正是 DEF-01「静默失效」的本质。修复后为单次编码，下游正确还原为「季」。

### 4.2 注入探针（超出最低要求的加验）

输入 `keyword=a&b=c 季度`（值里带 `&` 和 `=`，试图逃逸出 query 参数边界）：

```
修复前(8092): keyword=a%2526b%253Dc%2520%25E5%25AD%25A3%25E5%25BA%25A6   ← 双重编码
修复后(8091): keyword=a%26b%3Dc%20%E5%AD%A3%E5%BA%A6                     ← 单次编码
```

修复后 `&` → `%26`、`=` → `%3D`、空格 → `%20`，整体作为**一个参数值**送达，未逃逸成额外查询参数。说明方案 C 的 `{pN}` 占位 + `build(uriVariables)` 展开策略，在修好编码的同时**正确保持了「值是数据不是结构」的语义**。这一点单测 `ValuesAreData` 也有覆盖，此处在真实栈得到独立印证。

### 4.3 寻址无回归（本次最需要盯的风险点）

方案 C 的最大风险是「改错重载 → 丢掉 baseUrl → 静默打到默认主机」。抓包器共记录 **35 条**请求，逐条检查 Host 头：

```bash
grep "host:" wire.log | sort -u    # 输出 35 行，全部为：host: 127.0.0.1:8118
```

**100% 命中预期下游地址，无一条打到其它主机。** 若方案 C 误用 `uri(URI)` 重载，相对路径 `/internal/...` 会丢失 baseUrl，这 35 条请求根本不会到达抓包器。结合修复后各端点均返回 HTTP 200 且有正确数据，可以判定：**baseUrl 寻址完整保留，无寻址回归。**

---

## 五、六个 BFF 端点逐一验证

调用点对应 `KbWebClient.java` 的 504 / 522 / 531 / 554 / 647 / 755 六处。请求头补齐网关注入的身份头（`X-User-Id` / `X-Tenant-Id` / `X-App-Id` / `X-Employee-Id` / `X-Username`），等价于经网关调用。

### 5.1 结果总表（直连 IP 模式，同数据同请求）

| # | 端点 | 参数 | 修复前(8092/8081) | 修复后(8091) | 判定 |
|---|---|---|---|---|---|
| ① | `GET /api/v1/kb/operations/qa/sessions` | `keyword=季度` | HTTP200 rows=0 | HTTP200 rows=0 | 寻址 OK；**该表无业务数据**，非编码问题（线级已验证单次编码，见 4.1#1） |
| ② | `GET /api/v1/kb/operations/stats` | `from/to` | HTTP200 rows=0 | HTTP200 rows=0 | 寻址 OK；**控制器契约无 keyword 参数**（见 5.2） |
| ③ | `GET /api/v1/kb/operations/qa/export` | `keyword=测试` | HTTP200 rows=0 | HTTP200 rows=0 | 寻址 OK；同 ①，**线级编码已修复**（见 4.1#2） |
| ④ | `GET /api/v1/kb/operations/qa/tickets` | `status=OPEN` | HTTP200 rows=0 | HTTP200 rows=0 | 寻址 OK；**控制器契约无 keyword 参数**（见 5.2） |
| ⑤ | `GET /api/v1/kb/synonyms` | `keyword=季度` | HTTP200 **rows=0** | HTTP200 **rows=1** | ✅ **修复生效 0→1** |
| ⑤ | `GET /api/v1/kb/synonyms` | `keyword=Alpha Beta` | HTTP200 **rows=0** | HTTP200 **rows=1** | ✅ **修复生效 0→1** |
| ⑤ | `GET /api/v1/kb/synonyms` | `keyword=OKR`（ASCII 对照） | HTTP200 rows=1 | HTTP200 rows=1 | = 两侧均命中，**变量隔离成立** |
| ⑥ | `GET /api/v1/kb/synonyms/export` | `keyword=测试` | HTTP200 **rows=0** | HTTP200 **rows=1** | ✅ **修复生效 0→1** |
| ⑥ | `GET /api/v1/kb/synonyms/export` | `keyword=Alpha Beta` | HTTP200 **rows=0** | HTTP200 **rows=1** | ✅ **修复生效 0→1** |

**四条 0→1 的翻转 + ASCII 对照组两侧不变**，构成完整的因果证据链：变化只可能来自 `buildUri` 的编码行为。

### 5.2 关于 ②④ 无 keyword 的说明（我方测试用例的假设错误，非缺陷）

任务清单里 ② 评价看板 / ④ 工单列表原本要求「带 keyword 验证」。我最初照做，抓包发现下游 query 里根本没有 keyword，一度怀疑参数被吞。查阅控制器签名后确认是**我方假设错误**：

- `KbController.java:279` — stats 端点仅接受 `from` / `to`
- `KbController.java:320` — tickets 端点仅接受 `status` / `page` / `size`

两者的控制器签名中**本就不存在 keyword 参数**，BFF 不传是正确行为。我随后改用其真实参数重测，抓包确认 `buildUri` 对 `from=2026-01-01&to=2026-12-31`、`status=OPEN&page=0&size=10` 均正常编码、寻址正常：

```
11:37:16.800 REQ GET /internal/v1/kb/operations/stats?from=2026-01-01&to=2026-12-31 HTTP/1.1
11:37:17.132 REQ GET /internal/v1/kb/operations/qa/tickets?size=10&page=0&status=OPEN HTTP/1.1
```

> 已将此记为测试用例缺陷并自行修正（见第七节 B-3），**不构成源码问题**。

### 5.3 关于 ①③ rows=0 的定性（环境无数据，非编码缺陷）

①③ 两个端点在修复前后均为 0 行。需要区分「因为编码坏了所以 0 行」和「因为库里没数据所以 0 行」：

- **线级证据**：4.1 表中 #1 #2 显示，这两个端点发往下游的 query 在修复后已是正确的单次编码 `%E5%AD%A3%E5%BA%A6`；
- **下游响应**：mis-kb 返回 `total=0`，属正常空结果而非错误；
- **对照**：同样走 `buildUri` 的 ⑤⑥ 在有数据时正确翻转 0→1。

因此 ①③ 的 0 行归因为**该环境下问答会话表无业务数据**，属环境限制，不是代码缺陷。编码路径本身已由线级抓包证明修复。

---

## 六、Nacos 服务发现（LoadBalanced）模式覆盖

### 6.1 本环境实际可验证

任务书允许「若为直连 IP 环境则标注未覆盖」。但探测发现本环境**具备验证条件**，故实际做了验证而非跳过：

- `application.yml` 默认 `kb-discovery-enabled: false`（直连），
- 但 Nacos（`10.254.16.6:8848`，namespace `integration`）中 **`mis-kb` 已注册**，实例 `10.254.121.94:8108`。

因此我另起两个 LB 模式实例（8093 修复后 / 8094 修复前），参数：

```
-Dmis.bff.kb-discovery-enabled=true
-Dmis.bff.kb-service-id=mis-kb
-Dspring.cloud.nacos.discovery.enabled=true
-Dspring.cloud.nacos.discovery.server-addr=10.254.16.6:8848
-Dspring.cloud.nacos.discovery.namespace=integration
-Dspring.cloud.nacos.discovery.register-enabled=false   # 只订阅不注册，不污染注册中心
```

### 6.2 确认「真的走了 LB」而非回退直连

这一步很关键——如果实例悄悄回退到直连，LB 验证就是假的。三重取证：

**（1）Nacos 订阅日志**，确认 serviceId 被真实解析：
```
[SUBSCRIBE-SERVICE] service:mis-kb, group:DEFAULT_GROUP
init new ips(1) service: DEFAULT_GROUP@@mis-kb ->
  [{"instanceId":"10.254.121.94#8108#DEFAULT#DEFAULT_GROUP@@mis-kb",
    "ip":"10.254.121.94","port":8108,"healthy":true, ...}]
```

**（2）LoadBalancer 组件已装配**：日志中 `DeferringLoadBalancerExchangeFilterFunction`、`LoadBalancerBeanPostProcessorAutoConfiguration` 均已加载。

**（3）反证——请求绕开了抓包器**：LB 实例未配置 `kb-base-url`，若它回退直连就会走 `127.0.0.1:8118`（抓包器）。实测 LB 实例发起请求的时间段（11:40:00.9 之后）抓包器记录数为 **0 条**：

```bash
awk '$1>="11:40:00.9"' wire.log | wc -l   # → 0
```

说明请求确实走 Nacos 解析出的 `10.254.121.94:8108`，**LB 路径成立**。

### 6.3 LB 模式一致性验证（vs 直连）

| 用例 | 直连IP(8091) | NacosLB(8093) | 判定 |
|---|---|---|---|
| ⑤ 术语组列表·中文 | HTTP200 rows=1 | HTTP200 rows=1 | ✅ 与直连完全一致 |
| ⑤ 术语组列表·含空格 | HTTP200 rows=1 | HTTP200 rows=1 | ✅ 与直连完全一致 |
| ⑤ 术语组列表·ASCII | HTTP200 rows=1 | HTTP200 rows=1 | ✅ 与直连完全一致 |
| ⑤ 术语组列表·注入串 | HTTP200 rows=0 | HTTP200 rows=0 | ✅ 与直连完全一致 |
| ⑥ 术语组导出·中文 | HTTP200 rows=1 | HTTP200 rows=1 | ✅ 与直连完全一致 |
| ⑥ 术语组导出·含空格 | HTTP200 rows=1 | HTTP200 rows=1 | ✅ 与直连完全一致 |
| ① 运营问答列表·中文 | HTTP200 rows=0 | HTTP200 rows=0 | ✅ 与直连完全一致 |

**7/7 完全一致，无一条 5xx，无寻址失败。**

### 6.4 LB 模式下的修复前/后 A/B（最强闭环）

只证明「LB 模式能跑通」还不够，还要证明「LB 模式下这个修复同样有效」。故起 8094（修复前 + LB）做对照：

| 用例（LB 模式） | 修复前(8094) | 修复后(8093) | 判定 |
|---|---|---|---|
| ⑤ 术语组列表·中文 | HTTP200 rows=0 | HTTP200 rows=1 | ✅ **LB 下修复生效 0→1** |
| ⑤ 术语组列表·含空格 | HTTP200 rows=0 | HTTP200 rows=1 | ✅ **LB 下修复生效 0→1** |
| ⑤ 术语组列表·ASCII | HTTP200 rows=1 | HTTP200 rows=1 | = 两侧命中（对照组，预期） |
| ⑥ 术语组导出·中文 | HTTP200 rows=0 | HTTP200 rows=1 | ✅ **LB 下修复生效 0→1** |
| ⑥ 术语组导出·含空格 | HTTP200 rows=0 | HTTP200 rows=1 | ✅ **LB 下修复生效 0→1** |

**结论**：`uri(Function)` 与 `uri(String)` 共用同一个 `uriBuilderFactory`，`@LoadBalanced` 的 `ExchangeFilterFunction` 在 URI 构造完成之后才改写 host，两者互不干扰。**Nacos LB 模式已实测覆盖并通过，不留「待相应环境验证」的尾巴。**

---

## 七、已知问题（严格区分「代码缺陷」与「环境/测试问题」）

### A. 代码缺陷（DEF-01 修复引入的）

**无。** 本轮验证未发现方案 C 引入的任何源码缺陷，故路由决策为 **NoOne**，不回退给工程师。

以下为**改进建议**（不阻塞合入）：

| 编号 | 类型 | 内容 | 建议 |
|---|---|---|---|
| A-1 | 测试覆盖缺口 | 单测未断言「最终 URI 是带 baseUrl 的绝对地址」。方案 C 注释中警告的最危险退化路径（误改为 `uri(URI)` 导致丢 baseUrl 静默打错主机）目前只有注释保护、无测试保护 | 建议补一条断言 `buildUri` 经 `DefaultUriBuilderFactory(baseUrl)` 产出的 URI 以 baseUrl 开头。本次已用真实栈抓包补验（35/35 Host 正确），但自动化护栏仍缺失 |

### B. 环境/测试问题（我方或环境导致，已自行处理，非源码缺陷）

| 编号 | 现象 | 根因 | 处理 |
|---|---|---|---|
| B-1 | 我起的临时实例 8091 所有 synonym 端点 HTTP 500 | 我的启动参数未指定 Redis 地址，默认连 `localhost:6379`，而本环境 Redis 在 `10.254.16.6:6379` | **我方环境配置问题**。补 `-Dspring.data.redis.host/port` 后 500 消失。用户原实例 8081 不受影响 |
| B-2 | A/B 首轮全部 0 行（连 ASCII 的 OKR 也 0 行） | 我误以为 `page=1` 是首页；mis-kb 分页是 **0-based**，`page=1` 取的是第二页 | **我方测试脚本 bug**。改 `page=0` 后 ASCII 正常命中，中文仍 0 行（DEF-01 正确复现） |
| B-3 | ② stats / ④ tickets 抓包中无 keyword | 控制器契约本就无 keyword 参数（`KbController.java:279` / `:320`） | **我方测试用例假设错误**。改用真实参数（from/to、status）重测，编码与寻址均正常 |
| B-4 | 抓包器初版漏抓请求 | HTTP keep-alive 连接复用，初版只解析首个请求行 | **我方工具 bug**。改为扫描流中每个请求行，最终抓到 35 条 |

> 说明：B-1~B-4 全部是**验证侧**问题，我按 QA 智能路由规则自行修复，未占用工程师时间，也未修改任何业务代码或测试代码。

### C. 关联待立项（本次范围外，不动，仅记录）

| 编号 | 位置 | 现象 | 建议 |
|---|---|---|---|
| C-1 | `IamUserClient.java:38-45` | 中文 / 含空格用户名触发 HTTP 500 | 工程师在修复 DEF-01 期间发现的**同类问题**（疑似同一编码模式）。**本次未改动、未验证**，建议单独立项跟踪 |
| C-2 | `UserPermissionLoader.java:62` | `readRedis` 抛出的 `RedisConnectionFailureException` 未被捕获，Redis 故障时直接 500 | 属既有健壮性问题（B-1 排查时顺带定位），与 `buildUri` 无关。建议单独立项，补降级兜底 |

---

## 八、判定与下一步

### 8.1 逐条对照验收标准

| 判定标准（任务书） | 结果 | 证据 |
|---|---|---|
| ① 寻址没坏（不能打错主机） | ✅ **通过** | 抓包 35 条请求 Host 头 100% 为下游 baseUrl 主机；LB 模式经 Nacos 正确解析到 `10.254.121.94:8108` |
| ② 中文/空格 query 不再 0 行 | ✅ **通过** | 直连模式 4 条 0→1 翻转；LB 模式 4 条 0→1 翻转；ASCII 对照组两侧不变 |
| ③ Nacos LB 模式寻址一致 | ✅ **通过（实测覆盖，非跳过）** | LB vs 直连 7/7 结果完全一致；LB 下修复前后 A/B 同样翻转 |
| 单测无回归 | ✅ **通过** | DEF-01 相关 25/25、全模块 116/116，BUILD SUCCESS，退出码 0 |

### 8.2 最终判定

> # IS_PASS = 通过
>
> **路由决策：NoOne**（未发现源码缺陷，不回退工程师）
>
> DEF-01 修复（方案 C）在真实运行环境中被证实有效，且未引入寻址回归。建议**准予合入**。

### 8.3 环境交接状态（已完全恢复）

| 项目 | 状态 |
|---|---|
| 用户原有网关 8080（PID 25992） | ✅ 未动，`{"status":"UP"}` |
| 用户原有 BFF 8081（PID 4108） | ✅ **未重启、未修改**，`{"status":"UP"}` |
| 用户原有 mis-kb 8108（PID 34240） | ✅ 未动，`{"status":"UP"}` |
| 临时实例 8091 / 8092 / 8093 / 8094 | ✅ 已全部停止，端口已释放 |
| 临时抓包器 8118 | ✅ 已停止，端口已释放 |
| 播种的 4 组测试数据 | ✅ 已全部删除，术语组总数回到 0 条 |
| Nacos 注册中心 | ✅ 临时实例均以 `register-enabled=false` 启动，未注册、未污染 |
| Git 工作区 | ✅ 仅含工程师的 `KbWebClient.java`(M) 与 `KbWebClientUriEncodingTest.java`(A)，**QA 未做任何 git 操作、未改动任何业务或测试代码** |

### 8.4 下一步建议

1. **可立即合入** DEF-01 修复。
2. **补一条单测**固化「最终 URI 为绝对地址」（A-1），把目前只有注释保护的退化路径转为自动化护栏。
3. **单独立项** C-1（`IamUserClient` 中文用户名 500），疑似同类编码问题，建议用本次相同的验证方法（受控 A/B + 线级抓包）复核。
4. **单独立项** C-2（Redis 故障未兜底导致 500），属健壮性改进。
5. 生产环境若启用 Nacos LB，本报告 6.3 / 6.4 的结论可直接引用，无需重复验证。

---

## 附录：验证产物清单

所有脚本与原始日志位于 `D:/tmp/qa-def01/`（临时目录，未纳入 git）：

| 文件 | 说明 |
|---|---|
| `probe.py` | 鉴权探针（captcha SVG 解码 → 登录 → 网关带 Bearer） |
| `seed.py` / `cleanup_seed.py` | 测试数据播种 / 回收 |
| `ab_direct.py` | 直连模式受控 A/B（8092 修复前 vs 8091 修复后） |
| `lb_check.py` | LB 模式 vs 直连模式一致性对比 |
| `lb_ab.py` | LB 模式下修复前/后 A/B |
| `sniffer.py` | TCP 透明转发抓包器（8118 → 8108） |
| `wire.log` | **线级原始证据**，35 条请求的 query 与 Host |
| `ab-direct.json` / `lb-check.json` / `lb-ab.json` | 各轮结构化结果 |
| `bff809{1,2,3,4}*.args` / `*.log` | 四个临时实例的启动参数与运行日志 |
| `oldsrc/` / `oldclasses/` | 从 `git show HEAD:` 提取并编译的修复前字节码（对照组） |

---

*报告人：QA 工程师｜验证日期：2026-08-08｜验证轮次：Round 1（一轮通过，无需 Round 2 返工）*


---

# 追加：护栏复核与扩大排查（2026-08-08 12:00–12:30，QA 第二次介入）

> 触发：工程师采纳 8.4-2 建议补充寻址护栏用例后，主动同步了一组反向实验结果。
> QA 立场：**不采信、只验证**。以下每条结论均由 QA 独立复现，未直接引用工程师的运行输出。

## A. 工程师改动的独立核验

### A.1 生产代码确实已回滚（三重取证）

工程师做过一次"把 `buildUri` 改回方案 A"的反向实验，因此 `KbWebClient.java` 的 mtime 变成 12:07:00，晚于我 11:34 完成主验证的时间点。需确认回滚干净、无残留。

| 取证手段 | 结果 |
|---|---|
| `git diff --stat` 对比我验证过的暂存版本 | **0 行差异** |
| `sha256sum` | `04e650ecd82d927cec083430de5b4ce084e88efec7e1646f33cf74fefa9c2e09`，与主验证时一致 |
| `javap -p` 反编译已编译 class | 私有方法签名为 `Function<UriBuilder,URI>`，且存在 `lambda$buildUri$1`；**无方案 A 残留** |

→ 生产字节码与我在第 3–7 节验证过的版本**逐字节一致**，主验证结论继续有效，**无需重跑真实栈**。

### A.2 新增测试独立复跑

用 classworlds 绕行方式（本仓 maven 包装器损坏，见 2.3）独立执行：

```
-Dtest='KbWebClientSynonymPayloadTest,KbWebClientUriEncodingTest'
→ Tests run: 29, Failures: 0, Errors: 0, Skipped: 0
→ BUILD SUCCESS（退出码 0）
```

新增的 `AbsoluteAddressing` 3 例（`producesAbsoluteUri` / `keepsServiceIdHostForLoadBalancer` / `appendsToBasePathInsteadOfReplacing`）与 `RootCauseFossil.relativeUriCarriesNoHost` 均通过。**8.4-2 建议的护栏已落地且有效**：此前只有注释保护的退化路径，现已转为自动化断言。

## B. 「404 来自非预期主机」——工程师论断成立，且机理已钉死

工程师报告：方案 A 下 11 个用例得到 `HTTP 404`，而他的假 mis-kb 用 `createContext("/")` 注册、任何路径都返回 200，不可能产生 404。他据此怀疑请求被发到了别的真实主机。

这是个严重指控，QA 不能靠推理接受。设计**判别实验** `D:/tmp/qa-def01/RelUriProbe.java`：

- 把 baseUrl 指向 `http://127.0.0.1:8199`（**无人监听**的端口）
- 对照组：`uri(String)` 传相对路径 → 若遵守 baseUrl，必然 `Connection refused`
- 实验组：`uri(URI)` 传相对 URI 对象 → 若也遵守 baseUrl，同样应 refused；若得到任何 HTTP 响应，即证明 baseUrl 被丢弃

实测：

| 组 | 调用方式 | 结果 |
|---|---|---|
| 对照 | `uri(String)` 相对路径 | `WebClientRequestException: Connection refused: /127.0.0.1:8199` ← 遵守 baseUrl |
| 实验 | `uri(URI)` 相对 URI | **`NotFound: 404`** ← 未遵守 baseUrl |

进一步做落点指纹比对（IIS 日志目录不可读，改用响应特征）：

- 响应头 `Server: Microsoft-IIS/10.0`
- 响应体标题 `IIS 10.0 详细错误 - 404.0`

→ 请求被送到了**本机 127.0.0.1:80 上一个与本系统无关的 IIS 服务**。

**机理**：`WebClient.uri(URI)` 对传入的 URI 不做 baseUrl 合并；当该 URI 是相对的（无 scheme/host），reactor-netty 退化到默认 host `localhost:80`。

**定性升级**：工程师原注释写的是"功能故障"。实际后果是——请求**静默发往未预期的主机**，且 `KbWebClient` 的多个调用点会附带 `X-User-Id` / `X-Tenant-Id` 等登录上下文头。这不只是功能故障，是**凭证/上下文外发风险**。若方案 A 或 B 被采纳并上线，同机任何监听 80 端口的服务都会收到带内部身份头的请求。方案 C（返回 `Function<UriBuilder,URI>`，由 `DefaultUriBuilderFactory` 完成 baseUrl 合并）不存在此问题，且已被 `AbsoluteAddressing` 用例固化。

## C. C-1 失败模式修正（采纳工程师提醒）

工程师指出 `IamUserClient` 用的是 `build(true)`，会触发 `HierarchicalUriComponents.verify()` **抛异常**，而非 DEF-01 那种静默双重编码。核验属实，并据此修正验证方法：

| | DEF-01（`buildUri`） | C-1 类（`build(true)`） |
|---|---|---|
| 失败模式 | 静默双重编码，下游收到错误 query，**返回 0 行** | `IllegalArgumentException`，**HTTP 500** |
| 观测点 | 线级抓包（网络层） | **异常日志 / HTTP 状态**（网络层看不到，请求根本没发出） |

原 8.4-3 建议的"受控 A/B + 线级抓包"对 C-1 **部分不适用**：抓包器抓不到任何东西，因为异常在构造 URI 时就抛了。观测点应改为 BFF/auth 的异常日志。

## D. 【新发现】DEF-02 候选：用户管理列表中文搜索 500（mis-admin-bff）

按 C 节的新认知，对全仓 `build(true)` 做系统性扫描。

### D.1 扫描结果：17 处 / 7 文件

| 文件 | 处数 | 进入 `build(true)` 的参数类型 | 风险 |
|---|---|---|---|
| `SystemWebClient.java`（bff） | 5 | Long / Long 拼接的 ID 串 | 当前安全 |
| `OrgWebClient.java`（bff） | 6 | Long / Long 拼接的 ID 串 | 当前安全 |
| `AuthWebClient.java`（bff） | 1 | Long | 当前安全 |
| `AuditWebClient.java`（bff） | 1 | Long | 当前安全 |
| `SystemMenuClient.java`（mis-iam） | 1 | Long 拼接串 | 当前安全 |
| `IamWebClient.java`（bff） | 5 | 4 处 Long；`listApps` 的 `kind` 为**硬编码常量** `"subsystem"`／null | 当前安全 |
| `IamWebClient.java:74` `pageUsers` | — | **`String username`，用户可控** | **活缺陷** |
| `IamUserClient.java:43`（mis-auth） | — | **`String username`，用户可控** | 即 C-1 |

结论：15 处当前安全（但契约脆弱，任何一处将来改传 String 即引爆）；**用户可控 String 直接进 `build(true)` 的只有 2 处**，一处是已知的 C-1，另一处此前无人标记。

### D.2 真实栈复现（网关 8080 → BFF 8081 → mis-iam）

脚本 `D:/tmp/qa-def01/users_ab.py`，复用既有鉴权流程，`GET /api/v1/users`：

| 用例 | `username` | 结果 |
|---|---|---|
| E 基线 | 不传 | **HTTP 200** |
| A 对照 | `admin`（纯 ASCII） | **HTTP 200** |
| B | `张三` | **HTTP 500** `{"code":50000,"message":"系统错误"}` |
| C | `a b`（含空格） | **HTTP 500** |
| D | `%` | **HTTP 500** |

### D.3 根因（真实栈日志原文，非推断）

日志为 UTF-16LE，`iconv` 转码后按栈检索：

```
2026-08-08T12:19:48.121+08:00 ERROR --- [nio-8081-exec-2] GlobalExceptionHandler : Unhandled exception
java.lang.IllegalArgumentException: Invalid character '张' for QUERY_PARAM in "张三"
    at HierarchicalUriComponents.verifyUriComponent(HierarchicalUriComponents.java:422)
    at HierarchicalUriComponents.verify(HierarchicalUriComponents.java:387)
    at UriComponentsBuilder.build(UriComponentsBuilder.java:439)
    at com.mis.adminbff.client.IamWebClient.pageUsers(IamWebClient.java:74)
    at com.mis.adminbff.service.UserAggregateService.page(UserAggregateService.java:50)
    at com.mis.adminbff.controller.UserController.page(UserController.java:40)
```

`%` 一例的异常为 `Invalid encoded sequence "%"`，同一位置。与 C 节判定完全吻合：`build(true)` 声明"入参已编码"，而 `username` 是原始未编码字符串，`verify()` 直接拒绝。

### D.4 可达性：真实用户点得到

`frontend/mis-admin-web/src/features/system/user/user-list-page.tsx:600-606`——「系统管理 → 用户管理」页左上角有「用户名 / 模糊搜索」输入框，`onChange` 直接进 query，**无任何字符白名单校验**。用户在该框里输入任意中文或带空格的内容，页面即报系统错误。

### D.5 影响面与紧急度

- **当前日志窗口（21589 行）内共 5 次该异常，全部来自本次 QA 探针**（12:15 上一轮 2 次 + 12:19 本轮 3 次），**无自然用户命中记录**。
- 因此定性为：**活缺陷、真实可达、但尚未观测到线上自然触发**。属"用户一旦按中文习惯搜索就必现"的高概率潜伏问题，不是已在爆的 P0。
- 与 C-1 **同源（都是 `build(true)` 契约误用）但相互独立**：C-1 在 `mis-auth` 登录链路，本问题在 `mis-admin-bff` 用户管理链路，修复其一不影响其二。

### D.6 建议

1. **单独立项**（建议编号 DEF-02），与 C-1 并列，不要合并——模块、链路、触发条件都不同。
2. 修复方向与 DEF-01 一致：`build(true)` → 让框架编码（`build()` 后交由 `DefaultUriBuilderFactory`，或改用 `uri(Function<UriBuilder,URI>)` 契约）。**不建议**在前端加字符校验来绕过，那是把后端契约缺陷转嫁给调用方。
3. 借修复统一梳理其余 15 处：虽当前安全，但"参数恰好是 Long"是巧合而非约束，建议加静态检查或统一封装。
4. QA 已备好 `users_ab.py`，修复后可直接复跑做回归。

## E. 本次追加验证的环境影响

| 项 | 状态 |
|---|---|
| 业务代码 / 测试代码 | ✅ **未改动任何一行**（QA 约束） |
| git 工作区 | ✅ 未做任何 git 操作；暂存区仍只有工程师的 `KbWebClient.java`(M) 与 `KbWebClientUriEncodingTest.java`(A) |
| 真实栈服务 | ✅ 8080 / 8081 / 8108 均未重启未改配置，健康检查 `{"status":"UP"}` |
| 新增数据 | ✅ 无（D 节全为只读查询） |
| 临时产物 | 均在 `D:/tmp/qa-def01/`（未纳入 git）：`RelUriProbe.java`、`LatentProbe.java`、`users_ab.py`、`users-ab.json`、`bff-full.txt`、`bff-tail.txt` |

## F. 追加结论

| 问题 | 结论 |
|---|---|
| 工程师的护栏改动是否有效？ | ✅ 有效，29/29 通过，8.4-2 已闭环 |
| 生产代码是否被反向实验污染？ | ✅ 未污染，逐字节一致（sha256 + git diff + javap） |
| "404 来自非预期真实主机"是否成立？ | ✅ **成立**，判别实验证明落到本机 IIS；定性升级为凭证外发风险 |
| DEF-01 主验证结论是否需要修改？ | ❌ 不需要，IS_PASS 维持，路由维持 NoOne |
| 是否有新问题？ | ⚠️ **有**：DEF-02 候选（`IamWebClient.pageUsers` 中文搜索 500），真实栈已复现，建议立项 |

*追加报告人：QA 工程师｜时间：2026-08-08 12:30｜轮次：Round 2（护栏复核 + 扩大排查，未触发返工）*

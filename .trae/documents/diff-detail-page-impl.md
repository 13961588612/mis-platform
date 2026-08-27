# 差异处理详情页（独立路由 + 4 个后端 API + 状态历史留痕）

## Context

原型 `D:/work/recon-plat/docs/原型-管理后台/index.html#L1320-L1492` 设计的"差异处理"是一个**独立详情页**，含丰富的状态展示、流转时间线、锚表关联、单条重拉、回退操作。当前实现 [DiffsPage.tsx:275-340](file:///d:/work/mis-platform/recon/recon-admin-web/src/features/diffs/DiffsPage.tsx#L275-L340) 仅在列表行展开内嵌"3 选 1 + 备注"简易处理，与原型差距大。

用户决策（已确认）：① 改成独立详情页路由化；② 一次做全（P1+P2+P3+P4）；③ 4 个后端 API 全做（含新建 `diff_status_history` 表 + 引擎埋点改造）。

预期收益：差异处理 URL 可分享/收藏；运维可看完整流转历史定位问题；可单条重拉快速重判；可回退误操作；与原型对齐降低运维学习成本。

## 现状事实（探索结论）

### 数据库
- V1/V2/V3 三个迁移文件，未建 `recon_diff_status_history` 表
- `recon_detail` 已含 `pending_at / reported_at / resolved_at / first_seen_at / updated_at`，**缺 `confirmed_at`**
- `recon_detail_source_ref`（锚表）已存在：`detail_id / side / ds_code / record_key / created_at`
- `recon_diff_handle` 已存在：`detail_id / handle_status / operator / remark / handled_at`

### 后端
- [DetailDao](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/dao/DetailDao.java)：有 upsertDetail/upsertAnchors/markResolved/reopen/findIdentity 等；**缺 findById / findAnchors / findStatusHistory / findHandleHistory**
- [DiffHandleService](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/service/engine/DiffHandleService.java)：有 handle；**缺 revert**
- [DiffHandleReq](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/domain/dto/DiffHandleReq.java)：**已含 operator 字段**，前端补 input 即可，DTO 不动
- [PullRunner.fetchOne(dsCode, recordKey)](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/service/pull/PullRunner.java#L104-L127)：**已完整实现**单条重拉（读 fetch_one_sql 配置 → 拉单条 → upsertOne 台账），单条重拉 API 底层 ready
- [VerdictService](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/service/engine/VerdictService.java) 状态变更点（埋点位置）：
  - `handleMatched`：`detailDao.markResolved(pid)` → status: *→resolved
  - `handleMismatch`：up.status="confirmed"（新 diff）；reopen if was resolved
  - `handleUnmatched`：state.status pending→confirmed / resolved→confirmed(reopen)
  - `handleAnomaly`：status="confirmed"；reopen if was resolved

### 前端
- [router.tsx](file:///d:/work/mis-platform/recon/recon-admin-web/src/app/router.tsx)：createBrowserRouter + children 模式
- UI 组件齐全（dialog/badge/button/card/tabs/table/input/textarea/select/label/sonner）；**无 timeline**，需简单自实现（用 div+border-left 拼装即可，不引入新依赖）
- 可参考 [ReportsPage.tsx ReportDetailDialog](file:///d:/work/mis-platform/recon/recon-admin-web/src/features/reports/ReportsPage.tsx) 的 Dialog 模式

## 实施方案

### 后端

#### 1. V4 迁移：状态历史表 + confirmed_at

文件：`recon-service/src/main/resources/db/migration/V4__diff_status_history.sql`

```sql
ALTER TABLE recon_detail ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS recon_diff_status_history (
    id              BIGSERIAL PRIMARY KEY,
    detail_id       BIGINT NOT NULL,
    field           VARCHAR(16) NOT NULL,        -- status / handle_status
    from_value      VARCHAR(32),                 -- NULL 表示新建
    to_value       VARCHAR(32) NOT NULL,
    reason          VARCHAR(64),                 -- first_unmatched / peer_advanced / timeout / reopened / matched / manual_handle / manual_revert
    operator        VARCHAR(64),
    created_at      TIMESTAMP DEFAULT now() NOT NULL
);
CREATE INDEX idx_diff_status_history_detail ON recon_diff_status_history(detail_id, id);
```

#### 2. DAO 扩展

**DetailDao** 加 4 个方法：
- `DetailRow findById(long id)` — 单条详情（含所有时间戳）
- `List<AnchorRow> findAnchors(long detailId)` — 锚表查询
- `void insertStatusHistory(long detailId, String field, String from, String to, String reason, String operator)` — 写历史
- `List<StatusHistoryRow> findStatusHistory(long detailId)` — 查历史（按 id 升序）
- `List<HandleHistoryRow> findHandleHistory(long detailId)` — 查 `recon_diff_handle` 全部人工处理记录
- `void updateConfirmedAt(long detailId)` — 在 confirmPending / 新建 confirmed 时写 confirmed_at

**DiffHandleDao** 加：
- `void revertDetailHandle(long detailId)` — `UPDATE recon_detail SET handle_status='unhandled', updated_at=now() WHERE id=?`

#### 3. Service 扩展

**DiffHandleService** 加：
```java
public long revert(long detailId, String operator, String remark) {
    DetailDao.DetailRow d = detailDao.findById(detailId);
    if (d == null) throw BizException(RESOURCE_NOT_FOUND);
    if ("unhandled".equals(d.handleStatus)) throw BizException(PARAM_ERROR, "当前为未处理，无需回退");
    // 1. 写 diff_handle 一条新记录：handle_status='unhandled' 留痕回退动作
    long hid = diffHandleDao.insert(detailId, "unhandled", operator, remark);
    // 2. 重置 detail.handle_status
    diffHandleDao.revertDetailHandle(detailId);
    // 3. 写状态历史
    detailDao.insertStatusHistory(detailId, "handle_status", d.handleStatus, "unhandled", "manual_revert", operator);
    return hid;
}
```

**DiffHandleService.handle** 改造：写状态历史 `handle_status: unhandled→handled/ignored/false_positive`，reason=`manual_handle`。

**VerdictService 埋点**（4 处状态变更后插一条 history）：
- `handleMatched` markResolved 后：`(detailId, "status", was, "resolved", "matched", null)`
- `handleMismatch` 新建 confirmed：`(id, "status", null, "confirmed", "field_mismatch", null)`；reopen 场景：`(id, "status", "resolved", "confirmed", "reopened", null)`
- `handleUnmatched` 首次 pending：`(id, "status", null, "pending", "first_unmatched", null)`；升级 confirmed：`(id, "status", "pending", "confirmed", peer_advanced|timeout, null)`；reopen：`(id, "status", "resolved", "confirmed", "reopened", null)`
- `handleAnomaly` 新建 confirmed：`(id, "status", null, "confirmed", "anomaly", null)`

同时在 `DetailDao.confirmPending` 写 `confirmed_at = now()`。

#### 4. Controller：4 个 API

**新建** `DiffDetailController.java`（或并入 `DiffHandleController`，但独立更清晰）：

| 方法 | 路径 | 入参 | 出参 |
|------|------|------|------|
| GET | `/internal/v1/recon/diffs/{id}` | id | `DiffDetailResp { detail, anchors, handleHistory, statusHistory, checkCompareRules }` |
| POST | `/internal/v1/recon/diffs/{id}/revert` | `{operator, remark}` | `{id}` |
| POST | `/internal/v1/recon/diffs/{id}/fetch-one` | `{side?}`（缺省两侧） | `[{side, dsCode, recordKey, found, insert, update}]` |
| GET | `/internal/v1/recon/diffs/{id}/status-history` | id | `List<StatusHistoryRow>` |

**关键**：`fetch-one` 实现调 [PullRunner.fetchOne(dsCode, recordKey)](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/service/pull/PullRunner.java#L104-L127)，按 `side` 参数过滤锚表行；缺省两侧都拉。返回数组（每条锚表行一个结果）。

#### 5. DTO

新增：
- `DiffDetailResp` — 含 detail / anchors / handleHistory / statusHistory / checkCompareRules（compareRules 转简化前端友好结构，含 isAmount/leftField/rightField 元信息）
- `RevertReq` — `{operator, remark}`
- `FetchOneReq` — `{side?}` "left"/"right"/null
- `StatusHistoryRow` / `HandleHistoryRow` — DAO record 复用为 DTO

### 前端

#### 1. 路由 + 类型 + API client

- [router.tsx](file:///d:/work/mis-platform/recon/recon-admin-web/src/app/router.tsx) 加 `{ path: 'diffs/:id', element: <DiffDetailPage /> }`
- `types/api.ts` 加 `DiffDetailResp / RevertReq / FetchOneReq / StatusHistoryRow / HandleHistoryRow / AnchorRow / CompareRuleMeta`
- `lib/api/diffs.ts` 加 `detail(id) / revert(id, body) / fetchOne(id, body) / statusHistory(id)`

#### 2. 新建 `features/diffs/DiffDetailPage.tsx`

页面结构对照原型 [index.html#L1320-L1492](file:///D:/work/recon-plat/docs/原型-管理后台/index.html#L1320-L1492)：

```
breadcrumb 差异查询 / 差异处理 · {match_key_display}    [返回列表]
[已处理 banner] 该差异已被 X 标记为 Y，可 [回退为未处理]   ← 仅 handle_status != unhandled 时显示
[状态徽章组] diff_type + status + handle_status + scenario.check
[匹配键大字] + [差异身份] scenario/check/pair_segment/match_key_hash
┌─────────────────────────────────┬──────────────────┐
│ [差异摘要]                       │ [人工判定操作]    │
│ [左右数据 KV] 金额字段高亮        │ 标记已处理        │
│ [差异诊断 分三段折叠]             │ 标记已忽略        │
│ [流转历史 时间线]                │ 标记误判          │
│ [锚表 + 单条重拉]                 │ 备注（必填）      │
│                                 │ 操作人            │
│                                 │ [回退为未处理]    │
│                                 │ [单条重拉]        │
└─────────────────────────────────┴──────────────────┘
```

- 用 `useParams` 取 id，`useQuery` 取 detail 数据，依赖 `diffsApi.detail`
- 状态徽章复用 DiffsPage 的 STATUS_BADGE / TYPE_BADGE / HANDLE_BADGE（提到 `diffs/constants.ts` 共享）
- 左右数据 KV：直接渲染 `left_data_json` / `right_data_json`；金额字段识别靠 detail.checkCompareRules（isAmount=true 规则的 leftField/rightField 剥 ds 前缀得 field 名 → 高亮 + 显示单位）
- 差异诊断：分"匹配阶段 / 比较阶段 / 判定阶段"三段渲染（对应 diff_diagnosis_json 的字段：raw_key/normalized_key/transform_chain/left_rows/unmatched_side/multi_row_group_size/matched_index_hit | compared_fields/mismatches/aggregate_summary | diff_type_decided/reason/pending_peer_pull_run_id/upgrade_condition/generated_at）
- 时间线：新建小组件 `features/diffs/StatusTimeline.tsx`（用 div+border-left 拼，不引入新依赖）；数据来源 = `statusHistory` + `handleHistory` 合并按时间排序
- 锚表：直接渲染 anchors 数组 + 每行"单条重拉"按钮（调 `diffsApi.fetchOne`）
- 人工判定操作：3 个按钮 + handleModal（用 Dialog 组件）+ 备注 + 操作人 input
- 已处理 banner：handle_status != unhandled 时显示，含"回退"链接 → revertModal

#### 3. 列表页"详情"按钮

[DiffsPage.tsx](file:///d:/work/mis-platform/recon/recon-admin-web/src/features/diffs/DiffsPage.tsx) 表格行操作列加"详情"按钮，`navigate('/diffs/' + row.id)`。保留行展开（用户可选两种入口）。

## 改动文件清单

### 后端（新增/修改）
- 新增 `db/migration/V4__diff_status_history.sql`
- 修改 [DetailDao.java](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/dao/DetailDao.java)：+4 方法
- 修改 [DiffHandleDao.java](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/dao/DiffHandleDao.java)：+revertDetailHandle
- 修改 [DiffHandleService.java](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/service/engine/DiffHandleService.java)：+revert，handle 加埋点
- 修改 [VerdictService.java](file:///d:/work/mis-platform/recon/recon-service/src/main/java/com/mis/recon/service/engine/VerdictService.java)：4 处埋点
- 新增 `controller/DiffDetailController.java`
- 新增 `domain/dto/DiffDetailResp.java` / `RevertReq.java` / `FetchOneReq.java` / `StatusHistoryRow.java` / `HandleHistoryRow.java`

### 前端（新增/修改）
- 修改 [router.tsx](file:///d:/work/mis-platform/recon/recon-admin-web/src/app/router.tsx)：+`/diffs/:id` 路由
- 修改 `types/api.ts`：+5 类型
- 修改 `lib/api/diffs.ts`：+4 方法
- 新增 `features/diffs/DiffDetailPage.tsx`
- 新增 `features/diffs/StatusTimeline.tsx`
- 新增 `features/diffs/constants.ts`（提取徽章映射共享）
- 修改 [DiffsPage.tsx](file:///d:/work/mis-platform/recon/recon-admin-web/src/features/diffs/DiffsPage.tsx)：列表行加"详情"按钮 + 引用 constants

## 验收

1. **V4 迁移**：重启 recon-service，查 `recon_detail` 有 `confirmed_at` 列、`recon_diff_status_history` 表存在
2. **状态历史留痕**：触发一次对账，DIFF 进 pending → 等对端水位推进或超时升级 confirmed，查 `recon_diff_status_history` 有 pending→confirmed 两条记录
3. **详情 API**：`GET /internal/v1/recon/diffs/{id}` 返回完整 detail + anchors + handleHistory + statusHistory + checkCompareRules
4. **回退 API**：先 `POST /diffs/{id}/handle {handle_status:"handled"}`，再 `POST /diffs/{id}/revert {operator:"test", remark:"误操作"}`，查 detail.handle_status 回到 unhandled，diff_handle 有两条记录（handled + unhandled），status_history 有 handle_status 流转两条
5. **单条重拉**：`POST /diffs/{id}/fetch-one {side:"left"}` 返回 `{found:true, insert:0, update:1}`；台账 `recon_source_record` 对应 record_key 的 updated_at 变化
6. **前端**：列表点"详情"→ 跳 `/diffs/123`，页面渲染：状态徽章 + 匹配键 + 左右数据 KV（金额字段高亮）+ 诊断三段 + 时间线 + 锚表；点"标记已处理"弹 modal，填备注提交 → banner 出现"已被 X 标记为已处理，可回退"；点"回退为未处理"→ banner 消失，操作区恢复；点锚表行"单条重拉"→ 弹 fetchOneModal，触发后提示"已触发，下轮对账自动重判"
7. **编译**：`mvn -q -o compile -DskipTests`（recon-service，JDK17）无错误；前端 `pnpm tsc --noEmit` 无错误

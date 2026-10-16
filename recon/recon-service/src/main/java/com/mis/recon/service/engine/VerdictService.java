package com.mis.recon.service.engine;

import com.mis.recon.custom.CustomDiff;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.MatchedIndexDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.runtime.AnomalyRow;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.MatchResult;
import com.mis.recon.domain.runtime.Mismatch;
import com.mis.recon.util.HashUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 差异判定服务（T05-spec §9 判定逻辑）：matched 索引 + 配平出池 + 差异身份 upsert + 两轮确认。
 * <p>状态机（§18.2）：首次 unmatched→pending（记对端水位）；field_mismatch/anomaly→confirmed；
 * 后续一致→resolved；仍 unmatched 且对端水位越过 OR 超时→confirmed；resolved 后又变→reopen。</p>
 */
@Service
public class VerdictService {

    private static final Logger log = LoggerFactory.getLogger(VerdictService.class);

    /** 本轮判定统计（diff 含 anomaly，供 recon_run.diff_count 既有口径） */
    public static class Stats {
        public int matched;
        public int diff;
        public int resolved;

        public void add(Stats o) {
            this.matched += o.matched;
            this.diff += o.diff;
            this.resolved += o.resolved;
        }
    }

    private static final String PAIR_SEGMENT = "-";

    private final DetailDao detailDao;
    private final MatchedIndexDao matchedIndexDao;
    private final PullRunDao pullRunDao;
    private final CompareEngine compareEngine;
    private final DiffDescBuilder diffDescBuilder;
    private final DiagnosisBuilder diagnosisBuilder;

    public VerdictService(DetailDao detailDao, MatchedIndexDao matchedIndexDao, PullRunDao pullRunDao,
                          CompareEngine compareEngine, DiffDescBuilder diffDescBuilder,
                          DiagnosisBuilder diagnosisBuilder) {
        this.detailDao = detailDao;
        this.matchedIndexDao = matchedIndexDao;
        this.pullRunDao = pullRunDao;
        this.compareEngine = compareEngine;
        this.diffDescBuilder = diffDescBuilder;
        this.diagnosisBuilder = diagnosisBuilder;
    }

    /**
     * 判定全部匹配结果，写差异/索引/配平。
     *
     * @param scenario 场景快照（poolMaxAgeDays/pendingMaxWaitHours）
     * @param check    check 快照
     * @param result   匹配结果（pairs / unmatched / anomalies）
     * @param dsAlias  ds_code → alias（diff_desc 别名）
     */
    public Stats apply(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                       MatchResult result, Map<String, String> dsAlias) {
        Stats stats = new Stats();
        String leftDs = check.match.datasets.get(0);
        String rightDs = check.match.datasets.get(1);
        String leftAlias = dsAlias.getOrDefault(leftDs, leftDs);
        String rightAlias = dsAlias.getOrDefault(rightDs, rightDs);
        // 自定义实现可选诊断上下文（strategy=custom 附带；其余策略为 null → 无 custom_context 节点）
        Map<String, Object> customCtx = result.getDiagnosisContext();

        for (MatchPair pair : result.getPairs()) {
            CompareResult cr = compareEngine.compare(check.compareRules, pair, check.unitByField);
            if (cr.isConsistent()) {
                handleMatched(scenario, check, pair, stats);
            } else {
                handleMismatch(scenario, check, pair, cr, stats, customCtx);
            }
        }
        for (LedgerRow row : result.getUnmatchedLeft()) {
            // 左侧有、右侧无 → 右侧缺失（需求口径 diff_type=unmatched_right）；row 属左
            handleUnmatched(scenario, check, row, "unmatched_right", rightDs, leftAlias, "left", stats, customCtx);
        }
        for (LedgerRow row : result.getUnmatchedRight()) {
            // 右侧有、左侧无 → 左侧缺失（需求口径 diff_type=unmatched_left）；row 属右
            handleUnmatched(scenario, check, row, "unmatched_left", leftDs, rightAlias, "right", stats, customCtx);
        }
        for (AnomalyRow a : result.getAnomalies()) {
            handleAnomaly(scenario, check, a, stats, customCtx);
        }
        return stats;
    }

    // ---- 匹配一致：写索引 + 配平出池 ----

    private void handleMatched(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                               MatchPair pair, Stats stats) {
        matchedIndexDao.replace(scenario.scenarioCode, check.checkName, PAIR_SEGMENT,
                pair.getMatchKeyHash(), pair.getMatchKeyDisplay(), toIndexRows(pair));
        Long pid = poolDetailId(pair);
        if (pid != null) {
            DetailDao.DetailRow d = detailDao.findById(pid);
            String was = d == null ? null : d.status;
            if (!"resolved".equals(was)) {
                detailDao.markResolved(pid);
                recordStatusHistory(pid, was, "resolved", "matched");
            }
            stats.resolved++;
        }
        // 身份级清理：同 identity（check/pair_segment/match_key_hash）残留的未匹配差异，
        // 本轮已配平即证据充分，一并 resolve——避免"一侧先配平、另一侧旧 unmatched 差异残留"。
        // 池差异 resolve 后 findIdentity 即见 resolved，天然去重。
        DetailDao.IdentityState stale = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, pair.getMatchKeyHash());
        if (stale != null && !"resolved".equals(stale.status)) {
            detailDao.markResolved(stale.id);
            recordStatusHistory(stale.id, stale.status, "resolved", "matched");
            stats.resolved++;
        }
        stats.matched++;
    }

    private List<MatchedIndexDao.IndexRow> toIndexRows(MatchPair pair) {
        List<MatchedIndexDao.IndexRow> rows = new ArrayList<>();
        for (LedgerRow r : pair.getLeftRows()) {
            rows.add(new MatchedIndexDao.IndexRow(pair.getMatchKeyHash(), r.getDsCode(), r.getRecordKey(),
                    r.getRecord().getRecordTime()));
        }
        for (LedgerRow r : pair.getRightRows()) {
            rows.add(new MatchedIndexDao.IndexRow(pair.getMatchKeyHash(), r.getDsCode(), r.getRecordKey(),
                    r.getRecord().getRecordTime()));
        }
        return rows;
    }

    private Long poolDetailId(MatchPair pair) {
        if (pair.getLeftSingle() != null && pair.getLeftSingle().getPoolDetailId() != null) {
            return pair.getLeftSingle().getPoolDetailId();
        }
        if (pair.getRightSingle() != null && pair.getRightSingle().getPoolDetailId() != null) {
            return pair.getRightSingle().getPoolDetailId();
        }
        return null;
    }

    // ---- 匹配不一致：field_mismatch → confirmed + 删索引 ----

    private void handleMismatch(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                MatchPair pair, CompareResult cr, Stats stats, Map<String, Object> customCtx) {
        DetailDao.IdentityState state = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, pair.getMatchKeyHash());
        boolean reopened = false;
        String wasStatus = state == null ? null : state.status;
        if (state != null && "resolved".equals(state.status)) {
            detailDao.reopen(state.id);
            matchedIndexDao.deleteByIdentity(scenario.scenarioCode, check.checkName, PAIR_SEGMENT,
                    pair.getMatchKeyHash());
            reopened = true;
        }
        DetailDao.DetailUpsert up = new DetailDao.DetailUpsert();
        up.identity = new DetailDao.DetailIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, pair.getMatchKeyHash());
        up.diffType = "field_mismatch";
        up.status = "confirmed";
        up.matchKeyDisplay = pair.getMatchKeyDisplay();
        up.diffDesc = diffDescBuilder.buildFieldMismatch(cr.getMismatches());
        up.diffAmountCent = cr.getDiffAmountCent();
        up.diffPoint = cr.getDiffPoint();
        up.leftDataJson = dataJson(pair.getLeftSingle());
        up.rightDataJson = dataJson(pair.getRightSingle());
        up.diagnosisJson = diagnosisBuilder.build(com.mis.recon.domain.runtime.DiagnosisContext.builder()
                .checkName(check.checkName).matchKeyHash(pair.getMatchKeyHash())
                .matchKeyDisplay(pair.getMatchKeyDisplay()).multiRowGroupSize(pair.getMultiRowGroupSize())
                .matchedIndexHit(false).comparedFields(cr.getComparedFields()).mismatches(cr.getMismatches())
                .diffTypeDecided("field_mismatch").reason("values_differ").upgradeCondition("none")
                .customContext(customCtx).build());
        long id = detailDao.upsertDetail(up);
        detailDao.upsertAnchors(id, anchors(pair));
        detailDao.touchConfirmedAt(id);
        if (state != null && state.pendingPeerDsCode != null) {
            detailDao.resetPending(state.id);   // diff_type 流转（unmatched→field_mismatch）重置 pending 三字段
        }
        matchedIndexDao.deleteByIdentity(scenario.scenarioCode, check.checkName, PAIR_SEGMENT,
                pair.getMatchKeyHash());
        // V4 埋点：状态变化才写历史
        if (wasStatus == null) {
            recordStatusHistory(id, null, "confirmed", "field_mismatch");
        } else if (reopened) {
            recordStatusHistory(id, "resolved", "confirmed", "reopened");
        }
        stats.diff++;
    }

    // ---- 未匹配：两轮确认 ----

    private void handleUnmatched(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                 LedgerRow row, String diffType, String peerDs, String alias, String side,
                                 Stats stats, Map<String, Object> customCtx) {
        String hash = row.getMatchKeyHash() != null ? row.getMatchKeyHash()
                : HashUtil.sha256Hex(row.getMatchKeyDisplay() == null ? "" : row.getMatchKeyDisplay());
        String display = row.getMatchKeyDisplay() == null ? "" : row.getMatchKeyDisplay();
        // side = row 实际所在侧（left=左行/right=右行），决定数据面板与金额字段读取；
        // diffType 按需求口径以"缺失的侧"命名（左行→右侧缺失 unmatched_right，右行→左侧缺失 unmatched_left）。

        // 金额=0 视为对账一致：不写 diff、不增计数、不写索引。
        // 语义：0 金额 = 无交易量，对端无记录等价（金额差=0）；积分对账里 0 积分订单即此态。
        // 下次对账这行仍会进 unmatchedLeft → 再被跳过，幂等无副作用。
        if (isZeroAmountRow(check, row, side)) {
            return;
        }

        String dataJson = dataJson(row);

        DetailDao.IdentityState state = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, hash);
        if (state == null) {
            long peerMaxId = pullRunDao.findMaxSuccessId(peerDs);
            DetailDao.DetailUpsert up = baseUpsert(scenario, check, diffType, "pending", hash, display);
            up.pendingPeerPullRunId = peerMaxId == 0 ? null : peerMaxId;
            up.pendingPeerDsCode = peerDs;
            up.leftDataJson = "left".equals(side) ? dataJson : null;
            up.rightDataJson = "right".equals(side) ? dataJson : null;
            up.diffDesc = diffDescBuilder.buildUnmatched(side, alias, display);
            up.diffPoint = unmatchedDiffPoint(check, row, side);
            up.diffAmountCent = unmatchedDiffAmountCent(check, row, side);
            up.diagnosisJson = diagnosisBuilder.build(com.mis.recon.domain.runtime.DiagnosisContext.builder()
                    .checkName(check.checkName).matchKeyHash(hash).matchKeyDisplay(display)
                    .matchedIndexHit(false).unmatchedSide(side)
                    .diffTypeDecided(diffType).reason("first_unmatched")
                    .pendingPeerPullRunId(peerMaxId == 0 ? null : peerMaxId).upgradeCondition("none")
                    .customContext(customCtx).build());
            long id = detailDao.upsertDetail(up);
            detailDao.upsertAnchors(id, List.of(new DetailDao.AnchorRow(side, row.getDsCode(), row.getRecordKey())));
            recordStatusHistory(id, null, "pending", "first_unmatched");
            stats.diff++;
            return;
        }

        String targetStatus = state.status;
        String upgradeCond = "none";
        boolean upgraded = false;
        boolean reopened = false;
        if ("pending".equals(state.status)) {
            long peerMaxId = pullRunDao.findMaxSuccessId(peerDs);
            boolean peerAdvanced = state.pendingPeerPullRunId != null && peerMaxId > state.pendingPeerPullRunId;
            boolean timeout = state.pendingAt != null
                    && LocalDateTime.now().minusHours(scenario.pendingMaxWaitHours).isAfter(state.pendingAt);
            if (peerAdvanced || timeout) {
                targetStatus = "confirmed";
                upgradeCond = peerAdvanced ? "peer_advanced" : "timeout";
                upgraded = true;
            }
        } else if ("resolved".equals(state.status)) {
            detailDao.reopen(state.id);
            matchedIndexDao.deleteByIdentity(scenario.scenarioCode, check.checkName, PAIR_SEGMENT, hash);
            targetStatus = "confirmed";
            upgradeCond = "reopened";
            reopened = true;
        }
        DetailDao.DetailUpsert up = baseUpsert(scenario, check, diffType, targetStatus, hash, display);
        up.leftDataJson = "left".equals(side) ? dataJson : null;
        up.rightDataJson = "right".equals(side) ? dataJson : null;
        up.diffDesc = diffDescBuilder.buildUnmatched(side, alias, display);
        up.diffPoint = unmatchedDiffPoint(check, row, side);
        up.diffAmountCent = unmatchedDiffAmountCent(check, row, side);
        up.diagnosisJson = diagnosisBuilder.build(com.mis.recon.domain.runtime.DiagnosisContext.builder()
                .checkName(check.checkName).matchKeyHash(hash).matchKeyDisplay(display)
                .matchedIndexHit(false).unmatchedSide(side)
                .diffTypeDecided(diffType)
                .reason("pending".equals(targetStatus) ? "still_unmatched" : "two_round_confirmed")
                .pendingPeerPullRunId(state.pendingPeerPullRunId).upgradeCondition(upgradeCond)
                .customContext(customCtx).build());
        long id = detailDao.upsertDetail(up);
        detailDao.upsertAnchors(id, List.of(new DetailDao.AnchorRow(side, row.getDsCode(), row.getRecordKey())));
        if (upgraded || reopened) {
            detailDao.touchConfirmedAt(id);
            if (upgraded) {
                recordStatusHistory(id, "pending", "confirmed", upgradeCond);
            } else {
                recordStatusHistory(id, "resolved", "confirmed", "reopened");
            }
        }
        stats.diff++;
    }

    // ---- sum_check：逐行勾稽判定（T05-spec-sum-check §9） ----

    /**
     * sum_check 逐行判定：
     * <ul>
     *   <li>一致 → findIdentity(record_key 哈希) 配平出池（markResolved + 状态历史 reason=sum_check_matched，幂等）；</li>
     *   <li>不一致（FIELD_MISMATCH/MISSING）→ upsertDetail：status=confirmed（不进两轮确认）、
     *       match_key_hash=SHA-256(record_key)、match_key_display=record_key、锚 side=left（单源无左右，决策 R1）、
     *       diff_type=field_mismatch（missing 差异附原因）。</li>
     * </ul>
     */
    public Stats applySumCheck(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                               LedgerRow row, CompareResult cr, Stats stats) {
        String recordKey = row.getRecordKey() == null ? "" : row.getRecordKey();
        String hash = HashUtil.sha256Hex(recordKey);
        String display = row.getRecordKey() == null ? "" : row.getRecordKey();

        if (cr.isConsistent()) {
            // 一致：配平出池（幂等：无旧差异则无事）
            DetailDao.IdentityState state = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                    PAIR_SEGMENT, hash);
            if (state != null && !"resolved".equals(state.status)) {
                detailDao.markResolved(state.id);
                recordStatusHistory(state.id, state.status, "resolved", "sum_check_matched");
                stats.resolved++;
            }
            return stats;
        }

        // 不一致：confirmed 直接落池
        DetailDao.IdentityState state = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, hash);
        boolean reopened = false;
        String wasStatus = state == null ? null : state.status;
        if (state != null && "resolved".equals(state.status)) {
            detailDao.reopen(state.id);
            reopened = true;
        }
        DetailDao.DetailUpsert up = baseUpsert(scenario, check, "field_mismatch", "confirmed", hash, display);
        up.diffDesc = diffDescBuilder.buildFieldMismatch(cr.getMismatches());
        up.diffAmountCent = cr.getDiffAmountCent();
        up.diffPoint = cr.getDiffPoint();
        up.leftDataJson = dataJson(row);
        up.rightDataJson = null;
        up.diagnosisJson = diagnosisBuilder.build(com.mis.recon.domain.runtime.DiagnosisContext.builder()
                .checkName(check.checkName).matchKeyHash(hash).matchKeyDisplay(display)
                .matchedIndexHit(false).unmatchedSide("left")
                .diffTypeDecided("field_mismatch").reason("sum_check_mismatch")
                .comparedFields(cr.getComparedFields()).mismatches(cr.getMismatches())
                .upgradeCondition("none").build());
        long id = detailDao.upsertDetail(up);
        detailDao.upsertAnchors(id, List.of(new DetailDao.AnchorRow("left", row.getDsCode(), row.getRecordKey())));
        detailDao.touchConfirmedAt(id);
        if (wasStatus == null) {
            recordStatusHistory(id, null, "confirmed", "sum_check");
        } else if (reopened) {
            recordStatusHistory(id, "resolved", "confirmed", "reopened");
        }
        stats.diff++;
        return stats;
    }

    // ---- 数据异常：anomaly → confirmed（直接确认，不走两轮确认） ----
    private void handleAnomaly(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                               AnomalyRow a, Stats stats, Map<String, Object> customCtx) {
        DetailDao.IdentityState state = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, a.getMatchKeyHash());
        boolean reopened = false;
        String wasStatus = state == null ? null : state.status;
        if (state != null && "resolved".equals(state.status)) {
            detailDao.reopen(state.id);
            reopened = true;
        }
        DetailDao.DetailUpsert up = baseUpsert(scenario, check, "anomaly", "confirmed",
                a.getMatchKeyHash(), a.getMatchKeyDisplay());
        up.diffDesc = diffDescBuilder.buildAnomaly(a.getReason(), a.getMatchKeyDisplay());
        up.diagnosisJson = diagnosisBuilder.build(com.mis.recon.domain.runtime.DiagnosisContext.builder()
                .checkName(check.checkName).matchKeyHash(a.getMatchKeyHash())
                .matchKeyDisplay(a.getMatchKeyDisplay()).multiRowGroupSize(totalRows(a))
                .matchedIndexHit(false).unmatchedSide("null")
                .diffTypeDecided("anomaly").reason(a.getReason()).upgradeCondition("none")
                .customContext(customCtx).build());
        long id = detailDao.upsertDetail(up);
        List<DetailDao.AnchorRow> anchors = new ArrayList<>();
        for (LedgerRow r : a.getLeftRows()) {
            anchors.add(new DetailDao.AnchorRow("left", r.getDsCode(), r.getRecordKey()));
        }
        for (LedgerRow r : a.getRightRows()) {
            anchors.add(new DetailDao.AnchorRow("right", r.getDsCode(), r.getRecordKey()));
        }
        detailDao.upsertAnchors(id, anchors);
        detailDao.touchConfirmedAt(id);
        if (wasStatus == null) {
            recordStatusHistory(id, null, "confirmed", "anomaly");
        } else if (reopened) {
            recordStatusHistory(id, "resolved", "confirmed", "reopened");
        }
        stats.diff++;
    }

    // ---- custom_check：整检查自定义差异直接落池（第三批 C3） ----

    /**
     * custom_check 差异落池（custom-需求规格 §3.3 / 方案设计 §13）：
     * <p>整检查自定义产出差异<b>直接 confirmed</b>（同 sum_check 单源自证思路），身份（matchKeyHash）
     * 由实现类决定；CustomDiff 无行引用 → 不写锚点，现场数据经 leftDataJson/rightDataJson 展示；
     * 实现类未给身份（hash 为空）→ 无法确定唯一差异，运行时跳过（降级可用）。</p>
     */
    public void applyCustomCheck(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                 List<CustomDiff> diffs, Stats stats) {
        if (diffs == null || diffs.isEmpty()) {
            return;
        }
        for (CustomDiff d : diffs) {
            String hash = d.getMatchKeyHash();
            if (hash == null || hash.isBlank()) {
                log.warn("custom_check diff 缺 matchKeyHash，跳过：check={} desc={}", check.checkName, d.getDiffDesc());
                continue;
            }
            String display = d.getMatchKeyDisplay() == null ? "" : d.getMatchKeyDisplay();
            DetailDao.IdentityState state = detailDao.findIdentity(scenario.scenarioCode, check.checkName,
                    PAIR_SEGMENT, hash);
            boolean reopened = false;
            String wasStatus = state == null ? null : state.status;
            if (state != null && "resolved".equals(state.status)) {
                detailDao.reopen(state.id);
                reopened = true;
            }
            DetailDao.DetailUpsert up = baseUpsert(scenario, check, "custom_check", "confirmed", hash, display);
            up.diffDesc = d.getDiffDesc();
            up.diffAmountCent = d.getDiffAmountCent();
            up.diffPoint = d.getDiffPoint();
            up.leftDataJson = d.getLeftDataJson();
            up.rightDataJson = d.getRightDataJson();
            up.diagnosisJson = diagnosisBuilder.build(com.mis.recon.domain.runtime.DiagnosisContext.builder()
                    .checkName(check.checkName).matchKeyHash(hash).matchKeyDisplay(display)
                    .matchedIndexHit(false).unmatchedSide("null")
                    .diffTypeDecided("custom_check").reason("custom_check").upgradeCondition("none")
                    .build());
            long id = detailDao.upsertDetail(up);
            detailDao.touchConfirmedAt(id);
            if (wasStatus == null) {
                recordStatusHistory(id, null, "confirmed", "custom_check");
            } else if (reopened) {
                recordStatusHistory(id, "resolved", "confirmed", "reopened");
            }
            stats.diff++;
        }
    }

    // ---- 辅助 ----

    /** 写状态流转历史（V4，引擎流转 operator=null）。 */
    private void recordStatusHistory(long detailId, String from, String to, String reason) {
        detailDao.insertStatusHistory(detailId, "status", from, to, reason, null);
    }

    /**
     * 判断行是否"比较值=0"（unmatched 0 值跳过用）。
     * <p>满足任一即视为 0 值行，跳过不产生差异：</p>
     * <ol>
     *   <li>isAmount=true 规则：本侧转分后 = 0（金额 0 = 无交易量，对端无记录等价）</li>
     *   <li>zeroUnmatchedSkip=true 规则：本侧该字段归一数值 = 0（积分对账里 0 积分订单即此态）</li>
     * </ol>
     */
    private boolean isZeroAmountRow(ConfigSnapshot.CheckSpec check, LedgerRow row, String side) {
        if (row == null || row.getRecordData() == null) {
            return false;
        }
        for (CompareEngine.RuleConfig rule : check.compareRules) {
            if (rule.isAmount) {
                Long cent = compareEngine.extractAmountCent(rule, row.getRecordData(), side, check.unitByField);
                if (cent != null && cent == 0) {
                    return true;
                }
            }
            if (rule.zeroUnmatchedSkip) {
                java.math.BigDecimal num = compareEngine.extractFieldNumber(rule, row.getRecordData(), side);
                if (num != null && num.compareTo(java.math.BigDecimal.ZERO) == 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 单侧 unmatched 的积分差额（V5）：取第一个 diff_unit=point 规则的本侧值绝对值；无 point 规则/缺失非法 → null */
    private Long unmatchedDiffPoint(ConfigSnapshot.CheckSpec check, LedgerRow row, String side) {
        if (row == null || row.getRecordData() == null) {
            return null;
        }
        for (CompareEngine.RuleConfig rule : check.compareRules) {
            if (rule.diffUnit == null || !"point".equals(rule.diffUnit)) {
                continue;
            }
            java.math.BigDecimal num = compareEngine.extractFieldNumber(rule, row.getRecordData(), side);
            if (num != null) {
                try {
                    return num.abs().longValueExact();
                } catch (ArithmeticException e) {
                    return null;
                }
            }
        }
        return null;
    }

    /** 单侧 unmatched 的金额差额（分）：取第一个 is_amount 规则的本侧金额（|值|，分）；无金额规则/缺失非法 → null */
    private Long unmatchedDiffAmountCent(ConfigSnapshot.CheckSpec check, LedgerRow row, String side) {
        if (row == null || row.getRecordData() == null) {
            return null;
        }
        for (CompareEngine.RuleConfig rule : check.compareRules) {
            if (!rule.isAmount) {
                continue;
            }
            Long cent = compareEngine.extractAmountCent(rule, row.getRecordData(), side, check.unitByField);
            if (cent != null) {
                return Math.abs(cent);
            }
        }
        return null;
    }

    private DetailDao.DetailUpsert baseUpsert(ConfigSnapshot.LoadedScenario scenario,
                                              ConfigSnapshot.CheckSpec check, String diffType,
                                              String status, String hash, String display) {
        DetailDao.DetailUpsert up = new DetailDao.DetailUpsert();
        up.identity = new DetailDao.DetailIdentity(scenario.scenarioCode, check.checkName,
                PAIR_SEGMENT, hash);
        up.diffType = diffType;
        up.status = status;
        up.matchKeyDisplay = display;
        return up;
    }

    private List<DetailDao.AnchorRow> anchors(MatchPair pair) {
        List<DetailDao.AnchorRow> list = new ArrayList<>();
        for (LedgerRow r : pair.getLeftRows()) {
            list.add(new DetailDao.AnchorRow("left", r.getDsCode(), r.getRecordKey()));
        }
        for (LedgerRow r : pair.getRightRows()) {
            list.add(new DetailDao.AnchorRow("right", r.getDsCode(), r.getRecordKey()));
        }
        return list;
    }

    private String dataJson(LedgerRow row) {
        return row == null || row.getRecordData() == null ? null : row.getRecordData().toString();
    }

    private int totalRows(AnomalyRow a) {
        return (a.getLeftRows() == null ? 0 : a.getLeftRows().size())
                + (a.getRightRows() == null ? 0 : a.getRightRows().size());
    }
}

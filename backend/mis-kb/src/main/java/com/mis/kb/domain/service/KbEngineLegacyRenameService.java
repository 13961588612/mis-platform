package com.mis.kb.domain.service;

import com.mis.kb.domain.entity.KbEngineRenameLog;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.KbEngineRenameAction;
import com.mis.kb.domain.model.KbEngineRenamePlan;
import com.mis.kb.domain.model.KbEngineRenameReq;
import com.mis.kb.domain.model.KbEngineRenameResult;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbEngineRenameLogRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 存量引擎 dataset 批量重命名（P1-T4，方案 X：受控端点）。
 *
 * <p><b>为什么要这个端点：</b>历史上部分库的引擎 dataset 名不是按
 * {@link KbLibraryService#expectedEngineName} 规范生成的（如分类改名后没回写引擎、
 * 早期建库逻辑不同）。这些库在对账里会被判成「名称漂移」，但没有自动修复出口。
 * 本服务把「按规范名统一回写」做成一个<b>受控、可审计、可回滚</b>的批量操作。
 *
 * <p><b>受控触发：</b>默认 {@code dryRun=true} 只出计划不落引擎副作用；真正执行必须带
 * {@code confirmToken="RENAME-LEGACY"}，否则直接拒（{@link KbResultCode#KB_ENGINE_RENAME_CONFIRM_REQUIRED}）。
 * 没有 {@code @Scheduled}——只在运维主动调用时跑，绝不在应用启动/定时任务里自动改名。
 *
 * <p><b>幂等：</b>{@code expectedName.equals(actualName)} 的行直接 {@code SKIP}，不改引擎。
 *
 * <p><b>审计与回滚：</b>每条 rename（含 SKIP/FAILED）都落 {@code kb_engine_rename_log} 一行，
 * 按 {@code batchId} 成组；回滚时反向执行该批次 {@code status=1} 的行（new_name → old_name），
 * 回滚日志 {@code action=ROLLBACK}。执行成功同时把库 {@code engine_sync_status} 回写为 1
 * （一致），回滚成功回写为 3（漂移），见 {@link #writeSyncStatus}。
 * 每条日志/状态回写用独立的 {@code REQUIRES_NEW} 子事务提交（见 {@link #commitLog}），中途中断
 * 不影响其他行与日志一致性。
 */
@Service
public class KbEngineLegacyRenameService {

    private static final Logger log = LoggerFactory.getLogger(KbEngineLegacyRenameService.class);

    /** 执行令牌：必须显式携带，避免误触全量改名。 */
    public static final String CONFIRM_TOKEN = "RENAME-LEGACY";
    /** 单次处理上限。 */
    private static final int MAX_LIMIT = 200;
    private static final int DEFAULT_LIMIT = 50;

    private final KbLibraryRepository libraryRepository;
    private final KbEngineRenameLogRepository renameLogRepository;
    private final KbLibraryService libraryService;
    private final KnowledgeEnginePort enginePort;
    private final RagflowProperties engineProperties;
    /** 自身代理引用：用于 {@code REQUIRES_NEW} 子事务提交单行日志（见 {@link #commitLog}）。 */
    private final KbEngineLegacyRenameService self;

    public KbEngineLegacyRenameService(
            KbLibraryRepository libraryRepository,
            KbEngineRenameLogRepository renameLogRepository,
            KbLibraryService libraryService,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties,
            @Lazy KbEngineLegacyRenameService self) {
        this.libraryRepository = libraryRepository;
        this.renameLogRepository = renameLogRepository;
        this.libraryService = libraryService;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
        this.self = self;
    }

    /**
     * 生成重命名计划或实际执行。
     *
     * @param req        请求（dryRun / confirmToken / limit）
     * @param operatorId 操作者用户 ID（X-User-Id 透传头）
     * @return 结果（dry-run 仅出计划；execute 实际改名并写入日志）
     */
    @Transactional(readOnly = true)
    public KbEngineRenameResult rename(KbEngineRenameReq req, Long operatorId) {
        boolean dryRun = req.dryRun() == null || req.dryRun();
        int limit = normalizeLimit(req.limit());
        // 【P1-T4 入口护栏】非 ragflow 引擎不支持引擎侧 dataset 改名（与对账 P0 的
        // skipped 口径一致）。noop/mock 的 listLibraries() 返回空列表，若放它进比对，
        // 会把全部有 ref 的库判成「引擎缺失→SKIP」甚至拿 null 名去调引擎。
        if (!engineProperties.isRagflow()) {
            String reason = "当前引擎（" + engineProperties.getType() + "）不支持引擎侧 dataset 改名，本功能仅对 ragflow 引擎生效";
            log.warn("存量改名跳过：{}", reason);
            return new KbEngineRenameResult(
                    null, dryRun, 0, 0, 0, 0, List.of(), true, reason);
        }
        if (!dryRun && !CONFIRM_TOKEN.equals(req.confirmToken())) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_RENAME_CONFIRM_REQUIRED);
        }

        List<KbEngineRenamePlan> plans = buildPlan(limit);
        String batchId = UUID.randomUUID().toString();
        Instant now = Instant.now();

        int renamed = 0;
        int skipped = 0;
        int failed = 0;
        List<KbEngineRenameResult.Item> items = new ArrayList<>();

        for (KbEngineRenamePlan plan : plans) {
            String action;
            int status;
            String error = null;
            if (plan.skip()) {
                action = KbEngineRenameAction.SKIP.code();
                status = dryRun ? 0 : 1;
                skipped++;
                // 跳过原因进日志与结果，便于审计（引擎缺失 / 归档库 / 已规范）
                error = plan.skipReason();
            } else if (dryRun) {
                action = KbEngineRenameAction.RENAME.code();
                status = 0;
            } else {
                try {
                    enginePort.renameLibrary(
                            new EngineLibraryRef(plan.engineType(), plan.nativeId()), plan.newName());
                    action = KbEngineRenameAction.RENAME.code();
                    status = 1;
                    renamed++;
                    // 设计 T4：成功同时回写 lib.engine_sync_status=1（CONSISTENT），
                    // 不能等下一轮对账（最长 5 分钟）才把刚改成功的库从「漂移」纠正过来。
                    self.writeSyncStatus(plan.libraryId(), EngineSyncStatus.CONSISTENT, now);
                } catch (Exception e) {
                    action = KbEngineRenameAction.FAILED.code();
                    status = 2;
                    error = describeError(e);
                    failed++;
                    log.warn("存量改名失败 libraryId={} nativeId={}: {}", plan.libraryId(), plan.nativeId(), error);
                }
            }
            KbEngineRenameLog logRow = buildLog(batchId, plan, action, status, error, operatorId, now);
            self.commitLog(logRow);
            items.add(new KbEngineRenameResult.Item(
                    plan.libraryId(), plan.nativeId(), plan.oldName(), plan.newName(), action, status, error));
        }

        log.info("存量改名{} batchId={} total={} renamed={} skipped={} failed={}",
                dryRun ? "(dry-run)" : "", batchId, plans.size(), renamed, skipped, failed);
        return new KbEngineRenameResult(batchId, dryRun, plans.size(), renamed, skipped, failed, items, false, null);
    }

    /**
     * 按批次回滚成功的改名（new_name → old_name）。
     *
     * @param batchId   原执行批次号
     * @param operatorId 操作者用户 ID
     * @return 回滚结果
     */
    @Transactional(readOnly = true)
    public KbEngineRenameResult rollback(String batchId, Long operatorId) {
        List<KbEngineRenameLog> success = renameLogRepository.findByBatchIdAndStatus(batchId, 1);
        if (success.isEmpty()) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_RENAME_BATCH_NOT_FOUND);
        }
        // 倒序回滚：最后改的先还原，降低「中途被打断后状态半新半旧」的歧义。
        List<KbEngineRenameLog> ordered = new ArrayList<>(success);
        ordered.sort((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()));

        String rollbackBatch = "RB-" + batchId;
        Instant now = Instant.now();
        int renamed = 0;
        int failed = 0;
        int skipped = 0;
        List<KbEngineRenameResult.Item> items = new ArrayList<>();

        for (KbEngineRenameLog row : ordered) {
            String action;
            int status;
            String error = null;
            try {
                enginePort.renameLibrary(
                        new EngineLibraryRef(row.getEngineType(), row.getNativeId()), row.getOldName());
                action = KbEngineRenameAction.ROLLBACK.code();
                status = 1;
                renamed++;
                // 回滚成功后名称回到旧名（非规范名），同步状态应还原为「漂移」，
                // 避免执行时置 1 的状态在回滚后残留成假一致；下一轮对账会再判漂移。
                self.writeSyncStatus(row.getLibraryId(), EngineSyncStatus.DRIFT_OR_FAILED, now);
            } catch (Exception e) {
                action = KbEngineRenameAction.FAILED.code();
                status = 2;
                error = describeError(e);
                failed++;
                log.warn("存量改名回滚失败 batchId={} nativeId={}: {}", batchId, row.getNativeId(), error);
            }
            KbEngineRenameLog rbLog = new KbEngineRenameLog();
            rbLog.setId(IdGenerator.nextId());
            rbLog.setBatchId(rollbackBatch);
            rbLog.setLibraryId(row.getLibraryId());
            rbLog.setEngineType(row.getEngineType());
            rbLog.setNativeId(row.getNativeId());
            rbLog.setOldName(row.getNewName());
            rbLog.setNewName(row.getOldName());
            rbLog.setAction(action);
            rbLog.setStatus(status);
            rbLog.setError(error);
            rbLog.setOperatorId(operatorId);
            rbLog.setCreatedAt(now);
            self.commitLog(rbLog);
            items.add(new KbEngineRenameResult.Item(
                    row.getLibraryId(), row.getNativeId(), row.getNewName(), row.getOldName(), action, status, error));
        }

        log.info("存量改名回滚 batchId={} rollbackBatch={} renamed={} failed={}",
                batchId, rollbackBatch, renamed, failed);
        return new KbEngineRenameResult(rollbackBatch, false, ordered.size(), renamed, skipped, failed, items, false, null);
    }

    /** 最近的重命名日志（按时间倒序）。 */
    @Transactional(readOnly = true)
    public List<KbEngineRenameLog> recentLogs(int limit) {
        int n = Math.max(1, Math.min(limit <= 0 ? 100 : limit, 500));
        return renameLogRepository.findByOrderByCreatedAtDesc(org.springframework.data.domain.PageRequest.of(0, n));
    }

    /** 某批次的全部日志（按时间倒序）。 */
    @Transactional(readOnly = true)
    public List<KbEngineRenameLog> logsByBatch(String batchId) {
        return renameLogRepository.findByBatchIdOrderByCreatedAtDesc(batchId);
    }

    // ---------------------------------------------------------------- 内部

    /** 构建重命名计划：比对「引擎实际名」与「期望规范名」。 */
    private List<KbEngineRenamePlan> buildPlan(int limit) {
        Map<String, String> actualNames = new LinkedHashMap<>();
        for (EngineLibraryBrief brief : enginePort.listLibraries()) {
            if (brief != null && StringUtils.hasText(brief.nativeId())) {
                actualNames.put(brief.nativeId(), brief.name() == null ? "" : brief.name().trim());
            }
        }
        List<KbEngineRenamePlan> plans = new ArrayList<>();
        for (KbLibrary lib : libraryRepository.findAll()) {
            if (!StringUtils.hasText(lib.getEngineLibraryRef())) {
                continue;
            }
            String actual = actualNames.get(lib.getEngineLibraryRef());
            String expected = libraryService.expectedEngineName(lib);
            boolean skip;
            String skipReason = null;
            if (actual == null) {
                // 引擎侧查无此 dataset：不处理，避免拿 null 名去调引擎（设计 T4 关键改动点）
                skip = true;
                skipReason = "引擎缺失";
            } else if (lib.isArchived()) {
                // 归档库名带 [已归档-日期] 前缀，属归档态语义，不允许批量改名覆盖（设计 T4 关键改动点；
                // 如需对归档库改名可后续加 opt-in）
                skip = true;
                skipReason = "归档库不自动改名";
            } else {
                // 幂等：名称已规范，无需改
                skip = Objects.equals(expected, actual);
                if (skip) {
                    skipReason = "已规范";
                }
            }
            plans.add(new KbEngineRenamePlan(
                    lib.getId(), lib.getEngineType(), lib.getEngineLibraryRef(),
                    actual, expected, skip, skipReason));
        }
        if (plans.size() > limit) {
            return plans.subList(0, limit);
        }
        return plans;
    }

    private KbEngineRenameLog buildLog(
            String batchId, KbEngineRenamePlan plan, String action, int status,
            String error, Long operatorId, Instant now) {
        KbEngineRenameLog row = new KbEngineRenameLog();
        row.setId(IdGenerator.nextId());
        row.setBatchId(batchId);
        row.setLibraryId(plan.libraryId());
        row.setEngineType(plan.engineType());
        row.setNativeId(plan.nativeId());
        // 引擎缺失的 SKIP 行 actual 为 null：old_name/new_name 是 NOT NULL 列，落空串兜底
        row.setOldName(plan.oldName() == null ? "" : plan.oldName());
        row.setNewName(plan.newName() == null ? "" : plan.newName());
        row.setAction(action);
        row.setStatus(status);
        row.setError(error);
        row.setOperatorId(operatorId);
        row.setCreatedAt(now);
        return row;
    }

    /**
     * 单行日志的 {@code REQUIRES_NEW} 提交。
     *
     * <p>每条 rename 独立成事务，前一条提交失败/引擎 IO 异常都不影响后一条与整体进度；
     * 中途进程中断也只会损失「尚未提交的那一行」，已有日志与引擎侧改名状态保持一致。
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void commitLog(KbEngineRenameLog log) {
        renameLogRepository.save(log);
    }

    /**
     * 回写库的 {@code engine_sync_status}（改名成功=一致 / 回滚成功=漂移）。
     *
     * <p>{@link #rename} / {@link #rollback} 外层事务都是 {@code readOnly=true}，直接
     * {@code save} 不会落库（只读连接 + FlushMode.MANUAL）；这里用与 {@link #commitLog}
     * 同粒度的 {@code REQUIRES_NEW} 独立读写子事务，保证「引擎侧已改 + 日志已落 + 本地
     * 状态回写」一致提交。库不存在时仅告警，不阻断批次其余行。
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void writeSyncStatus(long libraryId, int status, Instant checkedAt) {
        KbLibrary lib = libraryRepository.findById(libraryId).orElse(null);
        if (lib == null) {
            log.warn("存量改名回写同步状态失败：库不存在 libraryId={}", libraryId);
            return;
        }
        lib.setEngineSyncStatus(status);
        lib.setEngineCheckedAt(checkedAt);
        libraryRepository.save(lib);
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static String describeError(Exception e) {
        String message = e.getMessage();
        return StringUtils.hasText(message) ? message : e.getClass().getSimpleName();
    }
}

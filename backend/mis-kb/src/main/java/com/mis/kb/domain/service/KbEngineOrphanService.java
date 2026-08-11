package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbEngineOrphanVO;
import com.mis.kb.domain.entity.KbEngineOrphan;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.KbEngineOrphanAction;
import com.mis.kb.domain.model.KbEngineOrphanResolveReq;
import com.mis.kb.domain.model.KbEngineOrphanResolveResult;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.Secrecy;
import com.mis.kb.domain.repository.KbEngineOrphanRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * 引擎侧游离 dataset 的认领 / 清理（P1-T3）。
 *
 * <p>「引擎有 / MIS 无」的差异由定时对账写进 {@code kb_engine_orphan}，本服务负责把
 * 这些游离项从「待处理」推进到「已处置」。三种处置动作见 {@link KbEngineOrphanAction}，
 * 各自的护栏写在服务端，避免前端绕过校验直接改库。
 *
 * <p><b>引擎侧改名失败不回滚绑定</b>：与 P0 归档口径一致——本地语义优先。绑错了库
 * 远比引擎名差一格严重，所以改名失败只把 {@code engine_sync_status} 写 3、由 P1-T4
 * 的存量重命名端点做修复出口，绝不把刚建立的 {@code engine_library_ref} 再拆掉。
 */
@Service
public class KbEngineOrphanService {

    private static final Logger log = LoggerFactory.getLogger(KbEngineOrphanService.class);

    private final KbEngineOrphanRepository orphanRepository;
    private final KbLibraryRepository libraryRepository;
    private final KbLibraryService libraryService;
    private final KnowledgeEnginePort enginePort;
    private final RagflowProperties engineProperties;

    public KbEngineOrphanService(
            KbEngineOrphanRepository orphanRepository,
            KbLibraryRepository libraryRepository,
            KbLibraryService libraryService,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties) {
        this.orphanRepository = orphanRepository;
        this.libraryRepository = libraryRepository;
        this.libraryService = libraryService;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
    }

    /**
     * 列出某引擎下的游离项（按 resolve 状态）。
     *
     * <p>非 ragflow 引擎不可能有游离项，直接返回空列表（护栏见 §1.2-3）。
     *
     * @param engineType   引擎类型；{@code null} 时取当前引擎类型
     * @param resolved     0=待处理 1=已处置
     * @return 视图列表，恒非 {@code null}
     */
    @Transactional(readOnly = true)
    public List<KbEngineOrphanVO> list(String engineType, int resolved) {
        String type = resolveEngineType(engineType);
        if (!engineProperties.isRagflow()) {
            return List.of();
        }
        List<KbEngineOrphan> rows;
        if (resolved == 1) {
            rows = orphanRepository.findByEngineTypeAndResolvedOrderByResolvedAtDesc(type, 1);
        } else {
            rows = orphanRepository.findByEngineTypeAndResolvedOrderByLastSeenAtDesc(type, 0);
        }
        return rows.stream().map(KbEngineOrphanVO::from).toList();
    }

    /**
     * 处置一个游离项。
     *
     * @param engineType  引擎类型；{@code null} 时取当前引擎类型
     * @param nativeId    引擎原生 dataset id
     * @param req         处置请求
     * @param operatorId  操作者用户 ID（X-User-Id 透传头）
     * @return 处置结果
     */
    @Transactional
    public KbEngineOrphanResolveResult resolve(
            String engineType, String nativeId, KbEngineOrphanResolveReq req, Long operatorId) {
        if (!engineProperties.isRagflow()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "当前引擎不支持游离数据集处置");
        }
        String type = resolveEngineType(engineType);
        KbEngineOrphanAction action = KbEngineOrphanAction.of(req.action());
        if (action == null) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_ACTION_INVALID);
        }

        KbEngineOrphan orphan = orphanRepository.findByEngineTypeAndNativeId(type, nativeId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_NOT_FOUND));
        if (orphan.getResolved() != null && orphan.getResolved() == 1) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_NOT_FOUND);
        }

        return switch (action) {
            case BIND_EXISTING -> bindExisting(orphan, req, operatorId);
            case ADOPT_NEW -> adoptNew(orphan, req, operatorId);
            case IGNORE -> ignore(orphan, req, operatorId);
        };
    }

    /** 认领到已存在的 MIS 库：绑定 ref + 必要时改引擎名。 */
    private KbEngineOrphanResolveResult bindExisting(
            KbEngineOrphan orphan, KbEngineOrphanResolveReq req, Long operatorId) {
        if (req.targetLibraryId() == null) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_ACTION_INVALID);
        }
        KbLibrary target = libraryRepository.findById(req.targetLibraryId())
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
        // 护栏：目标库已绑定引擎 dataset，不能再认领另一个游离项。
        if (StringUtils.hasText(target.getEngineLibraryRef())) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_TARGET_BOUND);
        }

        target.setEngineLibraryRef(orphan.getNativeId());
        target.setEngineType(orphan.getEngineType());
        target.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);
        target.setEngineCheckedAt(Instant.now());
        target = libraryRepository.save(target);

        boolean renameFailed = renameIfNeeded(target, orphan.getNativeName());
        markResolved(orphan, KbEngineOrphanAction.BIND_EXISTING, req.note(), operatorId);
        log.info("游离项认领到存量库 nativeId={} libraryId={} renameFailed={}",
                orphan.getNativeId(), target.getId(), renameFailed);
        return new KbEngineOrphanResolveResult(
                orphan.getNativeId(), orphan.getEngineType(), KbEngineOrphanAction.BIND_EXISTING.code(),
                target.getId(), renameFailed,
                renameFailed ? "已绑定，但引擎侧改名失败，可在「存量数据集改名」中修复" : "已认领到知识库");
    }

    /** 新建一个 MIS 库并认领该游离 dataset（跳过引擎 create）。 */
    private KbEngineOrphanResolveResult adoptNew(
            KbEngineOrphan orphan, KbEngineOrphanResolveReq req, Long operatorId) {
        if (!StringUtils.hasText(req.name()) || req.categoryId() == null || !Secrecy.isValid(req.secrecy())) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_ACTION_INVALID);
        }
        String name = req.name().trim();
        if (libraryRepository.existsByNameAndCategoryId(name, req.categoryId())) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NAME_EXISTS);
        }
        long libraryId = IdGenerator.nextId();
        Instant now = Instant.now();
        KbLibrary entity = new KbLibrary();
        entity.setId(libraryId);
        entity.setCategoryId(req.categoryId());
        entity.setName(name);
        entity.setSecrecy(req.secrecy());
        entity.setStatus(LibraryStatus.ENABLED.code());
        entity.setOwner(req.owner() != null ? req.owner() : operatorId);
        entity.setEngineType(orphan.getEngineType());
        entity.setEngineLibraryRef(orphan.getNativeId());
        entity.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);
        entity.setEngineCheckedAt(now);
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        entity = libraryRepository.save(entity);

        boolean renameFailed = renameIfNeeded(entity, orphan.getNativeName());
        markResolved(orphan, KbEngineOrphanAction.ADOPT_NEW, req.note(), operatorId);
        log.info("游离项新建库认领 nativeId={} libraryId={} renameFailed={}",
                orphan.getNativeId(), entity.getId(), renameFailed);
        return new KbEngineOrphanResolveResult(
                orphan.getNativeId(), orphan.getEngineType(), KbEngineOrphanAction.ADOPT_NEW.code(),
                entity.getId(), renameFailed,
                renameFailed ? "已创建并绑定，但引擎侧改名失败，可在「存量数据集改名」中修复" : "已新建知识库并认领");
    }

    /** 标记已处理（不绑定、不删引擎数据）。 */
    private KbEngineOrphanResolveResult ignore(
            KbEngineOrphan orphan, KbEngineOrphanResolveReq req, Long operatorId) {
        String note = req.note();
        if (!StringUtils.hasText(note) || note.trim().length() < 5) {
            throw new KbBusinessException(KbResultCode.KB_ENGINE_ORPHAN_ACTION_INVALID);
        }
        markResolved(orphan, KbEngineOrphanAction.IGNORE, note.trim(), operatorId);
        log.info("游离项已忽略 nativeId={} operatorId={}", orphan.getNativeId(), operatorId);
        return new KbEngineOrphanResolveResult(
                orphan.getNativeId(), orphan.getEngineType(), KbEngineOrphanAction.IGNORE.code(),
                null, false, "已标记为处理（引擎侧数据保留）");
    }

    /** 引擎侧实际名与期望名不符时改名；返回是否失败（失败不回滚绑定）。 */
    private boolean renameIfNeeded(KbLibrary lib, String engineActualName) {
        String expected = libraryService.expectedEngineName(lib);
        if (Objects.equals(expected, engineActualName)) {
            lib.setEngineSyncStatus(EngineSyncStatus.CONSISTENT);
            libraryRepository.save(lib);
            return false;
        }
        try {
            enginePort.renameLibrary(
                    new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()), expected);
            lib.setEngineSyncStatus(EngineSyncStatus.CONSISTENT);
            lib.setEngineCheckedAt(Instant.now());
            libraryRepository.save(lib);
            return false;
        } catch (Exception e) {
            String reason = describeError(e);
            log.warn("游离项认领后引擎改名失败 nativeId={} libraryId={}: {}",
                    lib.getEngineLibraryRef(), lib.getId(), reason);
            lib.setEngineSyncStatus(EngineSyncStatus.DRIFT_OR_FAILED);
            lib.setEngineCheckedAt(Instant.now());
            libraryRepository.save(lib);
            return true;
        }
    }

    /** 把游离行标记为已处置并落库。 */
    private void markResolved(
            KbEngineOrphan orphan, KbEngineOrphanAction action, String note, Long operatorId) {
        Instant now = Instant.now();
        orphan.setResolved(1);
        orphan.setResolvedAction(action.code());
        orphan.setResolvedAt(now);
        orphan.setResolvedNote(note);
        orphan.setResolvedBy(operatorId);
        orphanRepository.save(orphan);
    }

    private String resolveEngineType(String engineType) {
        return StringUtils.hasText(engineType) ? engineType : enginePort.engineType();
    }

    private static String describeError(Exception e) {
        String message = e.getMessage();
        return StringUtils.hasText(message) ? message : e.getClass().getSimpleName();
    }
}

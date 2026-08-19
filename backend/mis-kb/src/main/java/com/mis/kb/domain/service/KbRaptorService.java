package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbRaptorBuildResultVO;
import com.mis.kb.api.dto.KbRaptorStatusVO;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RaptorBuildSnapshot;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Objects;

/**
 * RAPTOR 构建链路核心服务（Wave C RAPTOR，T02）。
 *
 * <p>职责：触发构建（手动/自动重试）、状态查询（引擎刷新回写）、状态机守卫。
 * <b>MIS 侧 {@code raptorBuildStatus} 是唯一事实源</b>（U3：落库 rag_settings_json +
 * 查询时引擎刷新回写），本服务是唯一写入口。
 *
 * <p><b>状态机（与图谱同款，共享知识 §10-10）：</b>
 * {@code none → building → ready|failed →（重试）building}。
 * <ul>
 *   <li>{@code building} 拒绝重复触发（{@code KB_RAPTOR_BUILD_IN_PROGRESS}）；</li>
 *   <li>{@code ready} 清 {@code raptorBuildMessage}；</li>
 *   <li>{@code none}/{@code failed} 可重试（引擎侧幂等跳过已建树，T00 P2c 实测）。</li>
 * </ul>
 *
 * <p><b>与图谱不互斥（T00 P2c 实测）：</b>graph/raptor 构建<b>可并行</b>，
 * {@code raptorBuildStatus} 与 {@code kgBuildStatus} 各自独立状态机，互不拦截。
 *
 * <p><b>U4 裁定：不设库数上限</b>——只有平台总开关
 * {@code mis.kb.engine.raptor-enabled}（默认 true）+ 能力 {@code raptor} 闸门
 * （{@code KB_RAPTOR_UNSUPPORTED}），<b>不存在</b> {@code KB_RAPTOR_LIBRARY_LIMIT}。
 * 因此本类没有 {@code canEnableGraph} 的对应物（{@code KbGraphService} 有上限校验，
 * 这里刻意不写）。
 *
 * <p><b>ACL 红线（设计 §2.5 同款）：</b>构建 = 修改引擎侧资源，按「写」对待——
 * BFF 权限码 {@code kb:library:edit} + 本服务 {@code hasLibraryManage}（管辖双闸门）
 * + 库 enabled + 有引擎映射；状态查询为读操作（BFF 权限码
 * {@code kb:library:engine-ref:view}），本服务不做管辖判定（只做库存在性）。
 */
@Service
public class KbRaptorService {

    private static final Logger log = LoggerFactory.getLogger(KbRaptorService.class);

    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;
    private final NodeAdminResolver nodeAdminResolver;
    private final KnowledgeEnginePort enginePort;

    public KbRaptorService(
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository,
            NodeAdminResolver nodeAdminResolver,
            KnowledgeEnginePort enginePort) {
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
        this.nodeAdminResolver = nodeAdminResolver;
        this.enginePort = enginePort;
    }

    /**
     * 触发 RAPTOR 摘要构建（手动按钮 / 保存开关自动触发共用）。
     *
     * <p>前置校验链（设计 §2.3 同款，去上限）：库存在 + 未归档 + 有引擎映射 → 管辖双闸门
     * （{@code hasLibraryManage}）→ 能力 {@code raptor} → 文档非空 → 状态机非
     * {@code building}。全部通过才调引擎并回写 {@code building}。
     *
     * @param libraryId 知识库 id
     * @param userId    当前用户 id（管辖双闸门判定；自动触发场景由保存请求上下文注入）
     * @return 构建触发回执（building=true + taskId + 落库后状态）
     */
    @Transactional
    public KbRaptorBuildResultVO build(Long libraryId, Long userId) {
        KbLibrary lib = require(libraryId);
        // 前置：未归档（status=enabled）+ 有引擎映射
        if (lib.isArchived()) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND);
        }
        if (lib.getStatus() == null || !LibraryStatus.isEnabled(lib.getStatus())) {
            throw new KbBusinessException(KbResultCode.KB_RAPTOR_UNSUPPORTED, "知识库已停用，无法构建 RAPTOR");
        }
        if (lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            throw new KbBusinessException(KbResultCode.KB_RAPTOR_UNSUPPORTED, "知识库无引擎映射，无法构建 RAPTOR");
        }
        // 管辖双闸门（mis-kb 侧第二道；BFF 权限码 kb:library:edit 是第一道）
        if (!nodeAdminResolver.hasLibraryManage(userId, libraryId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE);
        }
        // 能力闸门：capabilities.raptor=false → 拒（三道防线第二道；U4 无库数上限）
        if (!enginePort.capabilities().supports(EngineCapabilities.CAP_RAPTOR)) {
            throw new KbBusinessException(KbResultCode.KB_RAPTOR_UNSUPPORTED);
        }
        // 文档非空：引擎侧无文档构建无意义（T00 P2d：建树依赖既有 chunks）
        if (documentRepository.countByLibraryId(libraryId) <= 0) {
            throw new KbBusinessException(KbResultCode.KB_RAPTOR_UNSUPPORTED, "知识库暂无文档，无法构建 RAPTOR");
        }
        // 状态机：building 拒绝重复触发（引擎侧重复触发会幂等跳过，MIS 先行拦截双保险）
        RagSettings current = readSettings(lib);
        if (RagSettings.RAPTOR_STATUS_BUILDING.equals(current.raptorBuildStatus())) {
            throw new KbBusinessException(KbResultCode.KB_RAPTOR_BUILD_IN_PROGRESS);
        }
        // 触发引擎构建（只排队任务，立即返回 task_id，不等待构建完成）
        String taskId = enginePort.buildRaptor(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()));
        // 回写 building（ready 才清 message；触发成功时清空旧 message 避免残留失败摘要）
        writeBackStatus(lib, RagSettings.RAPTOR_STATUS_BUILDING, null);
        log.info("RAPTOR 构建已触发并回写 building libraryId={} taskId={}", libraryId, taskId);
        return new KbRaptorBuildResultVO(true, taskId, RagSettings.RAPTOR_STATUS_BUILDING);
    }

    /**
     * 刷新 RAPTOR 构建状态（{@code GET /libraries/{id}/raptor/build-status} 每次调用触发）。
     *
     * <p>查引擎 {@code GET /datasets/{id}/index?type=raptor} → 映射 progress →
     * 与本地 {@code raptorBuildStatus} 比对，<b>有变化才写库</b>（避免无效写放大）：
     * <ul>
     *   <li>{@code READY} → {@code ready}，清 {@code raptorBuildMessage}；</li>
     *   <li>{@code FAILED} → {@code failed}，{@code raptorBuildMessage} = progress_msg 摘要（≤200）；</li>
     *   <li>{@code BUILDING} → {@code building}，{@code raptorBuildMessage} 可存 progress_msg 摘要；</li>
     *   <li>{@code NONE}（无任务/引擎不可达）→ 保留本地值（R6 漂移防线）。</li>
     * </ul>
     *
     * <p>读操作：不判管辖，只做库存在性（设计 §2.5 状态查询按读权限）。
     *
     * @param libraryId 知识库 id
     * @return 状态回执（含引擎 taskId 与最近回写时刻）
     */
    @Transactional
    public KbRaptorStatusVO refreshStatus(Long libraryId) {
        KbLibrary lib = require(libraryId);
        if (lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            RagSettings local = readSettings(lib);
            return new KbRaptorStatusVO(
                    local.raptorBuildStatus(), local.raptorBuildMessage(), null, lib.getUpdatedAt());
        }
        RaptorBuildSnapshot snapshot = enginePort.queryRaptorBuildStatus(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()));
        if (snapshot == null || snapshot.status() == null
                || snapshot.status() == RaptorBuildSnapshot.Status.NONE) {
            RagSettings local = readSettings(lib);
            return new KbRaptorStatusVO(
                    local.raptorBuildStatus(), local.raptorBuildMessage(), null, lib.getUpdatedAt());
        }
        String newStatus = switch (snapshot.status()) {
            case READY -> RagSettings.RAPTOR_STATUS_READY;
            case FAILED -> RagSettings.RAPTOR_STATUS_FAILED;
            default -> RagSettings.RAPTOR_STATUS_BUILDING;
        };
        String newMessage = switch (snapshot.status()) {
            case READY -> null;
            default -> truncate(snapshot.progressMsg());
        };
        RagSettings current = readSettings(lib);
        if (!newStatus.equals(current.raptorBuildStatus())
                || !Objects.equals(newMessage, current.raptorBuildMessage())) {
            writeBackStatus(lib, newStatus, newMessage);
            log.info("RAPTOR 构建状态回写 libraryId={} {} → {}（taskId={}）",
                    libraryId, current.raptorBuildStatus(), newStatus, snapshot.taskId());
        }
        return new KbRaptorStatusVO(newStatus, newMessage, snapshot.taskId(), lib.getUpdatedAt());
    }

    // ---------------------------------------------------------------- 内部

    private KbLibrary require(Long libraryId) {
        return libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private RagSettings readSettings(KbLibrary lib) {
        RagSettings stored = KbJson.readSettings(lib.getRagSettingsJson());
        return stored == null ? RagSettings.defaults() : stored.withDefaults();
    }

    /**
     * 回写 RAPTOR 状态到 {@code rag_settings_json}（26 参 canonical 保留其余字段，含图谱三字段）。
     *
     * @param lib     知识库实体
     * @param status  四态码值
     * @param message 消息摘要；{@code ready} 时传 {@code null} 清空
     */
    private void writeBackStatus(KbLibrary lib, String status, String message) {
        RagSettings current = readSettings(lib);
        RagSettings updated = new RagSettings(
                current.topK(),
                current.scoreThreshold(),
                current.rerank(),
                current.embeddingModel(),
                current.retrievalMethod(),
                current.chunkMethod(),
                current.chunkTokenNum(),
                current.separator(),
                current.emptyResultStrategy(),
                current.vectorSimilarityWeight(),
                current.rerankModelId(),
                current.ocrEnabled(),
                current.ocrLanguage(),
                current.chunkOverlapTokenNum(),
                current.useKnowledgeGraph(),
                current.kgBuildStatus(),
                current.kgBuildMessage(),
                current.useRaptor(),
                current.raptorMaxTokenNum(),
                current.raptorThreshold(),
                current.raptorMaxCluster(),
                current.raptorPrompt(),
                status,
                message,
                current.pageIndex(),
                current.imageTableContextWindow(),
                current.overlapPercent(),
                current.autoKeywords(),
                current.autoQuestions());
        lib.setRagSettingsJson(KbJson.writeSettings(updated));
        lib.setUpdatedAt(Instant.now());
        libraryRepository.save(lib);
    }

    /**
     * 截断引擎 {@code progress_msg} 摘要至 200 字符（设计 §2.1 raptorBuildMessage ≤200 约束）。
     *
     * @param message 原始摘要；{@code null} 返回 {@code null}
     * @return 截断后摘要
     */
    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        String trimmed = message.trim();
        if (trimmed.length() <= 200) {
            return trimmed;
        }
        return trimmed.substring(0, 200);
    }
}

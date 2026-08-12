package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbGraphBuildResultVO;
import com.mis.kb.api.dto.KbGraphStatusVO;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.GraphBuildSnapshot;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Objects;

/**
 * 图谱构建链路核心服务（Wave B GraphRAG PoC，T02）。
 *
 * <p>职责：触发构图（手动/自动重试）、状态查询（引擎刷新回写）、上限校验、状态机守卫。
 * <b>MIS 侧 {@code kgBuildStatus} 是唯一事实源</b>（U3：落库 rag_settings_json +
 * 查询时引擎刷新回写），本服务是唯一写入口。
 *
 * <p><b>状态机（共享知识 §10-10）：</b>{@code none → building → ready|failed →（重试）building}。
 * <ul>
 *   <li>{@code building} 拒绝重复触发（{@code KB_GRAPH_BUILD_IN_PROGRESS}）；</li>
 *   <li>{@code ready} 清 {@code kgBuildMessage}；</li>
 *   <li>{@code none}/{@code failed} 可重试（引擎侧覆盖式重跑，PoC 不做自动清理）。</li>
 * </ul>
 *
 * <p><b>ACL 红线（设计 §2.5）：</b>构图 = 修改引擎侧资源，按「写」对待——
 * BFF 权限码 {@code kb:library:edit}（网关注册表侧）+ 本服务 {@code hasLibraryManage}
 * （管辖双闸门）+ 库 enabled + 有引擎映射；状态查询为读操作（BFF 权限码
 * {@code kb:library:engine-ref:view}），本服务不做管辖判定（只做库存在性）。
 *
 * <p><b>上限校验（U7 + 设计 §2.1）：</b>{@code useKnowledgeGraph=true} 且当前启用该开关的
 * 库数 ≥ {@code mis.kb.engine.graph-max-libraries}（默认 2）→ 拒绝（{@code KB_GRAPH_LIBRARY_LIMIT}）。
 * 保存与构图两处共用 {@link #canEnableGraph}。注意图谱开关落在 {@code rag_settings_json}
 * （TEXT），无法用 SQL 计数，PoC 用内存过滤（库量级小，可接受）。
 */
@Service
public class KbGraphService {

    private static final Logger log = LoggerFactory.getLogger(KbGraphService.class);

    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;
    private final NodeAdminResolver nodeAdminResolver;
    private final KnowledgeEnginePort enginePort;
    private final RagflowProperties engineProperties;

    public KbGraphService(
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository,
            NodeAdminResolver nodeAdminResolver,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties) {
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
        this.nodeAdminResolver = nodeAdminResolver;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
    }

    /**
     * 触发图谱构建（手动按钮 / 保存开关自动触发共用）。
     *
     * <p>前置校验链（设计 §2.3）：库存在 + 未归档 + 有引擎映射 → 管辖双闸门
     * （{@code hasLibraryManage}）→ 能力 {@code graphrag} → 上限（{@link #canEnableGraph}）
     * → 文档非空 → 状态机非 {@code building}。全部通过才调引擎并回写 {@code building}。
     *
     * @param libraryId 知识库 id
     * @param userId    当前用户 id（管辖双闸门判定；自动触发场景由保存请求上下文注入）
     * @return 构图触发回执（building=true + taskId + 落库后状态）
     */
    @Transactional
    public KbGraphBuildResultVO build(Long libraryId, Long userId) {
        KbLibrary lib = require(libraryId);
        // 前置：未归档（status=enabled）+ 有引擎映射
        if (lib.isArchived()) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND);
        }
        if (lib.getStatus() == null || !LibraryStatus.isEnabled(lib.getStatus())) {
            throw new KbBusinessException(KbResultCode.KB_GRAPH_UNSUPPORTED, "知识库已停用，无法构建图谱");
        }
        if (lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            throw new KbBusinessException(KbResultCode.KB_GRAPH_UNSUPPORTED, "知识库无引擎映射，无法构建图谱");
        }
        // 管辖双闸门（mis-kb 侧第二道；BFF 权限码 kb:library:edit 是第一道）
        if (!nodeAdminResolver.hasLibraryManage(userId, libraryId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE);
        }
        // 能力闸门：capabilities.graphrag=false → 拒（三道防线第二道）
        if (!enginePort.capabilities().supports(EngineCapabilities.CAP_GRAPH)) {
            throw new KbBusinessException(KbResultCode.KB_GRAPH_UNSUPPORTED);
        }
        // 上限校验（保存与构图共用；构图触发同样受「至多 2 库」约束）
        canEnableGraph(libraryId);
        // 文档非空：引擎侧无文档构图返回失败（T00 实测 No documents）
        if (documentRepository.countByLibraryId(libraryId) <= 0) {
            throw new KbBusinessException(KbResultCode.KB_GRAPH_UNSUPPORTED, "知识库暂无文档，无法构建图谱");
        }
        // 状态机：building 拒绝重复触发
        RagSettings current = readSettings(lib);
        if (RagSettings.KG_STATUS_BUILDING.equals(current.kgBuildStatus())) {
            throw new KbBusinessException(KbResultCode.KB_GRAPH_BUILD_IN_PROGRESS);
        }
        // 触发引擎构图（只排队任务，立即返回 task_id，不等待构图完成）
        String taskId = enginePort.buildGraph(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()));
        // 回写 building（ready 才清 message；触发成功时清空旧 message 避免残留失败摘要）
        writeBackStatus(lib, RagSettings.KG_STATUS_BUILDING, null);
        log.info("图谱构建已触发并回写 building libraryId={} taskId={}", libraryId, taskId);
        return new KbGraphBuildResultVO(true, taskId, RagSettings.KG_STATUS_BUILDING);
    }

    /**
     * 刷新图谱构建状态（{@code GET /libraries/{id}/graph/build-status} 每次调用触发）。
     *
     * <p>查引擎 {@code GET /datasets/{id}/index?type=graph} → 映射 progress →
     * 与本地 {@code kgBuildStatus} 比对，<b>有变化才写库</b>（避免无效写放大）：
     * <ul>
     *   <li>{@code READY} → {@code ready}，清 {@code kgBuildMessage}；</li>
     *   <li>{@code FAILED} → {@code failed}，{@code kgBuildMessage} = progress_msg 摘要（≤200）；</li>
     *   <li>{@code BUILDING} → {@code building}，{@code kgBuildMessage} 可存 progress_msg 摘要；</li>
     *   <li>{@code NONE}（无任务/引擎不可达）→ 保留本地值（R6 漂移防线）。</li>
     * </ul>
     *
     * <p>读操作：不判管辖，只做库存在性（设计 §2.5 状态查询按读权限）。
     *
     * @param libraryId 知识库 id
     * @return 状态回执（含引擎 taskId 与最近回写时刻）
     */
    @Transactional
    public KbGraphStatusVO refreshStatus(Long libraryId) {
        KbLibrary lib = require(libraryId);
        if (lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            RagSettings local = readSettings(lib);
            return new KbGraphStatusVO(local.kgBuildStatus(), local.kgBuildMessage(), null, lib.getUpdatedAt());
        }
        GraphBuildSnapshot snapshot = enginePort.queryGraphBuildStatus(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()));
        if (snapshot == null || snapshot.status() == null
                || snapshot.status() == GraphBuildSnapshot.Status.NONE) {
            RagSettings local = readSettings(lib);
            return new KbGraphStatusVO(local.kgBuildStatus(), local.kgBuildMessage(), null, lib.getUpdatedAt());
        }
        String newStatus = switch (snapshot.status()) {
            case READY -> RagSettings.KG_STATUS_READY;
            case FAILED -> RagSettings.KG_STATUS_FAILED;
            default -> RagSettings.KG_STATUS_BUILDING;
        };
        String newMessage = switch (snapshot.status()) {
            case READY -> null;
            default -> truncate(snapshot.progressMsg());
        };
        RagSettings current = readSettings(lib);
        if (!newStatus.equals(current.kgBuildStatus())
                || !Objects.equals(newMessage, current.kgBuildMessage())) {
            writeBackStatus(lib, newStatus, newMessage);
            log.info("图谱构建状态回写 libraryId={} {} → {}（taskId={}）",
                    libraryId, current.kgBuildStatus(), newStatus, snapshot.taskId());
        }
        return new KbGraphStatusVO(newStatus, newMessage, snapshot.taskId(), lib.getUpdatedAt());
    }

    /**
     * 上限校验：当前「已启用图谱开关」的库数 ≥ {@code graph-max-libraries} 时拒绝（不含本库）。
     *
     * <p><b>保存与构图两处共用</b>（设计 §2.1）：{@code RagSettingsService.save} 在
     * {@code useKnowledgeGraph=true} 落库前调用；{@link #build} 在触发构图前调用。
     * 只统计 {@code status=enabled} 且 {@code useKnowledgeGraph=true} 的库
     * （停用/归档库不占额度）。
     *
     * @param libraryId 目标知识库 id（不计入已用额度）
     * @throws KbBusinessException 已达上限时抛出 {@code KB_GRAPH_LIBRARY_LIMIT}（message 带上限值）
     */
    public void canEnableGraph(Long libraryId) {
        int max = engineProperties.effectiveGraphMaxLibraries();
        long enabled = libraryRepository.findAll().stream()
                .filter(l -> !Objects.equals(l.getId(), libraryId))
                .filter(l -> l.getStatus() != null && LibraryStatus.isEnabled(l.getStatus()))
                .filter(l -> Boolean.TRUE.equals(readSettings(l).useKnowledgeGraph()))
                .count();
        if (enabled >= max) {
            throw new KbBusinessException(KbResultCode.KB_GRAPH_LIBRARY_LIMIT,
                    "已开启图谱的库数达到上限（" + max + "），请先关闭其他库的图谱开关");
        }
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
     * 回写图谱状态到 {@code rag_settings_json}（17 参 canonical 保留其余字段）。
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
                status,
                message);
        lib.setRagSettingsJson(KbJson.writeSettings(updated));
        lib.setUpdatedAt(Instant.now());
        libraryRepository.save(lib);
    }

    /**
     * 截断引擎 {@code progress_msg} 摘要至 200 字符（设计 §2.1 kgBuildMessage ≤200 约束）。
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

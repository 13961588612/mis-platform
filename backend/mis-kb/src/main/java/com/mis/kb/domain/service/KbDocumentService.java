package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbDocumentChunkStatsVO;
import com.mis.kb.api.dto.KbDocumentChunkVO;
import com.mis.kb.api.dto.KbDocumentChunksVO;
import com.mis.kb.api.dto.KbDocumentUploadResponse;
import com.mis.kb.api.dto.KbDocumentVO;
import com.mis.kb.api.dto.KbReparseAllResult;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.ChunkQuery;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentChunkConfigResolver;
import com.mis.kb.domain.model.DocumentChunkPageView;
import com.mis.kb.domain.model.DocumentChunkView;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EffectiveChunkConfig;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.ParseStatus;
import com.mis.kb.domain.model.ParseStatusSnapshot;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** 文档服务（D-01~10）。 */
@Service
public class KbDocumentService {

    private static final Logger log = LoggerFactory.getLogger(KbDocumentService.class);

    private final KbDocumentRepository documentRepository;
    private final KbLibraryRepository libraryRepository;
    private final KnowledgeEnginePort enginePort;
    private final KbLibraryService libraryService;
    private final KbVisibilityService visibilityService;
    private final DocumentChunkConfigResolver chunkConfigResolver;

    public KbDocumentService(
            KbDocumentRepository documentRepository,
            KbLibraryRepository libraryRepository,
            KnowledgeEnginePort enginePort,
            KbLibraryService libraryService,
            KbVisibilityService visibilityService,
            DocumentChunkConfigResolver chunkConfigResolver) {
        this.documentRepository = documentRepository;
        this.libraryRepository = libraryRepository;
        this.enginePort = enginePort;
        this.libraryService = libraryService;
        this.visibilityService = visibilityService;
        this.chunkConfigResolver = chunkConfigResolver;
    }

    /**
     * 列出知识库文档；对仍处于 pending/parsing 的文档向引擎拉取 {@code run/progress} 并回写
     * {@code parse_status}（设计文档：解析状态异步回写；前端列表轮询依赖本方法收敛）。
     */
    @Transactional
    public List<KbDocumentVO> list(Long libraryId) {
        KbLibrary lib = requireLibrary(libraryId);
        List<KbDocument> docs = documentRepository.findByLibraryIdOrderByCreatedAtDesc(libraryId);
        syncOpenParseStatuses(lib, docs);
        return docs.stream().map(this::toVo).toList();
    }

    @Transactional
    public KbDocumentVO get(Long id) {
        KbDocument entity = require(id);
        KbLibrary lib = libraryRepository.findById(entity.getLibraryId()).orElse(null);
        if (lib != null) {
            syncOpenParseStatuses(lib, List.of(entity));
        }
        return toVo(entity);
    }

    /**
     * 分页列举文档切片（「查看文档切分效果」）。
     *
     * <p>双闸门读权限：本方法内 {@link #requireDocumentRead}（ACL 读权限）兜底，
     * 外层 BFF {@code requirePermission("kb:document:list")} 已拦一道（注册表主路径）。
     *
     * <p><b>解析状态预检（空态 VO 语义）：</b>
     * <ul>
     *   <li>pending/parsing → 空态 +「文档解析中，暂无切片数据」；</li>
     *   <li>failed → 空态 +「文档解析失败，暂无切片数据」；</li>
     *   <li>{@code engineDocumentRef} 为空 → 空态 +「该文档尚未同步到引擎」；</li>
     *   <li>引擎不可达 / RAGFlow 报错 → catch 降级空态 +「引擎暂不可达」（不抛错，
     *       与 {@link #syncOpenParseStatuses} 的降级风格一致）。</li>
     * </ul>
     *
     * @param libraryId  知识库 id
     * @param documentId 文档 id
     * @param userId     当前用户 id（读权限校验；可为 null → 拒绝）
     * @param keywords   正文关键字过滤（服务端过滤）；null/空白表示不过滤
     * @param page       页码（1-based）
     * @param pageSize   每页条数
     * @return 切片分页视图（恒非 {@code null}）
     */
    public KbDocumentChunksVO listDocumentChunks(
            Long libraryId, Long documentId, Long userId,
            String keywords, int page, int pageSize) {
        requireLibrary(libraryId);
        requireDocumentRead(libraryId, userId);
        KbDocument doc = require(documentId);
        if (doc.getEngineDocumentRef() == null || doc.getEngineDocumentRef().isBlank()) {
            return emptyChunks("该文档尚未同步到引擎，无法查看切分效果", page, pageSize);
        }
        String status = doc.getParseStatus();
        if (ParseStatus.PENDING.code().equals(status) || ParseStatus.PARSING.code().equals(status)) {
            return emptyChunks("文档解析中，暂无切片数据", page, pageSize);
        }
        if (ParseStatus.FAILED.code().equals(status)) {
            return emptyChunks("文档解析失败，暂无切片数据", page, pageSize);
        }
        DocumentChunkPageView pageView;
        try {
            pageView = enginePort.listDocumentChunks(
                    new ChunkQuery(libraryId, documentId, keywords, page, pageSize));
        } catch (Exception e) {
            log.warn("查询文档切片失败 libraryId={} documentId={}: {}",
                    libraryId, documentId, e.getMessage());
            return emptyChunks("引擎暂不可达，请稍后重试", page, pageSize);
        }
        if (pageView == null) {
            return emptyChunks(null, page, pageSize);
        }
        return toChunksVo(doc, libraryRepository.findById(libraryId).orElse(null), pageView);
    }

    /**
     * 拉取分片关联的版面截图（「查看切分」卡片配图）。
     *
     * <p>权限与 listChunks 同口径（库读 ACL）；{@code imageId} 必须属于本库引擎
     * dataset（前缀 = {@code engineLibraryRef}-），防止越权读其他库图片。
     *
     * @param libraryId  知识库 id
     * @param documentId 文档 id（用于归属校验）
     * @param userId     当前用户
     * @param imageId    引擎 {@code image_id}
     * @return JPEG 字节
     */
    public byte[] getChunkImage(Long libraryId, Long documentId, Long userId, String imageId) {
        requireLibrary(libraryId);
        requireDocumentRead(libraryId, userId);
        KbDocument doc = require(documentId);
        if (!Objects.equals(doc.getLibraryId(), libraryId)) {
            throw new KbBusinessException(KbResultCode.KB_DOC_NOT_FOUND);
        }
        KbLibrary lib = requireLibrary(libraryId);
        String datasetId = lib.getEngineLibraryRef();
        if (datasetId == null || datasetId.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "知识库尚未同步到引擎");
        }
        if (imageId == null || imageId.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "imageId 不能为空");
        }
        String id = imageId.trim();
        String expectedPrefix = datasetId + "-";
        if (!id.startsWith(expectedPrefix) || id.length() <= expectedPrefix.length()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "imageId 不属于本知识库");
        }
        try {
            return enginePort.fetchChunkImage(id);
        } catch (UnsupportedOperationException ex) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "当前引擎不支持分片图片");
        }
    }

    /**
     * 引擎切片页 → 响应 VO（全局连续序号 + 当前页字符统计 + 来源判定 + 双口径统计）。
     */
    private KbDocumentChunksVO toChunksVo(KbDocument doc, KbLibrary lib, DocumentChunkPageView pageView) {
        List<KbDocumentChunkVO> chunks = new ArrayList<>();
        int currentPageCharacterCount = 0;
        int base = (pageView.page() - 1) * pageView.pageSize();
        List<DocumentChunkView> views = pageView.chunks() == null ? List.of() : pageView.chunks();
        for (int i = 0; i < views.size(); i++) {
            DocumentChunkView v = views.get(i);
            if (v == null) {
                continue;
            }
            String content = v.content() == null ? "" : v.content();
            int charCount = content.length();
            currentPageCharacterCount += charCount;
            chunks.add(new KbDocumentChunkVO(
                    base + i + 1L, content, v.pageNo(), charCount, v.importantKeywords(),
                    v.imageId()));
        }
        KbDocumentChunkStatsVO stats = buildStats(
                doc, lib, pageView.total(), currentPageCharacterCount,
                pageView.chunkCount(), pageView.tokenCount());
        return new KbDocumentChunksVO(
                stats, chunks, pageView.total(), pageView.page(), pageView.pageSize(), null);
    }

    /**
     * 统计条组装：切片配置以 MIS 本地为准（来源判定 FILE_OVERRIDE / LIBRARY）。
     *
     * <p>七字段一律输出<b>生效值</b>，由 {@link DocumentChunkConfigResolver} 唯一收口
     * （文件级 ?? 库级 ?? 全局默认）：任一文件级字段非空 → {@code FILE_OVERRIDE}，
     * 未指定字段回落库级生效值/默认；文件级全空 → {@code LIBRARY}，展示库级有效值，
     * 缺失时兜底 {@code RagSettings.defaults()}。
     *
     * <p>双口径（设计 §7 共享知识 #3）：{@code chunkCount}（全量，引擎 doc.chunk_count，
     * 不受关键字过滤影响）与 {@code totalChunks}（过滤后命中数）分别下发；
     * {@code tokenCount} 为引擎 doc.token_count（可空）；{@code totalCharacterCount}
     * 为当前页字符合计（非全文档）。
     */
    private KbDocumentChunkStatsVO buildStats(
            KbDocument doc, KbLibrary lib, int total, int totalCharacterCount,
            Integer chunkCount, Integer tokenCount) {
        DocumentChunkConfig fileConfig = new DocumentChunkConfig(
                doc.getChunkMethod(), doc.getChunkTokenNum(), doc.getSeparator(),
                doc.getPageIndex(), doc.getImageTableContextWindow(),
                doc.getAutoKeywords(), doc.getAutoQuestions());
        RagSettings libSettings = lib == null ? null : KbJson.readSettings(lib.getRagSettingsJson());
        EffectiveChunkConfig effective = chunkConfigResolver.resolve(fileConfig, libSettings);
        return new KbDocumentChunkStatsVO(
                total, totalCharacterCount, effective.chunkMethod(), effective.chunkTokenNum(),
                effective.separator(), effective.source(),
                chunkCount, tokenCount, effective.pageIndex(), effective.imageTableContextWindow(),
                effective.autoKeywords(), effective.autoQuestions());
    }

    /** 空态响应（解析中/失败/未同步/引擎不可达等）；双口径与 token 均置 null。 */
    private static KbDocumentChunksVO emptyChunks(String hint, int page, int pageSize) {
        KbDocumentChunkStatsVO stats =
                new KbDocumentChunkStatsVO(0, 0, null, null, null, null, null, null,
                        null, null, null, null);
        return new KbDocumentChunksVO(
                stats, List.of(), 0, Math.max(page, 1), Math.max(pageSize, 1), hint);
    }

    /**
     * 上传文档（D-01；kb_settings_model_chunk 支持可选文件级切片参数）。
     *
     * @param libraryId   知识库 id
     * @param file        上传文件
     * @param chunkConfig 文件级切片配置；null/全空 = 继承库级（行为与旧版完全一致）
     * @param userId      当前用户 id（管辖校验；BFF 透传，可为 null → 拒绝）
     * @return 上传结果（id + 解析状态）
     */
    @Transactional
    public KbDocumentUploadResponse upload(
            Long libraryId, MultipartFile file, DocumentChunkConfig chunkConfig, Long userId) {
        KbLibrary lib = requireLibrary(libraryId);
        requireLibraryManage(libraryId, userId);
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "文件不能为空");
        }
        validateChunkConfig(chunkConfig);
        byte[] content;
        try {
            content = file.getBytes();
        } catch (IOException e) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "读取文件失败");
        }
        DocumentUploadInput input = new DocumentUploadInput(
                file.getOriginalFilename(), file.getContentType(), file.getSize(), content, chunkConfig);
        EngineDocumentRef ref = enginePort.uploadDocument(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()), input);
        Instant now = Instant.now();
        String parseStatus = "ragflow".equals(lib.getEngineType())
                ? ParseStatus.PARSING.code()
                : ParseStatus.SUCCESS.code();
        KbDocument entity = new KbDocument();
        entity.setId(IdGenerator.nextId());
        entity.setLibraryId(libraryId);
        entity.setTitle(file.getOriginalFilename());
        entity.setEngineDocumentRef(ref.nativeId());
        entity.setVersion(1);
        entity.setParseStatus(parseStatus);
        entity.setEnabled(1);
        entity.setSize(file.getSize());
        entity.setFormat(deriveFormat(file.getOriginalFilename()));
        entity.setChunkMethod(normalizeChunkMethod(chunkConfig == null ? null : chunkConfig.chunkMethod()));
        entity.setChunkTokenNum(chunkConfig == null ? null : chunkConfig.chunkTokenNum());
        entity.setSeparator(chunkConfig == null ? null : chunkConfig.separator());
        // T4：4 个解析器设置字段（pageIndex / imageTableContextWindow / autoKeywords /
        // autoQuestions）。全 null = 继承库级（快照语义，T5）——不做列复制，引擎上传时
        // 已把 dataset parser_config 快照进 document，MIS 列保持 null 即表示「未覆盖」。
        entity.setPageIndex(chunkConfig == null ? null : chunkConfig.pageIndex());
        entity.setImageTableContextWindow(
                chunkConfig == null ? null : chunkConfig.imageTableContextWindow());
        entity.setAutoKeywords(chunkConfig == null ? null : chunkConfig.autoKeywords());
        entity.setAutoQuestions(chunkConfig == null ? null : chunkConfig.autoQuestions());
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        KbDocument saved = documentRepository.save(entity);
        log.info("文档已上传 id={} libraryId={} engineRef={} parseStatus={} chunkMethod={} chunkTokenNum={} "
                        + "pageIndex={} imageTableContextWindow={} autoKeywords={} autoQuestions={}",
                saved.getId(), libraryId, ref.nativeId(), parseStatus,
                entity.getChunkMethod(), entity.getChunkTokenNum(),
                entity.getPageIndex(), entity.getImageTableContextWindow(),
                entity.getAutoKeywords(), entity.getAutoQuestions());
        return new KbDocumentUploadResponse(saved.getId(), saved.getParseStatus());
    }

    /**
     * 更新文档级切片配置（kb_settings_model_chunk，R-P0-08；改参触发重解析）。
     *
     * <p><b>语义：</b>config 全 null = 清空文件级覆盖（继承库级，快照式下发库级当前有效值）；
     * 任一字段非空 = 文件指定。校验常量统一引用 {@link DocumentChunkConfig}（单一事实源）。
     *
     * <p><b>错误处理：</b>改参是用户主动动作，引擎失败不吞——置 {@code FAILED} 并抛异常
     * （错误处理分野，§7.5-6），前端据此提示「解析期间该文档暂不参与检索」。
     *
     * <p><b>保存口径（T5 快照）：</b>成功路径仅落库一次（引擎成功后置 {@code PARSING}）；
     * 引擎失败置 {@code FAILED} 落库后抛异常，由事务回滚兜底。
     *
     * @param id     文档 id
     * @param config 文件级切片配置；全 null = 清空覆盖
     */
    @Transactional
    public void updateChunkConfig(Long id, DocumentChunkConfig config) {
        KbDocument entity = require(id);
        validateChunkConfig(config);
        entity.setChunkMethod(normalizeChunkMethod(config == null ? null : config.chunkMethod()));
        entity.setChunkTokenNum(config == null ? null : config.chunkTokenNum());
        entity.setSeparator(config == null ? null : config.separator());
        // T4：4 个解析器设置字段。config 全 null = 清空文件级覆盖（列置 null → 继承库级）。
        entity.setPageIndex(config == null ? null : config.pageIndex());
        entity.setImageTableContextWindow(
                config == null ? null : config.imageTableContextWindow());
        entity.setAutoKeywords(config == null ? null : config.autoKeywords());
        entity.setAutoQuestions(config == null ? null : config.autoQuestions());
        entity.setUpdatedAt(Instant.now());

        KbLibrary lib = libraryRepository.findById(entity.getLibraryId()).orElse(null);
        if (lib == null || lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()
                || entity.getEngineDocumentRef() == null || entity.getEngineDocumentRef().isBlank()) {
            documentRepository.save(entity);
            log.info("文档无引擎映射，切片配置仅本地生效 id={} libraryId={}", id, entity.getLibraryId());
            return;
        }
        // T5 快照继承：config 全 null（或全空）→ 经 Resolver 唯一收口解析库级有效值，
        // 构造 7 参 DocumentChunkConfig 快照下发，绝不透传 null（auto 双键随 PUT 恒下发，
        // pageIndex / imageTableContextWindow 由客户端按白名单处理）。
        DocumentChunkConfig effective = resolveEffectiveChunkConfig(lib, config);
        try {
            enginePort.updateDocumentChunkConfig(
                    new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()),
                    new EngineDocumentRef(lib.getEngineType(), entity.getEngineDocumentRef()),
                    effective);
            entity.setParseStatus(ParseStatus.PARSING.code());
            // KE-04 口径：重新触发解析时清空上次失败原因（成功/重试时清空）
            entity.setParseError(null);
            entity.setUpdatedAt(Instant.now());
            documentRepository.save(entity);
            log.info("文档切片配置已更新并触发重解析 id={} config={} effective={}", id, config, effective);
        } catch (Exception e) {
            entity.setParseStatus(ParseStatus.FAILED.code());
            entity.setUpdatedAt(Instant.now());
            documentRepository.save(entity);
            log.error("文档切片配置更新失败，已置 FAILED id={}: {}", id, e.getMessage(), e);
            throw new KbBusinessException(KbResultCode.KB_DOC_NOT_FOUND, "更新切片配置失败：" + e.getMessage());
        }
    }

    /**
     * 计算下发引擎的文档级切片配置（T5 快照语义）。
     *
     * <p>文件级有覆盖 → 原样透传（引擎侧白名单/默认补齐由客户端负责）；
     * 文件级全空（清覆盖）→ 走 {@link DocumentChunkConfigResolver} 唯一收口（文件 ?? 库 ??
     * 默认）生成库级有效值快照，恒非 {@code null}。
     *
     * @param lib    知识库实体（读库级设置），调用方保证非 {@code null}
     * @param config 用户提交的文件级配置，可为 {@code null}
     * @return 下发引擎的配置，恒非 {@code null}
     */
    private DocumentChunkConfig resolveEffectiveChunkConfig(KbLibrary lib, DocumentChunkConfig config) {
        if (config != null && config.hasAnyOverride()) {
            return config;
        }
        RagSettings settings = KbJson.readSettings(lib.getRagSettingsJson());
        return chunkConfigResolver.resolve(null, settings).toDocumentChunkConfig();
    }

    @Transactional
    public void setEnabled(Long id, boolean enabled, Long userId) {
        KbDocument entity = require(id);
        requireLibraryManage(entity.getLibraryId(), userId);
        entity.setEnabled(enabled ? 1 : 0);
        entity.setUpdatedAt(Instant.now());
        documentRepository.save(entity);
        syncEngineDocument(entity, lib -> enginePort.setDocumentEnabled(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()),
                new EngineDocumentRef(lib.getEngineType(), entity.getEngineDocumentRef()),
                enabled));
    }

    @Transactional
    public void delete(Long id, Long userId) {
        KbDocument entity = require(id);
        requireLibraryManage(entity.getLibraryId(), userId);
        // 引擎侧删成功才动本地——绝不能 catch 后继续（否则 MIS 已删、RAGFlow 孤儿仍在）
        syncEngineDocument(entity, lib -> {
            try {
                enginePort.deleteDocument(
                        new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()),
                        new EngineDocumentRef(lib.getEngineType(), entity.getEngineDocumentRef()));
            } catch (Exception e) {
                log.error("引擎侧删除文档失败，本地不做任何变更 id={} engineDocRef={}: {}",
                        entity.getId(), entity.getEngineDocumentRef(), e.getMessage(), e);
                throw new KbBusinessException(
                        KbResultCode.KB_ENGINE_DELETE_FAILED,
                        KbResultCode.KB_ENGINE_DELETE_FAILED.getMessage() + "：" + e.getMessage());
            }
        });
        documentRepository.delete(entity);
    }

    /**
     * 重新解析文档（T10，WA-09 / WA-10）。
     *
     * <p>P0 的实现有三个坑，本次一并补齐：
     * <ol>
     *   <li><b>引擎映射缺失时静默成功</b>——{@code engineDocumentRef} 为 null 时
     *       {@code syncEngineDocument} 直接 return，但状态已被改成 {@code PARSING}，
     *       文档从此永远卡在「解析中」。现改为前置校验并抛 {@code KB_DOC_NOT_FOUND}；</li>
     *   <li><b>无幂等</b>——用户连点三次就打三次引擎，队列里堆三份重复任务。
     *       现改为已处于 {@code PARSING} 直接短路返回；</li>
     *   <li><b>失败无痕</b>——引擎抛异常时状态停在 {@code PARSING}，前端看不出失败。
     *       现改为置 {@code FAILED} 并把原因随异常抛给前端（§7.5-6 错误处理分野：
     *       用户主动触发的动作必须有反馈，不能像 RAG 设置同步那样吞掉）。</li>
     * </ol>
     *
     * <p><b>关于失败原因的持久化：</b>{@code kb_document} 表当前<b>没有</b>
     * {@code parse_error} 列（见 {@code V12__kb_schema.sql}），新增列属 DDL 变更、
     * 不在 Wave A 范围内。因此失败原因通过「抛出的业务异常 message + ERROR 日志」
     * 交付给前端与排障，状态列如实置 {@code FAILED}。若后续要在文档列表上常驻展示
     * 失败原因，需补一条迁移加列。
     *
     * @param id 文档 id
     * @param userId 当前用户 id（管辖校验；BFF 透传，可为 null → 拒绝）
     * @throws KbBusinessException 文档不存在、无引擎映射、管辖外、或引擎调用失败
     */
    @Transactional
    public void reparse(Long id, Long userId) {
        KbDocument entity = require(id);
        requireLibraryManage(entity.getLibraryId(), userId);
        if (entity.getEngineDocumentRef() == null || entity.getEngineDocumentRef().isBlank()) {
            log.warn("文档无引擎映射，无法重解析 id={} libraryId={}", id, entity.getLibraryId());
            throw new KbBusinessException(KbResultCode.KB_DOC_NOT_FOUND, "该文档尚未同步到引擎，无法重新解析");
        }
        KbLibrary lib = libraryRepository.findById(entity.getLibraryId()).orElse(null);
        if (lib == null || lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            log.warn("知识库无引擎映射，无法重解析 id={} libraryId={}", id, entity.getLibraryId());
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND, "该知识库尚未同步到引擎，无法重新解析");
        }

        // 先向引擎收敛一次，避免本地卡在 parsing、引擎已 DONE 时无法重解析/也无法显示成功
        syncOpenParseStatuses(lib, List.of(entity));

        // 幂等短路：引擎侧仍在跑才短路；本地 stale parsing 已在上方被纠正
        if (ParseStatus.PARSING.code().equals(entity.getParseStatus())) {
            log.info("文档已在解析中，重解析请求幂等短路 id={}", id);
            return;
        }

        entity.setParseStatus(ParseStatus.PARSING.code());
        // KE-04 口径：重新触发解析时清空上次失败原因（成功/重试时清空）
        entity.setParseError(null);
        entity.setUpdatedAt(Instant.now());
        documentRepository.save(entity);

        try {
            enginePort.reparseDocument(
                    new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()),
                    new EngineDocumentRef(lib.getEngineType(), entity.getEngineDocumentRef()));
            log.info("已触发文档重解析 id={} libraryId={}", id, entity.getLibraryId());
        } catch (Exception e) {
            entity.setParseStatus(ParseStatus.FAILED.code());
            entity.setUpdatedAt(Instant.now());
            documentRepository.save(entity);
            log.error("文档重解析失败，已置为 FAILED id={} libraryId={}: {}",
                    id, entity.getLibraryId(), e.getMessage(), e);
            throw new KbBusinessException(
                    KbResultCode.KB_DOC_NOT_FOUND, "重新解析失败：" + e.getMessage());
        }
    }

    /**
     * 库级一键全部重解析（P1-1：换嵌入模型后全量重解析恢复检索；KE-05 扩展 onlyFailed）。
     *
     * <p><b>同步/异步取舍：</b>RAGFlow 的 {@code POST /chunks}（{@code RagflowClient.parseDocuments}）
     * 是<b>同步 HTTP 返回、异步排队执行</b>——提交后引擎侧 {@code run}/{@code progress}
     * 异步变化。因此库级实现=串行循环逐文档提交即可，单次调用耗时≈文档数×单次提交耗时，
     * 解析本身由引擎队列异步完成，列表页靠 {@link #list} 的解析状态回写收敛；
     * 不需要分批/异步编排（P1-1 联调实测：全量 POST /chunks 后检索即恢复）。
     *
     * <p><b>失败容忍：</b>单文档失败<b>不中断全部</b>——记录失败数 + 失败文档明细后继续处理
     * 后续文档。无引擎映射的文档视为失败（原因=尚未同步到引擎，与单文档 {@link #reparse}
     * 语义一致）。
     *
     * <p><b>幂等/防重入：</b>沿用单文档 {@link #reparse} 的 {@code PARSING} 短路语义——
     * 引擎侧仍在跑的文档跳过并计入 {@code skipped}，不重复入队；不做库级锁
     * （重复触发至多重复提交非解析中文档，RAGFlow 解析队列本身幂等，最小实现）。
     *
     * <p><b>{@code onlyFailed} 语义（Q8 / R8）：</b>仅重试 {@code parse_status=failed} 的文档。
     * 本地 stale failed（引擎侧实际已 DONE）先经 {@link #syncOpenParseStatuses} 收敛一次
     * 再按 failed 过滤——收敛后已恢复成功的文档不再触发，避免「重复提交已成功的文档」。
     *
     * @param libraryId  知识库 id
     * @param onlyFailed 仅重试 failed 文档；{@code false} = 全量
     * @param userId     当前用户 id（管辖校验；BFF 透传，可为 null → 拒绝）
     * @return 批量结果（成功/失败/跳过/失败明细）；空库返回 success=0 的明确结果
     * @throws KbBusinessException 知识库不存在、管辖外、或库内有文档但库无引擎映射
     */
    @Transactional
    public KbReparseAllResult reparseAll(Long libraryId, boolean onlyFailed, Long userId) {
        KbLibrary lib = requireLibrary(libraryId);
        requireLibraryManage(libraryId, userId);
        List<KbDocument> docs = documentRepository.findByLibraryIdOrderByCreatedAtDesc(libraryId);
        if (docs.isEmpty()) {
            log.info("库级重解析：库内无文档 libraryId={}", libraryId);
            return new KbReparseAllResult(libraryId, 0, 0, 0, 0, List.of());
        }
        if (lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            log.warn("知识库无引擎映射，无法库级重解析 libraryId={}", libraryId);
            throw new KbBusinessException(
                    KbResultCode.KB_LIBRARY_NOT_FOUND, "该知识库尚未同步到引擎，无法重新解析");
        }

        // 批量收敛一次引擎解析状态（纠正本地 stale parsing/failed），避免把「引擎已 DONE、
        // 本地仍 parsing/failed」的文档当解析中跳过、或对已成功的文档重复触发（R8）。
        syncOpenParseStatuses(lib, docs);

        EngineLibraryRef libRef = new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef());
        int success = 0;
        int failed = 0;
        int skipped = 0;
        List<KbReparseAllResult.FailedDocument> failedDocs = new ArrayList<>();
        Instant now = Instant.now();
        for (KbDocument doc : docs) {
            if (doc.getEngineDocumentRef() == null || doc.getEngineDocumentRef().isBlank()) {
                failed++;
                failedDocs.add(new KbReparseAllResult.FailedDocument(
                        doc.getId(), doc.getTitle(), "该文档尚未同步到引擎，无法重新解析"));
                continue;
            }
            if (ParseStatus.PARSING.code().equals(doc.getParseStatus())) {
                skipped++;
                continue;
            }
            // onlyFailed：收敛后仍 failed 的文档才触发；其余跳过（Q8）
            if (onlyFailed && !ParseStatus.FAILED.code().equals(doc.getParseStatus())) {
                skipped++;
                continue;
            }
            doc.setParseStatus(ParseStatus.PARSING.code());
            // KE-04 口径：重新触发解析时清空上次失败原因（成功/重试时清空）
            doc.setParseError(null);
            doc.setUpdatedAt(now);
            documentRepository.save(doc);
            try {
                enginePort.reparseDocument(
                        libRef,
                        new EngineDocumentRef(lib.getEngineType(), doc.getEngineDocumentRef()));
                success++;
            } catch (Exception e) {
                doc.setParseStatus(ParseStatus.FAILED.code());
                doc.setUpdatedAt(now);
                documentRepository.save(doc);
                failed++;
                failedDocs.add(new KbReparseAllResult.FailedDocument(
                        doc.getId(), doc.getTitle(), String.valueOf(e.getMessage())));
                log.error("库级重解析：文档触发失败，已置 FAILED id={} libraryId={}: {}",
                        doc.getId(), libraryId, e.getMessage(), e);
            }
        }
        log.info("库级重解析完成 libraryId={} onlyFailed={} total={} success={} failed={} skipped={}",
                libraryId, onlyFailed, docs.size(), success, failed, skipped);
        return new KbReparseAllResult(
                libraryId, docs.size(), success, failed, skipped, List.copyOf(failedDocs));
    }

    /**
     * 对 pending/parsing 文档拉取引擎状态并落库（KE-03/KE-04：进度 + 失败原因一并回写）；
     * 引擎不可达时静默保留原值（列表仍可展示）。
     */
    private void syncOpenParseStatuses(KbLibrary lib, List<KbDocument> docs) {
        if (lib == null || lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()
                || docs == null || docs.isEmpty()) {
            return;
        }
        List<KbDocument> open = new ArrayList<>();
        List<String> nativeIds = new ArrayList<>();
        for (KbDocument doc : docs) {
            if (doc == null || doc.getEngineDocumentRef() == null || doc.getEngineDocumentRef().isBlank()) {
                continue;
            }
            String status = doc.getParseStatus();
            if (ParseStatus.PENDING.code().equals(status) || ParseStatus.PARSING.code().equals(status)) {
                open.add(doc);
                nativeIds.add(doc.getEngineDocumentRef());
            }
        }
        if (nativeIds.isEmpty()) {
            return;
        }
        Map<String, ParseStatusSnapshot> remote;
        try {
            remote = enginePort.queryDocumentParseStatuses(
                    new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()), nativeIds);
        } catch (Exception e) {
            log.warn("批量查询引擎文档解析状态失败 libraryId={}: {}", lib.getId(), e.getMessage());
            return;
        }
        if (remote == null || remote.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        for (KbDocument doc : open) {
            ParseStatusSnapshot snapshot = remote.get(doc.getEngineDocumentRef());
            if (snapshot == null || !snapshot.hasValidStatus()) {
                continue;
            }
            String next = snapshot.status();
            Integer nextProgress = snapshot.progress();
            // KE-04 口径：success 清空 error；其余（failed）落 progress_msg 摘要（≤500 已在快照截断）
            String nextError = ParseStatus.SUCCESS.code().equals(next) ? null : snapshot.error();
            if (Objects.equals(next, doc.getParseStatus())
                    && Objects.equals(nextProgress, doc.getParseProgress())
                    && Objects.equals(nextError, doc.getParseError())) {
                continue;
            }
            log.info("回写文档解析状态 id={} {} -> {} progress={} error={} (engineRef={})",
                    doc.getId(), doc.getParseStatus(), next, nextProgress, nextError,
                    doc.getEngineDocumentRef());
            doc.setParseStatus(next);
            doc.setParseProgress(nextProgress);
            doc.setParseError(nextError);
            doc.setUpdatedAt(now);
            documentRepository.save(doc);
        }
    }

    private void syncEngineDocument(KbDocument entity, java.util.function.Consumer<KbLibrary> action) {
        if (entity.getEngineDocumentRef() == null) {
            return;
        }
        KbLibrary lib = libraryRepository.findById(entity.getLibraryId()).orElse(null);
        if (lib != null && lib.getEngineLibraryRef() != null) {
            action.accept(lib);
        }
    }

    private KbDocument require(Long id) {
        return documentRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_DOC_NOT_FOUND));
    }

    /**
     * 文档写操作管辖校验（知识库域一期，双闸门之二：权限码由 BFF 拦截，管辖在此判定）。
     *
     * <p>不通过抛 {@code KB_CATEGORY_NOT_MANAGEABLE(40311)}——设计时序图 5.2 明确
     * 「越权路径：hasLibraryManage=false → 抛 40311」。
     */
    private void requireLibraryManage(Long libraryId, Long userId) {
        if (!libraryService.hasLibraryManage(userId, libraryId)) {
            throw new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE);
        }
    }

    /**
     * 文档读操作权限校验（「查看切分效果」双闸门之二：权限码由 BFF 拦截，ACL 读权限在此判定）。
     *
     * <p>public 库对 {@code read} 天然放行；私有库需用户/角色/部门任一 ACL 命中；
     * 不通过抛 {@code KB_NO_READ_PERMISSION(40310)}。
     */
    private void requireDocumentRead(Long libraryId, Long userId) {
        if (!visibilityService.hasPermission(userId, libraryId, AclAction.READ.code())) {
            throw new KbBusinessException(KbResultCode.KB_NO_READ_PERMISSION);
        }
    }

    private KbLibrary requireLibrary(Long libraryId) {
        return libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private KbDocumentVO toVo(KbDocument e) {
        return new KbDocumentVO(
                e.getId(), e.getLibraryId(), e.getTitle(), e.getVersion(), e.getParseStatus(),
                e.getEnabled(), e.getSize(), e.getFormat(), e.getCreatedAt(), e.getUpdatedAt(),
                e.getChunkMethod(), e.getChunkTokenNum(), e.getSeparator(),
                e.getParseProgress(), e.getParseError(),
                e.getPageIndex(), e.getImageTableContextWindow(),
                e.getAutoKeywords(), e.getAutoQuestions());
    }

    private static String deriveFormat(String filename) {
        if (filename == null) {
            return null;
        }
        int idx = filename.lastIndexOf('.');
        return idx >= 0 ? filename.substring(idx + 1).toLowerCase() : null;
    }

    /**
     * 文件级切片配置校验（常量唯一事实源 {@link DocumentChunkConfig}，设计 §3.2.2）。
     *
     * <p>null/全空 = 继承库级，直接放行；越界/非法一律拒绝（用户主动动作不静默截断）。
     *
     * @param config 文件级切片配置
     */
    private static void validateChunkConfig(DocumentChunkConfig config) {
        if (config == null) {
            return;
        }
        if (config.chunkMethod() != null && !config.chunkMethod().isBlank()
                && !DocumentChunkConfig.isValidChunkMethod(config.chunkMethod())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "非法的切片方法：" + config.chunkMethod());
        }
        if (!DocumentChunkConfig.isValidTokenNum(config.chunkTokenNum())) {
            throw new BusinessException(
                    ResultCode.VALIDATION_ERROR,
                    "切片 token 数需在 [" + DocumentChunkConfig.MIN_TOKEN_NUM + ", "
                            + DocumentChunkConfig.MAX_TOKEN_NUM + "] 区间");
        }
        // T4：解析器设置字段校验（常量与 RagSettings 同源；越界直接拒，不做静默截断）。
        if (!DocumentChunkConfig.isValidImageTableContextWindow(config.imageTableContextWindow())) {
            throw new BusinessException(
                    ResultCode.VALIDATION_ERROR,
                    "图像/表格上下文窗口需在 [" + RagSettings.MIN_IMAGE_TABLE_CONTEXT_WINDOW + ", "
                            + RagSettings.MAX_IMAGE_TABLE_CONTEXT_WINDOW + "] 区间");
        }
        if (!DocumentChunkConfig.isValidAutoKeywords(config.autoKeywords())) {
            throw new BusinessException(
                    ResultCode.VALIDATION_ERROR,
                    "自动关键字数量需在 [0, " + RagSettings.MAX_AUTO_KEYWORDS + "] 区间（0 = 关闭）");
        }
        if (!DocumentChunkConfig.isValidAutoQuestions(config.autoQuestions())) {
            throw new BusinessException(
                    ResultCode.VALIDATION_ERROR,
                    "自动问题数量需在 [0, " + RagSettings.MAX_AUTO_QUESTIONS + "] 区间（0 = 关闭）");
        }
        // pageIndex 是布尔开关，无区间可言，无需额外校验。
    }

    /** 切片方法归一化（小写去空白）；null/空白统一为 null（继承库级）。 */
    private static String normalizeChunkMethod(String method) {
        if (method == null || method.isBlank()) {
            return null;
        }
        return method.trim().toLowerCase();
    }
}

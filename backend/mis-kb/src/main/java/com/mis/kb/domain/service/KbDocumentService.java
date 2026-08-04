package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbDocumentUploadResponse;
import com.mis.kb.api.dto.KbDocumentVO;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.ParseStatus;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.util.List;

/** 文档服务（D-01~10）。 */
@Service
public class KbDocumentService {

    private static final Logger log = LoggerFactory.getLogger(KbDocumentService.class);

    private final KbDocumentRepository documentRepository;
    private final KbLibraryRepository libraryRepository;
    private final KnowledgeEnginePort enginePort;

    public KbDocumentService(
            KbDocumentRepository documentRepository,
            KbLibraryRepository libraryRepository,
            KnowledgeEnginePort enginePort) {
        this.documentRepository = documentRepository;
        this.libraryRepository = libraryRepository;
        this.enginePort = enginePort;
    }

    @Transactional(readOnly = true)
    public List<KbDocumentVO> list(Long libraryId) {
        requireLibrary(libraryId);
        return documentRepository.findByLibraryIdOrderByCreatedAtDesc(libraryId).stream().map(this::toVo).toList();
    }

    @Transactional(readOnly = true)
    public KbDocumentVO get(Long id) {
        return toVo(require(id));
    }

    @Transactional
    public KbDocumentUploadResponse upload(Long libraryId, MultipartFile file) {
        KbLibrary lib = requireLibrary(libraryId);
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "文件不能为空");
        }
        byte[] content;
        try {
            content = file.getBytes();
        } catch (IOException e) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "读取文件失败");
        }
        DocumentUploadInput input = new DocumentUploadInput(
                file.getOriginalFilename(), file.getContentType(), file.getSize(), content);
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
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        KbDocument saved = documentRepository.save(entity);
        log.info("文档已上传 id={} libraryId={} engineRef={} parseStatus={}",
                saved.getId(), libraryId, ref.nativeId(), parseStatus);
        return new KbDocumentUploadResponse(saved.getId(), saved.getParseStatus());
    }

    @Transactional
    public void setEnabled(Long id, boolean enabled) {
        KbDocument entity = require(id);
        entity.setEnabled(enabled ? 1 : 0);
        entity.setUpdatedAt(Instant.now());
        documentRepository.save(entity);
        syncEngineDocument(entity, lib -> enginePort.setDocumentEnabled(
                new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()),
                new EngineDocumentRef(lib.getEngineType(), entity.getEngineDocumentRef()),
                enabled));
    }

    @Transactional
    public void delete(Long id) {
        KbDocument entity = require(id);
        syncEngineDocument(entity, lib -> {
            try {
                enginePort.deleteDocument(
                        new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()),
                        new EngineDocumentRef(lib.getEngineType(), entity.getEngineDocumentRef()));
            } catch (Exception e) {
                log.warn("删除引擎文档失败 id={}: {}", entity.getId(), e.getMessage());
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
     * @throws KbBusinessException 文档不存在、无引擎映射、或引擎调用失败
     */
    @Transactional
    public void reparse(Long id) {
        KbDocument entity = require(id);

        // 幂等短路：解析中重复触发不再打引擎
        if (ParseStatus.PARSING.code().equals(entity.getParseStatus())) {
            log.info("文档已在解析中，重解析请求幂等短路 id={}", id);
            return;
        }
        if (entity.getEngineDocumentRef() == null || entity.getEngineDocumentRef().isBlank()) {
            log.warn("文档无引擎映射，无法重解析 id={} libraryId={}", id, entity.getLibraryId());
            throw new KbBusinessException(KbResultCode.KB_DOC_NOT_FOUND, "该文档尚未同步到引擎，无法重新解析");
        }
        KbLibrary lib = libraryRepository.findById(entity.getLibraryId()).orElse(null);
        if (lib == null || lib.getEngineLibraryRef() == null || lib.getEngineLibraryRef().isBlank()) {
            log.warn("知识库无引擎映射，无法重解析 id={} libraryId={}", id, entity.getLibraryId());
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND, "该知识库尚未同步到引擎，无法重新解析");
        }

        entity.setParseStatus(ParseStatus.PARSING.code());
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

    private KbLibrary requireLibrary(Long libraryId) {
        return libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private KbDocumentVO toVo(KbDocument e) {
        return new KbDocumentVO(
                e.getId(), e.getLibraryId(), e.getTitle(), e.getVersion(), e.getParseStatus(),
                e.getEnabled(), e.getSize(), e.getFormat(), e.getCreatedAt(), e.getUpdatedAt());
    }

    private static String deriveFormat(String filename) {
        if (filename == null) {
            return null;
        }
        int idx = filename.lastIndexOf('.');
        return idx >= 0 ? filename.substring(idx + 1).toLowerCase() : null;
    }
}

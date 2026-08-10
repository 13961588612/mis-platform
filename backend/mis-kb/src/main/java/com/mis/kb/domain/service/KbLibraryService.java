package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbLibraryCreateRequest;
import com.mis.kb.api.dto.KbLibraryUpdateRequest;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.Secrecy;
import com.mis.kb.domain.repository.KbAclRepository;
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
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

/** 知识库服务（L-01~08）。 */
@Service
public class KbLibraryService {

    private static final Logger log = LoggerFactory.getLogger(KbLibraryService.class);

    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;
    private final KbAclRepository aclRepository;
    private final KnowledgeEnginePort enginePort;
    private final NodeAdminResolver nodeAdminResolver;

    public KbLibraryService(
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository,
            KbAclRepository aclRepository,
            KnowledgeEnginePort enginePort,
            NodeAdminResolver nodeAdminResolver) {
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
        this.aclRepository = aclRepository;
        this.enginePort = enginePort;
        this.nodeAdminResolver = nodeAdminResolver;
    }

    /**
     * 库级管理合成（知识库域一期，Q9）：{@code 节点管辖 ∨ kb_acl.manage}。
     *
     * <p>文档写操作双闸门（权限码 + 管辖）统一走这里；判定收口在
     * {@link NodeAdminResolver#hasLibraryManage}，禁止内联。
     */
    public boolean hasLibraryManage(Long userId, Long libraryId) {
        return nodeAdminResolver.hasLibraryManage(userId, libraryId);
    }

    @Transactional(readOnly = true)
    public List<KbLibraryVO> list(Long categoryId) {
        List<KbLibrary> entities = categoryId != null
                ? libraryRepository.findByCategoryIdOrderByNameAsc(categoryId)
                : libraryRepository.findAll();
        return entities.stream().map(this::toVo).toList();
    }

    @Transactional(readOnly = true)
    public KbLibraryVO get(Long id) {
        return toVo(require(id));
    }

    @Transactional
    public KbLibraryVO create(KbLibraryCreateRequest req) {
        if (!Secrecy.isValid(req.secrecy())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "密级非法（应为 public/internal/secret/confidential）");
        }
        String name = req.name().trim();
        if (libraryRepository.existsByNameAndCategoryId(name, req.categoryId())) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NAME_EXISTS);
        }
        EngineLibraryRef ref = enginePort.createLibrary(
                new CreateLibraryCmd(name, req.secrecy(), req.owner(), req.settings()));
        Instant now = Instant.now();
        KbLibrary entity = new KbLibrary();
        entity.setId(IdGenerator.nextId());
        entity.setCategoryId(req.categoryId());
        entity.setName(name);
        entity.setSecrecy(req.secrecy());
        entity.setStatus(LibraryStatus.ENABLED.code());
        entity.setOwner(req.owner());
        entity.setEngineType(ref.engineType());
        entity.setEngineLibraryRef(ref.nativeId());
        entity.setRagSettingsJson(KbJson.writeSettings(req.settings()));
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        log.info("知识库已创建 id={} engineType={} engineRef={}", entity.getId(), ref.engineType(), ref.nativeId());
        return toVo(libraryRepository.save(entity));
    }

    @Transactional
    public KbLibraryVO update(Long id, KbLibraryUpdateRequest req) {
        KbLibrary entity = require(id);
        if (!Secrecy.isValid(req.secrecy())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "密级非法（应为 public/internal/secret/confidential）");
        }
        String name = req.name().trim();
        if (!entity.getName().equals(name)
                && libraryRepository.existsByNameAndCategoryId(name, entity.getCategoryId())) {
            throw new KbBusinessException(KbResultCode.KB_LIBRARY_NAME_EXISTS);
        }
        entity.setName(name);
        entity.setSecrecy(req.secrecy());
        if (req.status() != null) {
            entity.setStatus(req.status());
        }
        String newJson = KbJson.writeSettings(req.settings());
        boolean settingsChanged = !Objects.equals(newJson, entity.getRagSettingsJson());
        entity.setRagSettingsJson(newJson);
        entity.setUpdatedAt(Instant.now());
        KbLibrary saved = libraryRepository.save(entity);
        if (settingsChanged && LibraryStatus.isEnabled(saved.getStatus()) && saved.getEngineLibraryRef() != null) {
            try {
                enginePort.updateLibrarySettings(
                        new EngineLibraryRef(saved.getEngineType(), saved.getEngineLibraryRef()), req.settings());
            } catch (Exception e) {
                log.warn("更新引擎知识库设置失败 id={}: {}", saved.getId(), e.getMessage());
            }
        }
        return toVo(saved);
    }

    @Transactional
    public void delete(Long id) {
        KbLibrary entity = require(id);
        if (entity.getEngineLibraryRef() != null) {
            try {
                enginePort.deleteLibrary(
                        new EngineLibraryRef(entity.getEngineType(), entity.getEngineLibraryRef()));
            } catch (Exception e) {
                log.warn("删除引擎知识库失败 id={}: {}", entity.getId(), e.getMessage());
            }
        }
        aclRepository.deleteByLibraryId(id);
        libraryRepository.delete(entity);
    }

    private KbLibrary require(Long id) {
        return libraryRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private KbLibraryVO toVo(KbLibrary e) {
        RagSettings settings = KbJson.readSettings(e.getRagSettingsJson());
        long docCount = documentRepository.countByLibraryId(e.getId());
        return new KbLibraryVO(
                e.getId(), e.getCategoryId(), e.getName(), e.getSecrecy(), e.getStatus(),
                e.getOwner(), e.getEngineType(), settings, docCount,
                e.getCreatedAt(), e.getUpdatedAt());
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}

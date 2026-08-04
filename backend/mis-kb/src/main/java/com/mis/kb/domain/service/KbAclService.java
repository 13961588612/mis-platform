package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbAclCreateRequest;
import com.mis.kb.api.dto.KbAclVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SubjectType;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/** 访问控制服务（P-01~07）。 */
@Service
public class KbAclService {

    private final KbAclRepository aclRepository;
    private final KbLibraryRepository libraryRepository;

    public KbAclService(KbAclRepository aclRepository, KbLibraryRepository libraryRepository) {
        this.aclRepository = aclRepository;
        this.libraryRepository = libraryRepository;
    }

    @Transactional(readOnly = true)
    public List<KbAclVO> list(Long libraryId) {
        requireLibrary(libraryId);
        return aclRepository.findByLibraryId(libraryId).stream().map(this::toVo).toList();
    }

    @Transactional
    public KbAclVO grant(Long libraryId, KbAclCreateRequest req) {
        requireLibrary(libraryId);
        if (!SubjectType.isValid(req.subjectType())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "主体类型非法（应为 user/role）");
        }
        if (!AclAction.isValid(req.action())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "动作非法（应为 read/manage/acl）");
        }
        if (aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                libraryId, req.subjectType(), req.subjectId(), req.action())) {
            throw new KbBusinessException(KbResultCode.KB_ACL_EXISTS);
        }
        Instant now = Instant.now();
        KbAcl entity = new KbAcl();
        entity.setId(IdGenerator.nextId());
        entity.setLibraryId(libraryId);
        entity.setSubjectType(req.subjectType());
        entity.setSubjectId(req.subjectId());
        entity.setAction(req.action());
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toVo(aclRepository.save(entity));
    }

    @Transactional
    public void revoke(Long id) {
        KbAcl entity = aclRepository.findById(id)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
        aclRepository.delete(entity);
    }

    private KbLibrary requireLibrary(Long libraryId) {
        return libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private KbAclVO toVo(KbAcl e) {
        return new KbAclVO(
                e.getId(), e.getLibraryId(), e.getSubjectType(), e.getSubjectId(),
                e.getAction(), e.getCreatedAt(), e.getUpdatedAt());
    }
}

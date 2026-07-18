package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.dto.OrgCreateRequest;
import com.mis.org.dto.OrgUpdateRequest;
import com.mis.org.dto.OrgVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class OrgService {

    private final SysOrgRepository orgRepository;

    public OrgService(SysOrgRepository orgRepository) {
        this.orgRepository = orgRepository;
    }

    @Transactional(readOnly = true)
    public List<OrgVO> listByTenant(Long tenantId) {
        return orgRepository.findByTenantIdAndStatus(tenantId, 1).stream()
                .map(this::toVo)
                .toList();
    }

    @Transactional(readOnly = true)
    public OrgVO getById(Long id) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));
        return toVo(org);
    }

    @Transactional
    public OrgVO create(OrgCreateRequest request) {
        orgRepository.findByTenantIdAndCode(request.tenantId(), request.code())
                .ifPresent(o -> { throw new BusinessException(ResultCode.USER_EXISTS, "组织编码已存在"); });

        SysOrg org = new SysOrg();
        org.setId(IdGenerator.nextId());
        org.setTenantId(request.tenantId());
        org.setCode(request.code());
        org.setName(request.name());
        org.setSort(request.sort() != null ? request.sort() : 0);
        org.setStatus(1);
        org.setRemark(request.remark());
        org.setDeleted(0);
        org.setCreatedAt(Instant.now());
        org.setUpdatedAt(Instant.now());
        orgRepository.save(org);
        return toVo(org);
    }

    @Transactional
    public OrgVO update(Long id, OrgUpdateRequest request) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));
        org.setName(request.name());
        if (request.sort() != null) org.setSort(request.sort());
        if (request.status() != null) org.setStatus(request.status());
        if (request.remark() != null) org.setRemark(request.remark());
        org.setUpdatedAt(Instant.now());
        orgRepository.save(org);
        return toVo(org);
    }

    @Transactional
    public void delete(Long id) {
        SysOrg org = orgRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "组织不存在"));
        org.setDeleted(1);
        org.setUpdatedAt(Instant.now());
        orgRepository.save(org);
    }

    private OrgVO toVo(SysOrg org) {
        return new OrgVO(
                String.valueOf(org.getId()),
                String.valueOf(org.getTenantId()),
                org.getCode(),
                org.getName(),
                org.getSort(),
                org.getStatus(),
                org.getRemark(),
                org.getCreatedAt(),
                org.getUpdatedAt());
    }
}

package com.mis.system.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.system.domain.entity.SysDictItem;
import com.mis.system.domain.entity.SysDictType;
import com.mis.system.domain.repository.SysDictItemRepository;
import com.mis.system.domain.repository.SysDictTypeRepository;
import com.mis.system.dto.DictItemCreateRequest;
import com.mis.system.dto.DictItemUpdateRequest;
import com.mis.system.dto.DictItemVO;
import com.mis.system.dto.DictTypeCreateRequest;
import com.mis.system.dto.DictTypeUpdateRequest;
import com.mis.system.dto.DictTypeVO;
import com.mis.system.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;

@Service
public class DictService {

    private final SysDictTypeRepository typeRepository;
    private final SysDictItemRepository itemRepository;

    public DictService(SysDictTypeRepository typeRepository, SysDictItemRepository itemRepository) {
        this.typeRepository = typeRepository;
        this.itemRepository = itemRepository;
    }

    @Transactional(readOnly = true)
    public List<DictTypeVO> listTypes(Long tenantId) {
        return typeRepository.findByTenantIdOrderByCodeAsc(tenantId).stream().map(this::toTypeVo).toList();
    }

    @Transactional
    public DictTypeVO createType(DictTypeCreateRequest request) {
        Long tenantId = request.tenantId() != null ? request.tenantId() : 0L;
        if (typeRepository.existsByTenantIdAndCode(tenantId, request.code().trim())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "字典编码已存在");
        }
        Instant now = Instant.now();
        SysDictType entity = new SysDictType();
        entity.setId(IdGenerator.nextId());
        entity.setTenantId(tenantId);
        entity.setCode(request.code().trim());
        entity.setName(request.name().trim());
        entity.setStatus(1);
        entity.setRemark(trimToNull(request.remark()));
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toTypeVo(typeRepository.save(entity));
    }

    @Transactional
    public DictTypeVO updateType(Long id, DictTypeUpdateRequest request) {
        SysDictType entity = requireType(id);
        entity.setName(request.name().trim());
        if (request.status() != null) {
            entity.setStatus(request.status());
        }
        if (request.remark() != null) {
            entity.setRemark(trimToNull(request.remark()));
        }
        entity.setUpdatedAt(Instant.now());
        return toTypeVo(typeRepository.save(entity));
    }

    @Transactional
    public void deleteType(Long id) {
        requireType(id);
        itemRepository.deleteByTypeId(id);
        typeRepository.deleteById(id);
    }

    @Transactional(readOnly = true)
    public List<DictItemVO> listItems(Long typeId) {
        requireType(typeId);
        return itemRepository.findByTypeIdOrderBySortAscIdAsc(typeId).stream().map(this::toItemVo).toList();
    }

    @Transactional
    public DictItemVO createItem(DictItemCreateRequest request) {
        requireType(request.typeId());
        Instant now = Instant.now();
        SysDictItem entity = new SysDictItem();
        entity.setId(IdGenerator.nextId());
        entity.setTypeId(request.typeId());
        entity.setLabel(request.label().trim());
        entity.setValue(request.value().trim());
        entity.setSort(request.sort() != null ? request.sort() : 0);
        entity.setStatus(1);
        entity.setCssClass(trimToNull(request.cssClass()));
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        return toItemVo(itemRepository.save(entity));
    }

    @Transactional
    public DictItemVO updateItem(Long id, DictItemUpdateRequest request) {
        SysDictItem entity = itemRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "字典项不存在"));
        entity.setLabel(request.label().trim());
        entity.setValue(request.value().trim());
        if (request.sort() != null) {
            entity.setSort(request.sort());
        }
        if (request.status() != null) {
            entity.setStatus(request.status());
        }
        if (request.cssClass() != null) {
            entity.setCssClass(trimToNull(request.cssClass()));
        }
        entity.setUpdatedAt(Instant.now());
        return toItemVo(itemRepository.save(entity));
    }

    @Transactional
    public void deleteItem(Long id) {
        if (!itemRepository.existsById(id)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "字典项不存在");
        }
        itemRepository.deleteById(id);
    }

    private SysDictType requireType(Long id) {
        return typeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "字典类型不存在"));
    }

    private DictTypeVO toTypeVo(SysDictType e) {
        return new DictTypeVO(
                String.valueOf(e.getId()),
                String.valueOf(e.getTenantId()),
                e.getCode(),
                e.getName(),
                e.getStatus(),
                e.getRemark());
    }

    private DictItemVO toItemVo(SysDictItem e) {
        return new DictItemVO(
                String.valueOf(e.getId()),
                String.valueOf(e.getTypeId()),
                e.getLabel(),
                e.getValue(),
                e.getSort(),
                e.getStatus(),
                e.getCssClass());
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}

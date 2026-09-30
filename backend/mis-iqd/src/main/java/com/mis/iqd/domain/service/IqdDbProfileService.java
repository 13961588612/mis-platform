package com.mis.iqd.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iqd.api.dto.IqdDbProfileSaveRequest;
import com.mis.iqd.api.dto.IqdDbProfileVO;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdDbProfile;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdDbProfileRepository;
import com.mis.iqd.support.IdGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据库连接配置（Tab①）管理：CRUD + 默认项 + 删除引用阻断。
 *
 * <p><b>分层</b>（2026-09-29）：本服务只管「业务库连接（= wren profile）」，与
 * 「语义工程（project = wren context）」解耦；删除 profile 前必须校验无 project 引用，
 * 否则引用它的项目会静默全废。
 *
 * <p><b>安全红线</b>：密码明文只在 ai-platform vault（经 BFF 写），本服务只落
 * {@code secret_ref} 引用；VO 恒回 {@code ******} + {@code has_password}。
 */
@Service
public class IqdDbProfileService {

    private static final Logger log = LoggerFactory.getLogger(IqdDbProfileService.class);
    private static final String SECRET_PLACEHOLDER = "******";

    private final IqdDbProfileRepository profileRepository;
    private final IqdConnectionRepository connectionRepository;
    private final IqdChangeEventPublisher changeEventPublisher;

    public IqdDbProfileService(
            IqdDbProfileRepository profileRepository,
            IqdConnectionRepository connectionRepository,
            IqdChangeEventPublisher changeEventPublisher) {
        this.profileRepository = profileRepository;
        this.connectionRepository = connectionRepository;
        this.changeEventPublisher = changeEventPublisher;
    }

    @Transactional(readOnly = true)
    public List<IqdDbProfileVO> listProfiles() {
        List<IqdDbProfileVO> out = new ArrayList<>();
        for (IqdDbProfile p : profileRepository.findAllByOrderByIdAsc()) {
            out.add(toVO(p));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public IqdDbProfileVO getProfile(Long id) {
        return toVO(require(id));
    }

    /**
     * 新建（id=null）或按 id 更新。
     *
     * <p>名称唯一（40900 先查后报）；{@code is_default=true} 时把其它 profile 的默认位清零。
     * {@code secret_ref} 非空非占位才更新（与连接编辑同口径）。
     */
    @Transactional
    public IqdDbProfileVO saveProfile(Long id, IqdDbProfileSaveRequest dto) {
        if (dto == null || dto.getName() == null || dto.getName().isBlank()) {
            throw new BusinessException(42200, "连接名不能为空", null);
        }
        String name = dto.getName().trim();

        IqdDbProfile entity;
        if (id == null) {
            if (profileRepository.existsByName(name)) {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("name", name);
                throw new BusinessException(40900, "连接名已存在: " + name, data);
            }
            entity = new IqdDbProfile();
            entity.setId(IdGenerator.nextId());
            entity.setCreatedAt(Instant.now());
        } else {
            entity = require(id);
            if (!name.equals(entity.getName()) && profileRepository.existsByName(name)) {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("name", name);
                throw new BusinessException(40900, "连接名已存在: " + name, data);
            }
        }

        entity.setName(name);
        if (dto.getDbType() != null && !dto.getDbType().isBlank()) {
            entity.setDbType(dto.getDbType().trim());
        }
        entity.setDbHost(dto.getDbHost());
        entity.setDbPort(dto.getDbPort());
        entity.setDbDatabase(dto.getDbDatabase());
        entity.setDbUser(dto.getDbUser());
        if (dto.getSecretRef() != null && !dto.getSecretRef().isBlank() && !dto.isSecretPlaceholder()) {
            entity.setSecretRef(dto.getSecretRef().trim());
        } else if (entity.getSecretRef() == null || entity.getSecretRef().isBlank()) {
            // 未显式给 ref → 用连接名作稳定 vault 键（BFF 写 vault 用同名）
            entity.setSecretRef("iqd-profile-" + entity.getId());
        }
        entity.setDescription(dto.getDescription());
        if (dto.getEnabled() != null) {
            entity.setEnabled(Boolean.TRUE.equals(dto.getEnabled()) ? 1 : 0);
        }
        boolean makeDefault = Boolean.TRUE.equals(dto.getIsDefault());
        if (makeDefault) {
            clearOtherDefaults(entity.getId());
            entity.setIsDefault(1);
        } else if (dto.getIsDefault() != null) {
            entity.setIsDefault(0);
        }
        entity.setUpdatedAt(Instant.now());
        profileRepository.save(entity);
        changeEventPublisher.publish("iqd.config.changed", "db_profile=" + entity.getId());
        log.info("IQD db profile saved id={} name={} default={}", entity.getId(), entity.getName(),
                entity.getIsDefault());
        return toVO(entity);
    }

    /**
     * 删除 profile（**引用阻断**：仍被 project 引用时 42200 + data.dependents）。
     */
    @Transactional
    public Map<String, Object> deleteProfile(Long id) {
        IqdDbProfile entity = require(id);
        List<IqdConnection> referrers = new ArrayList<>();
        for (IqdConnection c : connectionRepository.findAll()) {
            if (id.equals(c.getProfileId())) {
                referrers.add(c);
            }
        }
        if (!referrers.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("dependents", referrers.stream()
                    .map(c -> {
                        Map<String, Object> d = new LinkedHashMap<>();
                        d.put("id", c.getId());
                        d.put("name", c.getName());
                        return d;
                    })
                    .toList());
            throw new BusinessException(42200,
                    "该数据库连接仍被 " + referrers.size() + " 个项目引用，无法删除", data);
        }
        profileRepository.delete(entity);
        changeEventPublisher.publish("iqd.config.changed", "db_profile_deleted=" + id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("deleted", true);
        return out;
    }

    /**
     * 回写连通性测试结果（由 BFF 调 ai-platform 直连业务库后回写）。
     */
    @Transactional
    public IqdDbProfileVO reportTest(Long id, boolean ok, String message) {
        IqdDbProfile entity = require(id);
        entity.setLastTestAt(Instant.now());
        entity.setLastTestOk(ok ? 1 : 0);
        entity.setLastTestMsg(message == null ? null : message.substring(0, Math.min(500, message.length())));
        entity.setUpdatedAt(Instant.now());
        profileRepository.save(entity);
        return toVO(entity);
    }

    private void clearOtherDefaults(Long keepId) {
        for (IqdDbProfile other : profileRepository.findAll()) {
            if (!other.getId().equals(keepId) && other.getIsDefault() != null && other.getIsDefault() == 1) {
                other.setIsDefault(0);
                profileRepository.save(other);
            }
        }
    }

    private IqdDbProfile require(Long id) {
        if (id == null) {
            throw new BusinessException(42200, "profileId 不能为空", null);
        }
        return profileRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "数据库连接配置不存在: " + id));
    }

    private IqdDbProfileVO toVO(IqdDbProfile p) {
        IqdDbProfileVO vo = new IqdDbProfileVO();
        vo.setId(p.getId());
        vo.setName(p.getName());
        vo.setDbType(p.getDbType());
        vo.setDbHost(p.getDbHost());
        vo.setDbPort(p.getDbPort());
        vo.setDbDatabase(p.getDbDatabase());
        vo.setDbUser(p.getDbUser());
        vo.setSecretRef(SECRET_PLACEHOLDER);
        // hasPassword：有 secret_ref 即视为已托管（密码不回显）
        vo.setHasPassword(p.getSecretRef() != null && !p.getSecretRef().isBlank());
        vo.setDescription(p.getDescription());
        vo.setEnabled(p.getEnabled() != null && p.getEnabled() == 1);
        vo.setIsDefault(p.getIsDefault() != null && p.getIsDefault() == 1);
        vo.setLastTestAt(p.getLastTestAt());
        vo.setLastTestOk(p.getLastTestOk() == null ? null : p.getLastTestOk() == 1);
        vo.setLastTestMsg(p.getLastTestMsg());
        vo.setCreatedAt(p.getCreatedAt());
        vo.setUpdatedAt(p.getUpdatedAt());
        return vo;
    }
}

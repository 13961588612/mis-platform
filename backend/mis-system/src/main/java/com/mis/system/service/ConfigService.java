package com.mis.system.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.system.domain.entity.SysConfig;
import com.mis.system.domain.repository.SysConfigRepository;
import com.mis.system.dto.ConfigCreateRequest;
import com.mis.system.dto.ConfigUpdateRequest;
import com.mis.system.dto.ConfigVO;
import com.mis.system.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;

/**
 * 系统参数维护：CRUD + config_key 唯一校验（DB 已有 uk_config_key）。
 * 注：security.* 等参数修改后不一定即时生效（读取方后续接入）。
 */
@Service
public class ConfigService {

    private final SysConfigRepository configRepository;

    public ConfigService(SysConfigRepository configRepository) {
        this.configRepository = configRepository;
    }

    @Transactional(readOnly = true)
    public List<ConfigVO> list() {
        return configRepository.findAllByOrderByIdAsc().stream().map(this::toVo).toList();
    }

    @Transactional(readOnly = true)
    public ConfigVO getById(Long id) {
        return toVo(requireConfig(id));
    }

    @Transactional
    public ConfigVO create(ConfigCreateRequest request) {
        String key = request.configKey().trim();
        if (configRepository.existsByConfigKey(key)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "参数键已存在");
        }
        Instant now = Instant.now();
        SysConfig config = new SysConfig();
        config.setId(IdGenerator.nextId());
        config.setConfigKey(key);
        config.setConfigValue(request.configValue().trim());
        config.setRemark(trimToNull(request.remark()));
        config.setCreatedAt(now);
        config.setUpdatedAt(now);
        return toVo(configRepository.save(config));
    }

    @Transactional
    public ConfigVO update(Long id, ConfigUpdateRequest request) {
        SysConfig config = requireConfig(id);
        config.setConfigValue(request.configValue().trim());
        config.setRemark(trimToNull(request.remark()));
        config.setUpdatedAt(Instant.now());
        return toVo(configRepository.save(config));
    }

    @Transactional
    public void delete(Long id) {
        requireConfig(id);
        configRepository.deleteById(id);
    }

    private SysConfig requireConfig(Long id) {
        return configRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "系统参数不存在"));
    }

    private ConfigVO toVo(SysConfig c) {
        return new ConfigVO(
                String.valueOf(c.getId()),
                c.getConfigKey(),
                c.getConfigValue(),
                c.getRemark(),
                c.getCreatedAt(),
                c.getUpdatedAt());
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}

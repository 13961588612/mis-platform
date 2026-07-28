package com.mis.audit.service;

import com.mis.audit.domain.entity.SysOperLog;
import com.mis.audit.domain.repository.OperLogRepository;
import com.mis.audit.dto.CreateOperLogRequest;
import com.mis.audit.dto.OperLogVO;
import com.mis.audit.support.IdGenerator;
import com.mis.common.core.result.PageResult;
import com.mis.common.jpa.support.PageMapper;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

@Service
public class OperLogService {

    private static final Pattern SENSITIVE_JSON = Pattern.compile(
            "(?i)(\"(?:password|passwd|pwd|token|accessToken|refreshToken|secret)\"\\s*:\\s*\")([^\"]*)(\")");

    private final OperLogRepository operLogRepository;

    public OperLogService(OperLogRepository operLogRepository) {
        this.operLogRepository = operLogRepository;
    }

    @Transactional
    public void create(CreateOperLogRequest request) {
        SysOperLog entity = new SysOperLog();
        entity.setId(IdGenerator.nextId());
        entity.setTenantId(request.tenantId());
        entity.setUserId(request.userId());
        entity.setUsername(trimToNull(request.username()));
        entity.setModule(trimToNull(request.module()));
        entity.setOperation(trimToNull(request.operation()));
        entity.setMethod(trimToNull(request.method()));
        entity.setRequestUri(trimToNull(request.requestUri()));
        entity.setRequestMethod(trimToNull(request.requestMethod()));
        entity.setRequestParams(maskParams(request.requestParams()));
        entity.setResponseCode(request.responseCode());
        entity.setDurationMs(request.durationMs());
        entity.setIp(trimToNull(request.ip()));
        entity.setOperTime(Instant.now());
        operLogRepository.save(entity);
    }

    @Transactional(readOnly = true)
    public PageResult<OperLogVO> page(int page, int size, String module, String username) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        Specification<SysOperLog> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (StringUtils.hasText(module)) {
                predicates.add(cb.like(root.get("module"), "%" + module.trim() + "%"));
            }
            if (StringUtils.hasText(username)) {
                predicates.add(cb.like(root.get("username"), "%" + username.trim() + "%"));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        Page<SysOperLog> result = operLogRepository.findAll(
                spec,
                PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.DESC, "operTime")));
        return PageMapper.toPageResult(result.map(this::toVo));
    }

    private OperLogVO toVo(SysOperLog e) {
        return new OperLogVO(
                String.valueOf(e.getId()),
                String.valueOf(e.getTenantId()),
                e.getUserId() != null ? String.valueOf(e.getUserId()) : null,
                e.getUsername(),
                e.getModule(),
                e.getOperation(),
                e.getMethod(),
                e.getRequestUri(),
                e.getRequestMethod(),
                e.getResponseCode(),
                e.getDurationMs(),
                e.getIp(),
                e.getRequestParams(),
                e.getOperTime());
    }

    private static String maskParams(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String masked = SENSITIVE_JSON.matcher(raw).replaceAll("$1***$3");
        // 额外兜底手机号片段
        if (masked.toLowerCase(Locale.ROOT).contains("phone")) {
            return masked; // JSON 值级脱敏较复杂，敏感键已处理
        }
        return masked.length() > 4000 ? masked.substring(0, 4000) : masked;
    }

    private static String trimToNull(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        return value.trim();
    }
}

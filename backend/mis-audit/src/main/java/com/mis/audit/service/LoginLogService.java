package com.mis.audit.service;

import com.mis.audit.domain.entity.SysLoginLog;
import com.mis.audit.domain.repository.LoginLogRepository;
import com.mis.audit.dto.CreateLoginLogRequest;
import com.mis.audit.dto.LoginLogVO;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Service
public class LoginLogService {

    private final LoginLogRepository loginLogRepository;

    public LoginLogService(LoginLogRepository loginLogRepository) {
        this.loginLogRepository = loginLogRepository;
    }

    @Transactional
    public void create(CreateLoginLogRequest request) {
        SysLoginLog entity = new SysLoginLog();
        entity.setId(IdGenerator.nextId());
        entity.setTenantId(request.tenantId());
        entity.setAppId(request.appId());
        entity.setUserId(request.userId());
        entity.setUsername(request.username());
        entity.setIp(trimToNull(request.ip()));
        entity.setUserAgent(trimToNull(request.userAgent()));
        entity.setStatus(request.status());
        entity.setMsg(trimToNull(request.msg()));
        entity.setLoginAt(Instant.now());
        loginLogRepository.save(entity);
    }

    @Transactional(readOnly = true)
    public PageResult<LoginLogVO> page(
            int page,
            int size,
            String username,
            Integer status,
            Instant startTime,
            Instant endTime) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        Specification<SysLoginLog> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (username != null && !username.isBlank()) {
                predicates.add(cb.like(root.get("username"), "%" + username.trim() + "%"));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (startTime != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("loginAt"), startTime));
            }
            if (endTime != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("loginAt"), endTime));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        Page<SysLoginLog> result = loginLogRepository.findAll(
                spec,
                PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.DESC, "loginAt")));
        return PageMapper.toPageResult(result.map(this::toVo));
    }

    private LoginLogVO toVo(SysLoginLog entity) {
        return new LoginLogVO(
                String.valueOf(entity.getId()),
                String.valueOf(entity.getTenantId()),
                String.valueOf(entity.getAppId()),
                entity.getUserId() != null ? String.valueOf(entity.getUserId()) : null,
                entity.getUsername(),
                entity.getIp(),
                entity.getUserAgent(),
                entity.getStatus(),
                entity.getMsg(),
                entity.getLoginAt());
    }

    private static String trimToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}

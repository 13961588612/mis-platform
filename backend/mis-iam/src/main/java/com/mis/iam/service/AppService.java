package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.domain.entity.SysApp;
import com.mis.iam.domain.repository.SysAppRepository;
import com.mis.iam.dto.AppUpdateRequest;
import com.mis.iam.dto.AppVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class AppService {

    private final SysAppRepository appRepository;

    public AppService(SysAppRepository appRepository) {
        this.appRepository = appRepository;
    }

    @Transactional(readOnly = true)
    public List<AppVO> listByTenant(Long tenantId) {
        return appRepository.findByTenantIdAndStatusOrderBySortAscIdAsc(tenantId, 1).stream()
                .map(this::toVo)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AppVO> listPortalSubsystems(Long tenantId) {
        return listByTenant(tenantId).stream()
                .filter(a -> a.kind() == null || "subsystem".equalsIgnoreCase(a.kind()))
                .toList();
    }

    @Transactional
    public AppVO update(Long id, AppUpdateRequest request) {
        SysApp app = appRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "应用不存在"));
        if (request.name() != null && !request.name().isBlank()) {
            app.setName(request.name().trim());
        }
        if (request.icon() != null) {
            app.setIcon(blankToNull(request.icon()));
        }
        if (request.basePath() != null) {
            app.setBasePath(blankToNull(request.basePath()));
        }
        if (request.mfeRemote() != null) {
            app.setMfeRemote(blankToNull(request.mfeRemote()));
        }
        if (request.description() != null) {
            app.setDescription(blankToNull(request.description()));
        }
        if (request.portalGroup() != null) {
            app.setPortalGroup(blankToNull(request.portalGroup()));
        }
        if (request.kind() != null && !request.kind().isBlank()) {
            app.setKind(request.kind().trim());
        }
        if (request.runtime() != null && !request.runtime().isBlank()) {
            app.setRuntime(request.runtime().trim());
        }
        if (request.sort() != null) {
            app.setSort(request.sort());
        }
        if (request.status() != null) {
            app.setStatus(request.status());
        }
        return toVo(appRepository.save(app));
    }

    private AppVO toVo(SysApp app) {
        return new AppVO(
                String.valueOf(app.getId()),
                String.valueOf(app.getTenantId()),
                app.getCode(),
                app.getName(),
                app.getIcon(),
                app.getBasePath(),
                app.getDescription(),
                app.getPortalGroup(),
                app.getKind() != null ? app.getKind() : "subsystem",
                app.getRuntime() != null ? app.getRuntime() : "host",
                app.getSort(),
                app.getStatus(),
                app.getMfeRemote());
    }

    private static String blankToNull(String value) {
        String t = value.trim();
        return t.isEmpty() ? null : t;
    }
}

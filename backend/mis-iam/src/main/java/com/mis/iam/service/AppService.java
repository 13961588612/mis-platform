package com.mis.iam.service;

import com.mis.iam.domain.entity.SysApp;
import com.mis.iam.domain.repository.SysAppRepository;
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
        return appRepository.findByTenantIdAndStatus(tenantId, 1).stream()
                .map(this::toVo)
                .toList();
    }

    private AppVO toVo(SysApp app) {
        return new AppVO(
                String.valueOf(app.getId()),
                String.valueOf(app.getTenantId()),
                app.getCode(),
                app.getName(),
                app.getIcon(),
                app.getBasePath(),
                app.getSort(),
                app.getStatus());
    }
}

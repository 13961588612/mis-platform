package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconReadinessGate;
import com.mis.recon.domain.dto.ReadinessGateSaveReq;
import com.mis.recon.repository.ReadinessGateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 数据就绪门配置服务（T07-spec §7，G31）：场景级 CRUD。引擎求值逻辑不变（T06 已接 PullRunner）。
 */
@Service
@RequiredArgsConstructor
public class ReadinessGateService {

    private final ReadinessGateRepository readinessGateRepository;
    private final ConfigValidationService configValidationService;

    public PageResult<ReconReadinessGate> page(String scenarioCode, PageRequest pageable) {
        Page<ReconReadinessGate> page = StringUtils.hasText(scenarioCode)
                ? readinessGateRepository.findByScenarioCode(scenarioCode, pageable)
                : readinessGateRepository.findAll((Pageable) pageable);
        return PageResult.from(page);
    }

    public ReconReadinessGate save(ReadinessGateSaveReq req) {
        if (!configValidationService.existsScenarioCode(req.getScenarioCode())) {
            throw new BizException(ErrorCode.SCENARIO_NOT_FOUND);
        }
        ReconReadinessGate entity = new ReconReadinessGate();
        entity.setScenarioCode(req.getScenarioCode());
        apply(entity, req);
        return readinessGateRepository.save(entity);
    }

    public ReconReadinessGate update(Long id, ReadinessGateSaveReq req) {
        ReconReadinessGate entity = readinessGateRepository.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.RESOURCE_NOT_FOUND, "就绪门配置不存在"));
        if (!entity.getScenarioCode().equals(req.getScenarioCode())) {
            throw new BizException(ErrorCode.PARAM_ERROR, "场景编码创建后不可修改");
        }
        apply(entity, req);
        return readinessGateRepository.save(entity);
    }

    public void delete(Long id) {
        if (!readinessGateRepository.existsById(id)) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "就绪门配置不存在");
        }
        readinessGateRepository.deleteById(id);
    }

    private static void apply(ReconReadinessGate e, ReadinessGateSaveReq req) {
        e.setGateName(req.getGateName());
        e.setGateType(req.getGateType());
        e.setGateSql(req.getGateSql());
        e.setGateConfigJson(req.getGateConfigJson());
        e.setMinWaitMin(req.getMinWaitMin());
        e.setMaxWaitMin(req.getMaxWaitMin());
        e.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
    }
}
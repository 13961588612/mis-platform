package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.dto.ScenarioSaveReq;
import com.mis.recon.domain.enums.ResultEnums.ReportType;
import com.mis.recon.repository.ScenarioRepository;
import com.mis.recon.service.pull.SchedulerManager;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * 场景配置服务（F79）。uses_json 为派生汇总，DTO 不接收、本服务不手动维护（G12 由 CheckService 回写）。
 */
@Service
@RequiredArgsConstructor
public class ScenarioService {

    private final ScenarioRepository scenarioRepository;
    private final ConfigValidationService configValidationService;
    private final SchedulerManager schedulerManager;

    public PageResult<ReconScenario> page(PageRequest pageable, String keyword, Integer enabled) {
        Page<ReconScenario> page = scenarioRepository.search(keyword, enabled, pageable);
        return PageResult.from(page);
    }

    public ReconScenario get(String scenarioCode) {
        return scenarioRepository.findByScenarioCode(scenarioCode)
                .orElseThrow(() -> new BizException(ErrorCode.SCENARIO_NOT_FOUND));
    }

    /** 事务：调度注册失败（cron 非法等 RuntimeException）整体回滚，避免「报错但场景已保存」不一致。 */
    @Transactional
    public ReconScenario save(ScenarioSaveReq req) {
        if (configValidationService.existsScenarioCode(req.getScenarioCode())) {
            throw new BizException(ErrorCode.SCENARIO_CODE_EXISTS);
        }
        configValidationService.validateScenarioCrons(req);
        ReportType.from(blankToDefault(req.getReportType(), "diff"));
        ReconScenario entity = new ReconScenario();
        entity.setScenarioCode(req.getScenarioCode());
        apply(entity, req);
        ReconScenario saved = scenarioRepository.save(entity);
        schedulerManager.refreshReconJob(saved.getScenarioCode(), saved.getCronExpr(), saved.getEnabled() == 1);
        schedulerManager.refreshReportJob(saved.getScenarioCode(), saved.getReportCron(), saved.getEnabled() == 1);
        return saved;
    }

    @Transactional
    public ReconScenario update(String scenarioCode, ScenarioSaveReq req) {
        ReconScenario entity = scenarioRepository.findByScenarioCode(scenarioCode)
                .orElseThrow(() -> new BizException(ErrorCode.SCENARIO_NOT_FOUND));
        if (!scenarioCode.equals(req.getScenarioCode())) {
            throw new BizException(ErrorCode.SCENARIO_NOT_FOUND, "场景编码创建后不可修改，路径为准");
        }
        configValidationService.validateScenarioCrons(req);
        ReportType.from(blankToDefault(req.getReportType(), "diff"));
        apply(entity, req);
        ReconScenario saved = scenarioRepository.save(entity);
        schedulerManager.refreshReconJob(saved.getScenarioCode(), saved.getCronExpr(), saved.getEnabled() == 1);
        schedulerManager.refreshReportJob(saved.getScenarioCode(), saved.getReportCron(), saved.getEnabled() == 1);
        return saved;
    }

    public void delete(String scenarioCode) {
        ReconScenario existing = scenarioRepository.findByScenarioCode(scenarioCode)
                .orElseThrow(() -> new BizException(ErrorCode.SCENARIO_NOT_FOUND));
        scenarioRepository.deleteById(existing.getId());
        schedulerManager.removeReconJob(scenarioCode);
        schedulerManager.removeReportJob(scenarioCode);
    }

    private static String blankToDefault(String value, String def) {
        return StringUtils.hasText(value) ? value : def;
    }

    private void apply(ReconScenario e, ScenarioSaveReq req) {
        e.setName(req.getName());
        e.setCronExpr(req.getCronExpr());
        e.setHooksJson(req.getHooksJson());
        e.setReporterJson(req.getReporterJson());
        e.setReportCron(req.getReportCron());
        e.setReportType(blankToDefault(req.getReportType(), "diff"));
        e.setPoolMaxAgeDays(req.getPoolMaxAgeDays() == null ? 30 : req.getPoolMaxAgeDays());
        e.setPendingMaxWaitHours(req.getPendingMaxWaitHours() == null ? 24 : req.getPendingMaxWaitHours());
        e.setOnDegraded(blankToDefault(req.getOnDegraded(), "proceed"));
        e.setOnEmpty(blankToDefault(req.getOnEmpty(), "proceed"));
        e.setOnError(blankToDefault(req.getOnError(), "proceed"));
        e.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
    }
}

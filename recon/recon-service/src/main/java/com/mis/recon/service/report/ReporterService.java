package com.mis.recon.service.report;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconReporterConfig;
import com.mis.recon.domain.dto.ReporterSaveReq;
import com.mis.recon.domain.enums.ResultEnums.Severity;
import com.mis.recon.repository.ReporterConfigRepository;
import com.mis.recon.service.config.ConfigValidationService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 报告渠道配置服务（T07-spec §7，G32）：场景级 CRUD + 报告引擎渠道路由（resolve）。
 * resolve 供 ReportRunner 使用：check 精确 → '*' 通配 → 默认（返回 null 走应用级配置）。
 */
@Service
@RequiredArgsConstructor
public class ReporterService {

    /** 通配 check_name，表示该场景全部 check */
    public static final String WILDCARD = "*";

    private final ReporterConfigRepository reporterConfigRepository;
    private final ConfigValidationService configValidationService;

    public PageResult<ReconReporterConfig> page(String scenarioCode, PageRequest pageable) {
        Page<ReconReporterConfig> page = StringUtils.hasText(scenarioCode)
                ? reporterConfigRepository.findByScenarioCode(scenarioCode, pageable)
                : reporterConfigRepository.findAll((Pageable) pageable);
        return PageResult.from(page);
    }

    public ReconReporterConfig save(ReporterSaveReq req) {
        if (!configValidationService.existsScenarioCode(req.getScenarioCode())) {
            throw new BizException(ErrorCode.SCENARIO_NOT_FOUND);
        }
        validateSeverity(req.getMinSeverity());
        ReconReporterConfig entity = new ReconReporterConfig();
        entity.setScenarioCode(req.getScenarioCode());
        apply(entity, req);
        return reporterConfigRepository.save(entity);
    }

    public ReconReporterConfig update(Long id, ReporterSaveReq req) {
        ReconReporterConfig entity = reporterConfigRepository.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.RESOURCE_NOT_FOUND, "报告渠道配置不存在"));
        if (!entity.getScenarioCode().equals(req.getScenarioCode())) {
            throw new BizException(ErrorCode.PARAM_ERROR, "场景编码创建后不可修改");
        }
        validateSeverity(req.getMinSeverity());
        apply(entity, req);
        return reporterConfigRepository.save(entity);
    }

    public void delete(Long id) {
        if (!reporterConfigRepository.existsById(id)) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "报告渠道配置不存在");
        }
        reporterConfigRepository.deleteById(id);
    }

    /**
     * 渠道路由：scenario+check 精确 → scenario+'*' 通配 → null（应用级默认）。
     * 命中 enabled=0 配置时视同未命中继续向后查找。
     */
    public ReconReporterConfig resolve(String scenarioCode, String checkName) {
        if (StringUtils.hasText(checkName)) {
            ReconReporterConfig exact = findByEnabled(scenarioCode, checkName);
            if (exact != null) {
                return exact;
            }
        }
        return findByEnabled(scenarioCode, WILDCARD);
    }

    private ReconReporterConfig findByEnabled(String scenarioCode, String checkName) {
        return reporterConfigRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName)
                .filter(c -> c.getEnabled() == null || c.getEnabled() == 1)
                .orElse(null);
    }

    private static void validateSeverity(String minSeverity) {
        if (StringUtils.hasText(minSeverity)) {
            Severity.from(minSeverity);
        }
    }

    private static void apply(ReconReporterConfig e, ReporterSaveReq req) {
        e.setCheckName(StringUtils.hasText(req.getCheckName()) ? req.getCheckName() : WILDCARD);
        e.setChannel(req.getChannel());
        e.setConfigJson(req.getConfigJson());
        e.setMinSeverity(StringUtils.hasText(req.getMinSeverity()) ? req.getMinSeverity() : "info");
        e.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
    }
}
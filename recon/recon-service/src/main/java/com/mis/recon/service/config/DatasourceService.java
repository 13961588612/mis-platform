package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.dto.DatasourceSaveReq;
import com.mis.recon.domain.enums.ConfigEnums.DeleteMode;
import com.mis.recon.domain.enums.ConfigEnums.FetchType;
import com.mis.recon.domain.enums.ConfigEnums.Grain;
import com.mis.recon.domain.enums.ConfigEnums.RefundSignRule;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.service.pull.SchedulerManager;
import com.mis.recon.service.support.ConnectionPoolManager;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 数据源配置服务（F78）。
 */
@Service
@RequiredArgsConstructor
public class DatasourceService {

    private final DatasourceRepository datasourceRepository;
    private final CheckRepository checkRepository;
    private final ConnectionRepository connectionRepository;
    private final ConfigValidationService configValidationService;
    private final ConnectionPoolManager connectionPoolManager;
    private final SchedulerManager schedulerManager;

    public PageResult<ReconDatasource> page(PageRequest pageable, String keyword, Integer enabled) {
        Page<ReconDatasource> page = datasourceRepository.search(keyword, enabled, pageable);
        return PageResult.from(page);
    }

    public ReconDatasource get(String dsCode) {
        return datasourceRepository.findByDsCode(dsCode)
                .orElseThrow(() -> new BizException(ErrorCode.DS_NOT_FOUND));
    }

    /** 事务：调度注册失败（cron 非法等 RuntimeException）整体回滚，避免「报错但数据源已保存」不一致。 */
    @Transactional
    public ReconDatasource save(DatasourceSaveReq req) {
        if (configValidationService.existsDsCode(req.getDsCode())) {
            throw new BizException(ErrorCode.DS_CODE_EXISTS);
        }
        configValidationService.validateDatasource(req);
        enumValidation(req);
        if ("db".equals(blankToDefault(req.getFetchType(), "db")) && !StringUtils.hasText(req.getConnCode())) {
            throw new BizException(ErrorCode.PARAM_ERROR, "db 类型数据源必须配置连接 conn_code");
        }
        ReconDatasource entity = new ReconDatasource();
        entity.setDsCode(req.getDsCode());
        apply(entity, req);
        ReconDatasource saved = datasourceRepository.save(entity);
        schedulerManager.refreshPullJob(saved.getDsCode(), saved.getPullCron(), saved.getEnabled() == 1);
        return saved;
    }

    @Transactional
    public ReconDatasource update(String dsCode, DatasourceSaveReq req) {
        ReconDatasource entity = datasourceRepository.findByDsCode(dsCode)
                .orElseThrow(() -> new BizException(ErrorCode.DS_NOT_FOUND));
        if (!dsCode.equals(req.getDsCode())) {
            throw new BizException(ErrorCode.DS_NOT_FOUND, "数据源编码创建后不可修改，路径为准");
        }
        configValidationService.validateDatasource(req);
        enumValidation(req);
        apply(entity, req);
        ReconDatasource saved = datasourceRepository.save(entity);
        schedulerManager.refreshPullJob(saved.getDsCode(), saved.getPullCron(), saved.getEnabled() == 1);
        return saved;
    }

    public void delete(String dsCode) {
        ReconDatasource existing = datasourceRepository.findByDsCode(dsCode)
                .orElseThrow(() -> new BizException(ErrorCode.DS_NOT_FOUND));
        List<ReconCheck> refs = checkRepository.findRefByConsumeDsCode(dsCode);
        if (!refs.isEmpty()) {
            String checks = refs.stream()
                    .map(c -> c.getScenarioCode() + "." + c.getCheckName())
                    .collect(Collectors.joining(", "));
            throw new BizException(ErrorCode.DS_REFERENCED,
                    "数据源已被 check 引用（" + checks + "），无法删除");
        }
        datasourceRepository.deleteById(existing.getId());
        schedulerManager.removePullJob(dsCode);
    }

    public void testConnection(String dsCode) {
        ReconDatasource ds = datasourceRepository.findByDsCode(dsCode)
                .orElseThrow(() -> new BizException(ErrorCode.DS_NOT_FOUND));
        if (!"db".equals(ds.getFetchType())) {
            throw new BizException(ErrorCode.DS_TEST_FAILED, "api/custom 取数不经过连接层，无法测试连接");
        }
        ReconConnection conn = connectionRepository.findByConnCode(ds.getConnCode())
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_FOUND,
                        "数据源引用的连接不存在: " + ds.getConnCode()));
        connectionPoolManager.testConnection(conn);
    }

    private void enumValidation(DatasourceSaveReq req) {
        FetchType.from(blankToDefault(req.getFetchType(), "db"));
        Grain.from(blankToDefault(req.getGrain(), "row"));
        DeleteMode.from(blankToDefault(req.getDeleteMode(), "unknown"));
        if (StringUtils.hasText(req.getRefundSignRule())) {
            RefundSignRule.from(req.getRefundSignRule());
        }
    }

    private static String blankToDefault(String value, String def) {
        return StringUtils.hasText(value) ? value : def;
    }

    private static String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }

    private void apply(ReconDatasource e, DatasourceSaveReq req) {
        e.setName(req.getName());
        e.setConnCode(req.getConnCode());
        e.setPullCron(req.getPullCron());
        e.setRecordKeyExpression(req.getRecordKeyExpression());
        e.setTimeField(req.getTimeField());
        e.setFetchType(blankToDefault(req.getFetchType(), "db"));
        // JSONB 列：空串不是合法 JSON，PG 会报 invalid input syntax for type json，统一归一化为 null（列可空）
        e.setFetchConfigJson(blankToNull(req.getFetchConfigJson()));
        e.setFieldsJson(blankToNull(req.getFieldsJson()));
        e.setHealthRulesJson(blankToNull(req.getHealthRulesJson()));
        e.setAmountFieldsJson(blankToNull(req.getAmountFieldsJson()));
        e.setRefundSignRule(req.getRefundSignRule());
        e.setRefundFlagExpr(req.getRefundFlagExpr());
        e.setGrain(blankToDefault(req.getGrain(), "row"));
        e.setGroupByFields(req.getGroupByFields());
        e.setMemberKeyField(req.getMemberKeyField());
        e.setKeyScanSql(req.getKeyScanSql());
        e.setAggSql(req.getAggSql());
        e.setAggKeyBatchSize(req.getAggKeyBatchSize() == null ? 500 : req.getAggKeyBatchSize());
        e.setAggJoinMode(blankToDefault(req.getAggJoinMode(), "in_list"));
        e.setAggFullRecomputeCron(req.getAggFullRecomputeCron());
        e.setMixedDirection(Boolean.TRUE.equals(req.getMixedDirection()) ? 1 : 0);
        e.setDirectionKeyField(req.getDirectionKeyField());
        e.setKeyCaseMode(blankToDefault(req.getKeyCaseMode(), "upper"));
        e.setDeleteMode(blankToDefault(req.getDeleteMode(), "unknown"));
        e.setSoftDeleteExpr(req.getSoftDeleteExpr());
        e.setDeleteModeEvidence(req.getDeleteModeEvidence());
        e.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
    }
}

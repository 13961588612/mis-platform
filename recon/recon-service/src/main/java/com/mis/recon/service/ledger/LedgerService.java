package com.mis.recon.service.ledger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.dao.LedgerDao;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.util.JsonUtil;

import java.util.List;
import java.util.Map;

/**
 * 台账服务（F85）：源行 → 台账 upsert 编排 + AmountSpec 解析。
 */
@org.springframework.stereotype.Service
public class LedgerService {

    private final LedgerDao ledgerDao;

    public LedgerService(LedgerDao ledgerDao) {
        this.ledgerDao = ledgerDao;
    }

    /** 批 upsert（事务由调用方 TransactionTemplate 提供，T04-spec G5）。 */
    public LedgerDao.BatchResult upsertRows(String dsCode, String recordKeyExpr,
                                            List<Map<String, Object>> rows, long pullRunId,
                                            String timeField, LedgerDao.AmountSpec amountSpec) {
        return ledgerDao.upsertBatch(dsCode, recordKeyExpr, rows, pullRunId, timeField, amountSpec);
    }

    /** fetch_one 单条 upsert。 */
    public LedgerDao.BatchResult upsertOne(String dsCode, String recordKeyExpr,
                                           Map<String, Object> row, long pullRunId,
                                           String timeField, LedgerDao.AmountSpec amountSpec) {
        return ledgerDao.upsertOne(dsCode, recordKeyExpr, row, pullRunId, timeField, amountSpec);
    }

    /**
     * 解析 amount_fields_json 的 primary 字段 → AmountSpec（T04-spec §7.1）。
     * <p>无 primary（V33 aux-only 数据源）→ 全 null AmountSpec（amount 三列均 null）。</p>
     */
    public LedgerDao.AmountSpec resolveAmountSpec(ReconDatasource ds) {
        LedgerDao.AmountSpec spec = new LedgerDao.AmountSpec();
        // amount_fields_json 可空（aux-only / 未配 primary）→ 空 AmountSpec；不可传 null 给 parseObject（会抛 1003）
        String raw = ds.getAmountFieldsJson();
        ObjectNode node = (raw == null || raw.isBlank()) ? null : JsonUtil.parseObject(raw);
        if (node == null) {
            return spec;
        }
        node.fields().forEachRemaining(entry -> {
            JsonNode fieldCfg = entry.getValue();
            if (fieldCfg.isObject() && "primary".equals(fieldCfg.path("role").asText())) {
                spec.primaryField = entry.getKey();
                spec.unit = fieldCfg.path("unit").asText("yuan");
                spec.direction = fieldCfg.path("direction").asText("none");
                spec.signRule = fieldCfg.path("sign_rule").asText(null);
            }
        });
        if (spec.primaryField == null) {
            return spec;
        }
        // sign_rule：字段级优先；缺省按 ds.refund_sign_rule 联动（T04-spec §7.1）
        if (spec.signRule == null || spec.signRule.isBlank()) {
            spec.signRule = resolveRefundSignRule(ds);
        }
        return spec;
    }

    /** same_table_negative → as_is（负数天然）；separate_table → negate；其余 → as_is。 */
    private String resolveRefundSignRule(ReconDatasource ds) {
        String rule = ds.getRefundSignRule();
        if ("separate_table".equals(rule)) {
            return "negate";
        }
        if ("same_table_type_col".equals(rule)) {
            // T04-spec §13 风险 3：refund_flag_expr 行级判定未实现，拒绝启用
            throw new BizException(ErrorCode.PULL_FAILED,
                    "退款形态 same_table_type_col 暂不支持拉取（T04 仅支持 separate_table/同表负数）");
        }
        return "as_is";
    }
}

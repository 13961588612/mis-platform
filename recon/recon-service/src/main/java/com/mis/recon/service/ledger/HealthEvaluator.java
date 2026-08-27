package com.mis.recon.service.ledger;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.util.JsonUtil;

/**
 * 健康度评估（F88，G10 MVP 口径）。
 * <ul>
 *   <li>errorMsg != null → error</li>
 *   <li>rowCount == 0 → empty</li>
 *   <li>行数波动超 row_count_delta_pct（health_rules_json，默认 50）→ degraded</li>
 *   <li>其余 → healthy</li>
 * </ul>
 * <p>null_rate_threshold / deletion_detect 等健康项 T06 扩展（登记 §13 风险 11）。</p>
 */
@org.springframework.stereotype.Service
public class HealthEvaluator {

    /** 评估结果 */
    public static class HealthResult {
        public String status;
        public String detailJson;

        public HealthResult(String status, String detailJson) {
            this.status = status;
            this.detailJson = detailJson;
        }
    }

    public HealthResult eval(ReconDatasource ds, int rowCount, Integer lastSuccessRowCount, String errorMsg) {
        ObjectNode detail = JsonUtil.parseObject("{}");
        detail.put("row_count", rowCount);
        if (errorMsg != null) {
            detail.put("error_msg", errorMsg);
            return new HealthResult("error", detail.toString());
        }
        if (rowCount == 0) {
            return new HealthResult("empty", detail.toString());
        }
        if (lastSuccessRowCount != null && lastSuccessRowCount > 0) {
            int deltaPct = Math.abs(rowCount - lastSuccessRowCount) * 100 / lastSuccessRowCount;
            int threshold = rowCountDeltaPct(ds);
            detail.put("last_row_count", lastSuccessRowCount);
            detail.put("delta_pct", deltaPct);
            if (deltaPct > threshold) {
                return new HealthResult("degraded", detail.toString());
            }
        }
        return new HealthResult("healthy", detail.toString());
    }

    /** health_rules_json.row_count_delta_pct；缺省 50。 */
    private int rowCountDeltaPct(ReconDatasource ds) {
        ObjectNode rules = JsonUtil.parseObject(ds.getHealthRulesJson());
        if (rules != null && rules.hasNonNull("row_count_delta_pct")) {
            return Math.max(0, rules.path("row_count_delta_pct").asInt(50));
        }
        return 50;
    }
}

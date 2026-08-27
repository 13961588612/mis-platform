package com.mis.recon.domain.runtime;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 就绪门配置（T06-spec §4，V1 recon_readiness_gate 行）。
 */
public class GateConfig {

    private final String gateName;
    private final String gateType;      // flag_query / row_count_delta / stability_window / app_callback
    private final String gateSql;
    private final JsonNode configJson;  // gate_config_json（阈值/窗口）
    private final int minWaitMin;
    private final int maxWaitMin;

    public GateConfig(String gateName, String gateType, String gateSql, JsonNode configJson,
                      int minWaitMin, int maxWaitMin) {
        this.gateName = gateName;
        this.gateType = gateType;
        this.gateSql = gateSql;
        this.configJson = configJson;
        this.minWaitMin = minWaitMin;
        this.maxWaitMin = maxWaitMin;
    }

    public String getGateName() {
        return gateName;
    }

    public String getGateType() {
        return gateType;
    }

    public String getGateSql() {
        return gateSql;
    }

    public JsonNode getConfigJson() {
        return configJson;
    }

    public int getMinWaitMin() {
        return minWaitMin;
    }

    public int getMaxWaitMin() {
        return maxWaitMin;
    }
}

package com.mis.recon.dao;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.runtime.GateConfig;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 就绪门配置 DAO（T06-spec §7.4）：按场景读 enabled 的 gate。
 */
@Repository
public class ReadinessGateDao {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ReadinessGateDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    /** 场景 enabled 就绪门（按 gate_name 升序）；无 → 空列表。 */
    public List<GateConfig> findEnabled(String scenarioCode) {
        return jdbcTemplate.query("""
                SELECT gate_name, gate_type, gate_sql, gate_config_json, min_wait_min, max_wait_min
                  FROM recon_readiness_gate
                 WHERE scenario_code = ? AND enabled = 1
                 ORDER BY gate_name
                """, (rs, i) -> {
                    String json = rs.getString("gate_config_json");
                    JsonNode cfg = null;
                    if (json != null && !json.isBlank()) {
                        try {
                            cfg = objectMapper.readTree(json);
                        } catch (Exception e) {
                            cfg = null;
                        }
                    }
                    return new GateConfig(
                            rs.getString("gate_name"),
                            rs.getString("gate_type"),
                            rs.getString("gate_sql"),
                            cfg,
                            rs.getInt("min_wait_min"),
                            rs.getInt("max_wait_min"));
                }, scenarioCode);
    }
}

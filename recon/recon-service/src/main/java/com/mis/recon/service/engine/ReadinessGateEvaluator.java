package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.dao.ReadinessGateDao;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.runtime.GateConfig;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.ScenarioRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 就绪门求值（F89，T06-spec §4）：flag_query / row_count_delta / stability_window 可配置求值；
 * app_callback 未实现（记降级）；max_wait 超时降级（软前置）。
 * <p>接入 PullRunner.run() 入口（G19）：NOT_READY 本轮不拉取，DEGRADED 降级继续。</p>
 */
@Slf4j
@Service
public class ReadinessGateEvaluator {

    public enum GateResult {
        PASS,           // 全部 gate 通过
        NOT_READY,      // 未就绪（min_wait 未到且未超 max_wait）
        DEGRADED        // 超时降级（软前置）
    }

    /** stability_window 两次求值缓存：gateName → (count, checkedAt) */
    private static class StabilityState {
        final long count;
        final long checkedAtMillis;

        StabilityState(long count, long checkedAtMillis) {
            this.count = count;
            this.checkedAtMillis = checkedAtMillis;
        }
    }

    private final ReadinessGateDao gateDao;
    private final ScenarioRepository scenarioRepository;
    private final CheckRepository checkRepository;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final Map<String, StabilityState> stabilityCache = new HashMap<>();
    private final Map<String, Long> firstSeenCache = new HashMap<>();

    public ReadinessGateEvaluator(ReadinessGateDao gateDao,
                                  ScenarioRepository scenarioRepository,
                                  CheckRepository checkRepository,
                                  @Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate,
                                  ObjectMapper objectMapper) {
        this.gateDao = gateDao;
        this.scenarioRepository = scenarioRepository;
        this.checkRepository = checkRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * 按数据源求值（T06-spec §10 风险#1 降级分支）：datasource 表无 scenario_code 列，
     * 从 enabled 场景的 check 消费清单反查引用该 ds 的场景 → 对每个引用场景求值 gate。
     * <p>任一引用场景 NOT_READY → NOT_READY；有 DEGRADED 无 NOT_READY → DEGRADED；否则 PASS。</p>
     */
    public Evaluation evaluateForDs(String dsCode, long nowMillis) {
        boolean anyDegraded = false;
        ObjectNode aggLog = objectMapper.createObjectNode();
        for (ReconScenario scenario : scenarioRepository.findByEnabled(1)) {
            if (!scenarioUsesDs(scenario.getScenarioCode(), dsCode)) {
                continue;
            }
            Evaluation ev = evaluate(scenario.getScenarioCode(), nowMillis);
            aggLog.set(scenario.getScenarioCode(), parseLog(ev.logJson));
            if (ev.result == GateResult.NOT_READY) {
                return new Evaluation(GateResult.NOT_READY, aggLog.toString());
            }
            if (ev.result == GateResult.DEGRADED) {
                anyDegraded = true;
            }
        }
        return new Evaluation(anyDegraded ? GateResult.DEGRADED : GateResult.PASS, aggLog.toString());
    }

    /** 场景任一 check 的 consume_json 引用该 ds（降级反查，MVP 场景量小可遍历） */
    private boolean scenarioUsesDs(String scenarioCode, String dsCode) {
        List<ReconCheck> checks = checkRepository.findByScenarioCodeOrderBySeqNo(scenarioCode);
        for (ReconCheck check : checks) {
            if (consumeContains(check.getConsumeJson(), dsCode)) {
                return true;
            }
        }
        return false;
    }

    private boolean consumeContains(String consumeJson, String dsCode) {
        if (consumeJson == null || consumeJson.isBlank()) {
            return false;
        }
        try {
            JsonNode node = objectMapper.readTree(consumeJson);
            if (node.isArray()) {
                for (JsonNode item : node) {
                    String ds = item.path("ds_code").asText(null);
                    if (dsCode.equals(ds)) {
                        return true;
                    }
                }
            } else if (node.isObject()) {
                // {alias: {ds_code: ...}} 形式
                for (JsonNode item : node) {
                    String ds = item.path("ds_code").asText(null);
                    if (dsCode.equals(ds)) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("parse consume_json failed, treat as no ds ref: {}", e.getMessage());
        }
        return false;
    }

    private JsonNode parseLog(String logJson) {
        try {
            return objectMapper.readTree(logJson);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    /** 求值结果 + readiness_log（供 PullRunner 写入 pull_run 三字段） */
    public static class Evaluation {
        public final GateResult result;
        public final String logJson;   // readiness_log（各 gate 检查结果 JSON）

        public Evaluation(GateResult result, String logJson) {
            this.result = result;
            this.logJson = logJson;
        }
    }

    /**
     * 求值场景全部 enabled gate。
     *
     * @param scenarioCode 场景编码
     * @param nowMillis    当前时间戳（stability_window 窗口判定）
     */
    public Evaluation evaluate(String scenarioCode, long nowMillis) {
        List<GateConfig> gates = gateDao.findEnabled(scenarioCode);
        if (gates.isEmpty()) {
            return new Evaluation(GateResult.PASS, "{}");
        }
        ObjectNode logNode = objectMapper.createObjectNode();
        boolean anyDegraded = false;
        for (GateConfig gate : gates) {
            GateResult r = evaluateGate(gate, nowMillis);
            ObjectNode g = logNode.putObject(gate.getGateName());
            g.put("type", gate.getGateType());
            g.put("result", r.name());
            if (r == GateResult.NOT_READY) {
                return new Evaluation(GateResult.NOT_READY, logNode.toString());
            }
            if (r == GateResult.DEGRADED) {
                anyDegraded = true;
                g.put("degraded_reason", "max_wait exceeded or not supported");
            }
        }
        // 有降级无未就绪 → DEGRADED（软前置，调用方继续拉取但记降级）
        return new Evaluation(anyDegraded ? GateResult.DEGRADED : GateResult.PASS, logNode.toString());
    }

    private GateResult evaluateGate(GateConfig gate, long nowMillis) {
        try {
            switch (gate.getGateType()) {
                case "flag_query":
                    return evalFlagQuery(gate, nowMillis);
                case "row_count_delta":
                    return evalRowCountDelta(gate, nowMillis);
                case "stability_window":
                    return evalStabilityWindow(gate, nowMillis);
                case "app_callback":
                    // T06 未实现真回调：视为未支持 → 超时降级
                    log.warn("gate {} type=app_callback not supported, degraded", gate.getGateName());
                    return GateResult.DEGRADED;
                default:
                    log.warn("gate {} unknown type={}, degraded", gate.getGateName(), gate.getGateType());
                    return GateResult.DEGRADED;
            }
        } catch (Exception e) {
            // gate_sql 执行异常 → 保守 NOT_READY（不拉取），记日志不中断
            log.warn("gate {} evaluate failed, treat as not ready: {}", gate.getGateName(), e.getMessage());
            return GateResult.NOT_READY;
        }
    }

    /** flag_query：gate_sql 第一行第一列 = 1 → 通过 */
    private GateResult evalFlagQuery(GateConfig gate, long nowMillis) {
        if (gate.getGateSql() == null || gate.getGateSql().isBlank()) {
            return GateResult.DEGRADED;
        }
        Long v = jdbcTemplate.queryForObject(gate.getGateSql(), Long.class);
        boolean ready = v != null && v == 1L;
        return settle(gate, ready, nowMillis);
    }

    /** row_count_delta：|count - expected| <= max_delta → 通过 */
    private GateResult evalRowCountDelta(GateConfig gate, long nowMillis) {
        if (gate.getGateSql() == null || gate.getGateSql().isBlank()) {
            return GateResult.DEGRADED;
        }
        long count = jdbcTemplate.queryForObject(gate.getGateSql(), Long.class);
        long expected = longField(gate, "expected", 0);
        long maxDelta = longField(gate, "max_delta", 0);
        boolean ready = Math.abs(count - expected) <= maxDelta;
        return settle(gate, ready, nowMillis);
    }

    /** stability_window：连续 stability_window_min 分钟两次求值相等 → 通过 */
    private GateResult evalStabilityWindow(GateConfig gate, long nowMillis) {
        if (gate.getGateSql() == null || gate.getGateSql().isBlank()) {
            return GateResult.DEGRADED;
        }
        long count = jdbcTemplate.queryForObject(gate.getGateSql(), Long.class);
        long windowMin = longField(gate, "stability_window_min", 10);
        StabilityState prev = stabilityCache.get(gate.getGateName());
        long windowMillis = windowMin * 60_000L;
        if (prev != null && nowMillis - prev.checkedAtMillis >= windowMillis) {
            boolean ready = prev.count == count;
            // 更新缓存，进入下一轮窗口判定
            stabilityCache.put(gate.getGateName(), new StabilityState(count, nowMillis));
            return settle(gate, ready, nowMillis);
        }
        // 窗口未到：记录本次值，视为"等待中"（NOT_READY 或按 min_wait 语义）
        stabilityCache.put(gate.getGateName(), new StabilityState(count, nowMillis));
        return settle(gate, false, nowMillis);
    }

    /**
     * 就绪/未就绪 + max_wait 超时降级（软前置）：
     * <ul>
     *   <li>ready → PASS（就绪即放行；min_wait 稳定性语义由 stability_window 自身承担）；</li>
     *   <li>!ready → 已等待超 max_wait_min → DEGRADED；否则 NOT_READY。</li>
     * </ul>
     */
    private GateResult settle(GateConfig gate, boolean ready, long nowMillis) {
        if (ready) {
            return GateResult.PASS;
        }
        long maxWait = gate.getMaxWaitMin() * 60_000L;
        long wait = nowMillis - firstSeen(gate);
        return maxWait > 0 && wait > maxWait ? GateResult.DEGRADED : GateResult.NOT_READY;
    }

    /** gate 首次进入缓存的时间（max_wait 计时基准）；无缓存 → 记 now 并缓存 */
    private long firstSeen(GateConfig gate) {
        return firstSeenCache.computeIfAbsent(gate.getGateName(), k -> System.currentTimeMillis());
    }

    private long longField(GateConfig gate, String name, long def) {
        JsonNode cfg = gate.getConfigJson();
        if (cfg == null) {
            return def;
        }
        JsonNode v = cfg.get(name);
        return v == null || v.isNull() ? def : v.asLong(def);
    }
}

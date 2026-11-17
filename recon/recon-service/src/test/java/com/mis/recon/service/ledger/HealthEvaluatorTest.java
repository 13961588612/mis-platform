package com.mis.recon.service.ledger;

import com.mis.recon.domain.config.ReconDatasource;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 健康度评估单测（G10 MVP 口径）。
 */
class HealthEvaluatorTest {

    private final HealthEvaluator evaluator = new HealthEvaluator();

    @Test
    void errorWhenMsgPresent() {
        HealthEvaluator.HealthResult r = evaluator.eval(ds(), 100, null, "boom");
        assertEquals("error", r.status);
    }

    @Test
    void emptyWhenZeroRows() {
        HealthEvaluator.HealthResult r = evaluator.eval(ds(), 0, 100, null);
        assertEquals("empty", r.status);
    }

    @Test
    void healthyWhenNoBaseline() {
        HealthEvaluator.HealthResult r = evaluator.eval(ds(), 100, null, null);
        assertEquals("healthy", r.status);
    }

    @Test
    void degradedWhenDeltaExceedsThreshold() {
        // 上次 1000，本次 200（delta 80% > 50%）
        HealthEvaluator.HealthResult r = evaluator.eval(ds(), 200, 1000, null);
        assertEquals("degraded", r.status);
    }

    @Test
    void healthyWhenDeltaWithinThreshold() {
        HealthEvaluator.HealthResult r = evaluator.eval(ds(), 600, 1000, null);
        assertEquals("healthy", r.status);
    }

    private ReconDatasource ds() {
        ReconDatasource ds = new ReconDatasource();
        ds.setHealthRulesJson("{\"row_count_delta_pct\":50}");
        return ds;
    }
}

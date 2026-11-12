package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.SysAuditOp;
import com.mis.taskflow.domain.repository.SysAuditOpRepository;
import com.mis.taskflow.dto.AuditOpDetailVO;
import com.mis.taskflow.dto.AuditOpVO;
import com.mis.taskflow.dto.AuditStatsVO;
import com.mis.taskflow.dto.AuditTimelineItem;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 业务操作审计集成测试（P4）—— 真实库，事务回滚。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class AuditOpServiceIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired
    private AuditOpService auditOpService;

    @Autowired
    private SysAuditOpRepository auditRepository;

    @Autowired
    private AuditProbeService probe;

    @Test
    @DisplayName("P4：切面在成功路径落库，记录 diff 摘要")
    void aspectRecordsSuccess() {
        String bizId = "PROBE-" + System.nanoTime();
        probe.update(bizId, "{\"amount\":50000}", "{\"amount\":65000}");

        List<SysAuditOp> ops = auditRepository
                .findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(1L, "PROBE", bizId);
        assertEquals(1, ops.size(), "成功调用应记录 1 条审计");
        SysAuditOp op = ops.get(0);
        assertEquals(SysAuditOp.SUCCESS, op.getResultStatus());
        assertEquals("UPDATE", op.getOperationType());
        assertEquals("测试模块", op.getModule());
        assertEquals("探针更新", op.getDescription());
        assertTrue(op.getDiffSummary().contains("amount"), "应含字段差异: " + op.getDiffSummary());
        assertNotNull(op.getDurationMs());
    }

    @Test
    @DisplayName("P4：切面在异常路径也落库，记录 FAIL 与错误信息")
    void aspectRecordsFailure() {
        String bizId = "PROBE-FAIL-" + System.nanoTime();
        assertThrows(IllegalStateException.class, () -> probe.failing(bizId));

        List<SysAuditOp> ops = auditRepository
                .findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(1L, "PROBE", bizId);
        assertEquals(1, ops.size(), "异常调用也应记录 1 条审计");
        SysAuditOp op = ops.get(0);
        assertEquals(SysAuditOp.FAIL, op.getResultStatus());
        assertTrue(op.getErrorMsg().contains("模拟业务异常"));
    }

    @Test
    @DisplayName("P4：时间线按业务类型+ID 聚合，按时间升序")
    void timeline() {
        String bizId = "TL-" + System.nanoTime();
        probe.update(bizId, "{\"a\":1}", "{\"a\":2}");
        probe.update(bizId, "{\"a\":2}", "{\"a\":3}");

        List<AuditTimelineItem> timeline = auditOpService.timeline(1L, "PROBE", bizId);
        assertEquals(2, timeline.size(), "应聚合两条历史");
        assertTrue(timeline.get(0).operTime().compareTo(timeline.get(1).operTime()) <= 0, "应按时间升序");
    }

    @Test
    @DisplayName("P4：全空过滤检索（keyword=null）不报错——回归 lower(bytea) 类型推断缺陷")
    void searchAllNullFilters() {
        String bizId = "S-NULL-" + System.nanoTime();
        probe.update(bizId, "{}", "{\"a\":1}");

        // 这是真实 500 的复现路径：所有过滤参数为 null（keyword 为 null 时被 PG 推断为 bytea）
        var page = auditOpService.search(1L, null, null, null, null, null, null, null, null, 1, 20);
        assertTrue(page.getTotal() >= 1, "全空过滤应能正常返回（不抛 500）");
        assertTrue(page.getList().stream().map(AuditOpVO::operationType).anyMatch("UPDATE"::equals));
    }

    @Test
    @DisplayName("P4：关键词检索命中 description")
    void searchByKeyword() {
        String marker = "ZZ" + System.nanoTime();
        String bizId = "S-KW-" + System.nanoTime();
        probe.update(bizId, "{}", "{\"a\":1}");

        var page = auditOpService.search(1L, null, "测试模块", "UPDATE", "PROBE", "SUCCESS", "探针", null, null, 1, 20);
        assertTrue(page.getTotal() >= 1, "关键词+多条件检索应命中");
        assertNotNull(marker);
    }

    @Test
    @DisplayName("P4：统计返回区间内总数与失败数")
    void stats() {
        String bizId = "ST-" + System.nanoTime();
        probe.update(bizId, "{}", "{\"a\":1}");
        assertThrows(IllegalStateException.class, () -> probe.failing(bizId));

        AuditStatsVO stats = auditOpService.stats(1L, 1);
        assertTrue(stats.total() >= 2, "总数应 >= 2");
        assertTrue(stats.failed() >= 1, "失败数应 >= 1");
    }

    @Test
    @DisplayName("P4：详情返回 before/after/diff")
    void detail() {
        String bizId = "DT-" + System.nanoTime();
        probe.update(bizId, "{\"amount\":100}", "{\"amount\":200}");
        Long id = auditRepository
                .findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(1L, "PROBE", bizId)
                .get(0).getId();

        AuditOpDetailVO detail = auditOpService.detail(id, 1L);
        assertTrue(detail.beforeData().contains("100"));
        assertTrue(detail.afterData().contains("200"));
        assertTrue(detail.diffSummary().contains("amount"));
    }

    @Test
    @DisplayName("P4：跨租户查看详情被拒")
    void crossTenantForbidden() {
        String bizId = "XT-" + System.nanoTime();
        probe.update(bizId, "{}", "{\"a\":1}");
        Long id = auditRepository
                .findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(1L, "PROBE", bizId)
                .get(0).getId();
        assertThrows(com.mis.common.core.exception.BusinessException.class,
                () -> auditOpService.detail(id, 999999L));
    }
}
package com.mis.recon.service.report;

import com.mis.recon.service.report.ReportRenderer.ReportRowView;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 报告渲染单测（T07-spec §3.2）：聚合/金额/severity/截断。
 */
class ReportRendererTest {

    private final ReportRenderer renderer = new ReportRenderer();

    private ReportRowView row(long id, String type, long cent) {
        return new ReportRowView(id, "order-" + id, type, "金额不一致", cent, null);
    }

    @Test
    void renderAggregatesTitleBodyAndAmount() {
        List<ReportRowView> rows = List.of(row(1, "field_mismatch", 12345L), row(2, "unmatched_left", 500L));
        ReportContent c = renderer.render("sc1", "线上订单", "order_check", rows);

        assertEquals("【对账报告】线上订单(sc1) - order_check", c.getTitle());
        assertEquals("info", c.getSeverity());
        assertTrue(c.getBody().contains("差异数：2"));
        assertTrue(c.getBody().contains("金额合计：¥128.45"));
        assertTrue(c.getBody().contains("字段不一致"));
        assertTrue(c.getBody().contains("仅左端有"));
        assertEquals(List.of(1L, 2L), c.getDetailIds());
    }

    @Test
    void severityEscalatesByRowCount() {
        List<ReportRowView> warn = new ArrayList<>();
        for (int i = 0; i < 11; i++) {
            warn.add(row(i, "field_mismatch", 1L));
        }
        assertEquals("warn", renderer.render("s", "n", "c", warn).getSeverity());

        List<ReportRowView> critical = new ArrayList<>();
        for (int i = 0; i < 51; i++) {
            critical.add(row(i, "field_mismatch", 1L));
        }
        assertEquals("critical", renderer.render("s", "n", "c", critical).getSeverity());
    }

    @Test
    void longListIsTruncated() {
        List<ReportRowView> rows = new ArrayList<>();
        for (int i = 0; i < 250; i++) {
            rows.add(row(i, "field_mismatch", 1L));
        }
        ReportContent c = renderer.render("sc1", "n", "c", rows);
        assertTrue(c.getBody().contains("… 共 250 条，详见管理端"));
    }
}
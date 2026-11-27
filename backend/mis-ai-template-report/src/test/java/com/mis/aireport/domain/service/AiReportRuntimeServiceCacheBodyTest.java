package com.mis.aireport.domain.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class AiReportRuntimeServiceCacheBodyTest {

    @Test
    void rejectsThinkingFragmentCachedAsDayReport() {
        String junk = """
                I need to load the weekly report skill and calendar to get accurate data.

                2026年-46周（11-16 至 11-22）在清单内，上一周为 45 周。现加载品类销售技能取数。
                """;
        assertTrue(AiReportRuntimeService.isNonReportCacheBody(junk));
    }

    @Test
    void acceptsRealMonthlyReport() {
        String ok = """
                ## 宜兴城中店 · 2026年-10月 · 经营数据综合分析（月报）

                **结论：** 本月主营销售 **528.80 万元**，较上一月下降。
                """;
        assertFalse(AiReportRuntimeService.isNonReportCacheBody(ok));
    }

    @Test
    void rejectsShortAndParamCard() {
        assertTrue(AiReportRuntimeService.isNonReportCacheBody("太短"));
        assertTrue(AiReportRuntimeService.isNonReportCacheBody(
                "请先填写参数卡后再生成报告，占位文字需要超过八十个字符才不会因长度被拒，所以继续写一些无关内容。"));
    }
}

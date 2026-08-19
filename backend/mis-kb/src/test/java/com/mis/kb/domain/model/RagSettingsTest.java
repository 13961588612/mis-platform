package com.mis.kb.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RagSettings RAPTOR 字段默认值与归一化测试（Wave C RAPTOR，T04）。
 *
 * <p>锁定设计 §2.0 / RaptorConfig 常量唯一事实源：
 * <ol>
 *   <li><b>默认值</b>：{@code useRaptor=false}、{@code raptorMaxTokenNum=1024}、
 *       {@code raptorThreshold=0.1}、{@code raptorMaxCluster=64}、
 *       {@code raptorPrompt=官方 prompt}、{@code raptorBuildStatus=none}、
 *       {@code raptorBuildMessage=null}；</li>
 *   <li><b>区间归一</b>：越界一律回落默认（不静默存脏值）——{@code [512,2048]} /
 *       {@code [0,1]} / {@code [1,1024]} / ≤2000；</li>
 *   <li><b>四态白名单</b>：{@code raptorBuildStatus} 只认
 *       none/building/ready/failed；</li>
 *   <li><b>⚠ R6 回归</b>：{@code withGraphOverride} / {@code withRaptorOverride}
 *       必须 26 参 canonical 透传 RAPTOR/图谱字段，禁止走 17 参旧构造静默置 null。</li>
 * </ol>
 */
class RagSettingsTest {

    // ------------------------------------------------------------ 默认值

    @Test
    @DisplayName("defaults()：RAPTOR 七字段默认（false / 1024 / 0.1 / 64 / 官方 prompt / none / null）")
    void defaultsCarryRaptorFields() {
        RagSettings d = RagSettings.defaults();

        assertFalse(d.useRaptor());
        assertEquals(RaptorConfig.DEFAULT_MAX_TOKEN_NUM, d.raptorMaxTokenNum().intValue());
        assertEquals(RaptorConfig.DEFAULT_THRESHOLD, d.raptorThreshold(), 1e-9);
        assertEquals(RaptorConfig.DEFAULT_MAX_CLUSTER, d.raptorMaxCluster().intValue());
        assertEquals(RaptorConfig.DEFAULT_PROMPT, d.raptorPrompt());
        assertEquals(RagSettings.RAPTOR_STATUS_NONE, d.raptorBuildStatus());
        assertNull(d.raptorBuildMessage());
    }

    @Test
    @DisplayName("withDefaults()：null RAPTOR 字段补齐默认（存量 JSON 无字段也能安全读取）")
    void withDefaultsFillsNullRaptorFields() {
        RagSettings empty = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null);

        RagSettings d = empty.withDefaults();

        assertFalse(d.useRaptor());
        assertEquals(RaptorConfig.DEFAULT_MAX_TOKEN_NUM, d.raptorMaxTokenNum().intValue());
        assertEquals(RaptorConfig.DEFAULT_THRESHOLD, d.raptorThreshold(), 1e-9);
        assertEquals(RaptorConfig.DEFAULT_MAX_CLUSTER, d.raptorMaxCluster().intValue());
        assertEquals(RaptorConfig.DEFAULT_PROMPT, d.raptorPrompt());
        assertEquals(RagSettings.RAPTOR_STATUS_NONE, d.raptorBuildStatus());
    }

    // ------------------------------------------------------------ 区间归一

    @Test
    @DisplayName("withDefaults()：raptorMaxTokenNum 越界（4096 / 511）回落默认 1024，不存脏值")
    void outOfRangeMaxTokenNumFallsBack() {
        RagSettings over = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, 4096, null, null, null, null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_MAX_TOKEN_NUM, over.withDefaults().raptorMaxTokenNum().intValue(),
                "4096 是引擎 code:101 拒收值（T00 P1b），归一化必须回落默认");

        RagSettings under = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, 511, null, null, null, null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_MAX_TOKEN_NUM, under.withDefaults().raptorMaxTokenNum().intValue());
    }

    @Test
    @DisplayName("withDefaults()：raptorThreshold 越界（1.5 / -0.1）回落默认 0.1")
    void outOfRangeThresholdFallsBack() {
        RagSettings over = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, null, 1.5D, null, null, null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_THRESHOLD, over.withDefaults().raptorThreshold(), 1e-9);

        RagSettings under = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, null, -0.1D, null, null, null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_THRESHOLD, under.withDefaults().raptorThreshold(), 1e-9);
    }

    @Test
    @DisplayName("withDefaults()：raptorMaxCluster 越界（0 / 1025）回落默认 64")
    void outOfRangeMaxClusterFallsBack() {
        RagSettings over = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, null, null, 1025, null, null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_MAX_CLUSTER, over.withDefaults().raptorMaxCluster().intValue());

        RagSettings under = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, null, null, 0, null, null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_MAX_CLUSTER, under.withDefaults().raptorMaxCluster().intValue());
    }

    @Test
    @DisplayName("withDefaults()：raptorPrompt 空串回落官方 prompt；非空原样保留（不截断）")
    void promptBlankFallsBackToDefault() {
        RagSettings blank = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, null, null, null, "", null, null, null, null);
        assertEquals(RaptorConfig.DEFAULT_PROMPT, blank.withDefaults().raptorPrompt());

        RagSettings custom = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                true, null, null, null, " 自定义 ", null, null, null, null);
        assertEquals(" 自定义 ", custom.withDefaults().raptorPrompt(),
                "非空 prompt 原样保留（引擎不强制占位符，T00 P1g）");
    }

    // ------------------------------------------------------------ 四态白名单

    @Test
    @DisplayName("normalizeRaptorBuildStatus：四态合法值原样；非法/空回落 none")
    void normalizeRaptorBuildStatusWhitelist() {
        assertEquals("none", RagSettings.normalizeRaptorBuildStatus("none"));
        assertEquals("building", RagSettings.normalizeRaptorBuildStatus("building"));
        assertEquals("ready", RagSettings.normalizeRaptorBuildStatus("ready"));
        assertEquals("failed", RagSettings.normalizeRaptorBuildStatus("failed"));
        assertEquals(RagSettings.RAPTOR_STATUS_NONE, RagSettings.normalizeRaptorBuildStatus("paused"));
        assertEquals(RagSettings.RAPTOR_STATUS_NONE, RagSettings.normalizeRaptorBuildStatus(null));
        assertEquals(RagSettings.RAPTOR_STATUS_NONE, RagSettings.normalizeRaptorBuildStatus("  "));
    }

    // ------------------------------------------------------------ ⚠ R6 回归：26 参 canonical 透传

    @Test
    @DisplayName("withGraphOverride：只改图谱开关，RAPTOR 七字段原样透传（禁止 17 参旧构造静默置 null）")
    void graphOverridePreservesRaptorFields() {
        RagSettings base = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, false, RagSettings.KG_STATUS_NONE, null,
                true, 1536, 0.25D, 128, "custom prompt", RagSettings.RAPTOR_STATUS_READY, "msg",
                Boolean.TRUE, 300);

        RagSettings overridden = base.withGraphOverride(true);

        assertTrue(overridden.useKnowledgeGraph());
        assertEquals(RagSettings.KG_STATUS_NONE, overridden.kgBuildStatus());
        assertTrue(overridden.useRaptor(), "withGraphOverride 必须透传 useRaptor（R6 教训）");
        assertEquals(1536, overridden.raptorMaxTokenNum().intValue());
        assertEquals(0.25D, overridden.raptorThreshold(), 1e-9);
        assertEquals(128, overridden.raptorMaxCluster().intValue());
        assertEquals("custom prompt", overridden.raptorPrompt());
        assertEquals(RagSettings.RAPTOR_STATUS_READY, overridden.raptorBuildStatus());
        assertEquals("msg", overridden.raptorBuildMessage());
        assertTrue(overridden.pageIndex(), "withGraphOverride 必须透传 pageIndex（26 参 canonical）");
        assertEquals(300, overridden.imageTableContextWindow().intValue(),
                "withGraphOverride 必须透传 imageTableContextWindow（26 参 canonical）");
    }

    @Test
    @DisplayName("withRaptorOverride：只改 RAPTOR 开关，图谱三字段原样透传")
    void raptorOverridePreservesGraphFields() {
        RagSettings base = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, true, RagSettings.KG_STATUS_READY, "graph-msg",
                false, 1024, 0.1D, 64, null, RagSettings.RAPTOR_STATUS_NONE, null,
                Boolean.FALSE, 300);

        RagSettings overridden = base.withRaptorOverride(true);

        assertTrue(overridden.useRaptor());
        assertTrue(overridden.useKnowledgeGraph(), "withRaptorOverride 必须透传图谱开关");
        assertEquals(RagSettings.KG_STATUS_READY, overridden.kgBuildStatus());
        assertEquals("graph-msg", overridden.kgBuildMessage());
        assertEquals(RagSettings.RAPTOR_STATUS_NONE, overridden.raptorBuildStatus(),
                "构建状态保持原值（降级判定由 Resolver S4.6 从库设置读取）");
        assertFalse(overridden.pageIndex(), "withRaptorOverride 必须透传 pageIndex（26 参 canonical）");
        assertEquals(300, overridden.imageTableContextWindow().intValue(),
                "withRaptorOverride 必须透传 imageTableContextWindow（26 参 canonical）");
    }

    // ------------------------------------------------------------ 解析器增量（pageIndex / imageTableContextWindow）

    @Test
    @DisplayName("defaults()：pageIndex=true / imageTableContextWindow=256")
    void defaultsCarryParserIncrementFields() {
        RagSettings d = RagSettings.defaults();

        assertTrue(d.pageIndex(), "defaults() 必须带 pageIndex=true（用户要求默认开启 TOC 提取）");
        assertEquals(RagSettings.DEFAULT_IMAGE_TABLE_CONTEXT_WINDOW,
                d.imageTableContextWindow().intValue(),
                "defaults() 必须带 imageTableContextWindow=256");
    }

    @Test
    @DisplayName("withDefaults()：null pageIndex / imageTableContextWindow 补齐默认（存量 JSON 无字段也能安全读取）")
    void withDefaultsFillsParserIncrementFields() {
        RagSettings empty = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null);

        RagSettings d = empty.withDefaults();

        assertTrue(d.pageIndex(), "pageIndex null → 默认 true");
        assertEquals(RagSettings.DEFAULT_IMAGE_TABLE_CONTEXT_WINDOW,
                d.imageTableContextWindow().intValue(),
                "imageTableContextWindow null → 默认 256");
    }

    @Test
    @DisplayName("withDefaults()：imageTableContextWindow 越界（0 / -1 / 4097）回落默认 256，不存脏值")
    void outOfRangeImageTableContextWindowFallsBack() {
        RagSettings zero = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, 0);
        assertEquals(RagSettings.DEFAULT_IMAGE_TABLE_CONTEXT_WINDOW,
                zero.withDefaults().imageTableContextWindow().intValue(),
                "imageTableContextWindow=0（非正整数）→ 归一回落 256");

        RagSettings negative = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, -1);
        assertEquals(RagSettings.DEFAULT_IMAGE_TABLE_CONTEXT_WINDOW,
                negative.withDefaults().imageTableContextWindow().intValue(),
                "imageTableContextWindow=-1 → 归一回落 256");

        RagSettings over = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, 4097);
        assertEquals(RagSettings.DEFAULT_IMAGE_TABLE_CONTEXT_WINDOW,
                over.withDefaults().imageTableContextWindow().intValue(),
                "imageTableContextWindow=4097 → 归一回落 256");
    }

    @Test
    @DisplayName("normalizeImageTableContextWindow：区间 [1,4096] 原样；null/越界回落 256")
    void normalizeImageTableContextWindowBoundaries() {
        assertEquals(256, RagSettings.normalizeImageTableContextWindow(null).intValue());
        assertEquals(1, RagSettings.normalizeImageTableContextWindow(1).intValue());
        assertEquals(256, RagSettings.normalizeImageTableContextWindow(256).intValue());
        assertEquals(4096, RagSettings.normalizeImageTableContextWindow(4096).intValue());
        assertEquals(256, RagSettings.normalizeImageTableContextWindow(0).intValue());
        assertEquals(256, RagSettings.normalizeImageTableContextWindow(-10).intValue());
        assertEquals(256, RagSettings.normalizeImageTableContextWindow(4097).intValue());
    }

    @Test
    @DisplayName("withDefaults()：pageIndex=false / imageTableContextWindow 合法值原样保留（不做静默改写）")
    void explicitParserIncrementFieldsPreserved() {
        RagSettings custom = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                Boolean.FALSE, 512, null, null, null);

        RagSettings d = custom.withDefaults();

        assertFalse(d.pageIndex(), "pageIndex=false 原样保留（默认只兜 null，不静默改写）");
        assertEquals(512, d.imageTableContextWindow().intValue(), "合法值 512 原样保留");
    }

    // ------------------------------------------------------------ 切片参数对齐（T1：overlapPercent / autoKeywords / autoQuestions）

    @Test
    @DisplayName("defaults()：overlapPercent=0.0 / autoKeywords=0 / autoQuestions=0（三新字段默认）")
    void defaultsCarryT1Fields() {
        RagSettings d = RagSettings.defaults();

        assertEquals(RagSettings.DEFAULT_OVERLAP_PERCENT, d.overlapPercent(), 1e-9,
                "defaults() 必须带 overlapPercent=0.0（关闭）");
        assertEquals(Integer.valueOf(RagSettings.DEFAULT_AUTO_KEYWORDS), d.autoKeywords(),
                "defaults() 必须带 autoKeywords=0（关闭）");
        assertEquals(Integer.valueOf(RagSettings.DEFAULT_AUTO_QUESTIONS), d.autoQuestions(),
                "defaults() 必须带 autoQuestions=0（关闭）");
    }

    @Test
    @DisplayName("withDefaults()：null 三新字段补齐默认（存量 JSON 无字段也能安全读取）")
    void withDefaultsFillsNullT1Fields() {
        RagSettings empty = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null);

        RagSettings d = empty.withDefaults();

        assertEquals(0.0D, d.overlapPercent(), 1e-9, "overlapPercent null → 默认 0.0");
        assertEquals(Integer.valueOf(0), d.autoKeywords(), "autoKeywords null → 默认 0");
        assertEquals(Integer.valueOf(0), d.autoQuestions(), "autoQuestions null → 默认 0");
    }

    @Test
    @DisplayName("withDefaults()：显式合法三新字段原样保留（不做静默改写）；0 合法 = 关闭")
    void explicitT1FieldsPreserved() {
        RagSettings custom = new RagSettings(null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null,
                25.0D, 8, 5);

        RagSettings d = custom.withDefaults();

        assertEquals(25.0D, d.overlapPercent(), 1e-9, "overlapPercent=25.0 原样保留");
        assertEquals(Integer.valueOf(8), d.autoKeywords(), "autoKeywords=8 原样保留");
        assertEquals(Integer.valueOf(5), d.autoQuestions(), "autoQuestions=5 原样保留");
    }

    @Test
    @DisplayName("normalizeOverlapPercent：越界（101 / -1）回落 0.0，边界 [0,100] 原样")
    void normalizeOverlapPercentBoundaries() {
        assertEquals(0.0D, RagSettings.normalizeOverlapPercent(null), 1e-9);
        assertEquals(0.0D, RagSettings.normalizeOverlapPercent(0.0D), 1e-9);
        assertEquals(100.0D, RagSettings.normalizeOverlapPercent(100.0D), 1e-9);
        assertEquals(50.0D, RagSettings.normalizeOverlapPercent(50.0D), 1e-9);
        assertEquals(0.0D, RagSettings.normalizeOverlapPercent(101.0D), 1e-9,
                "101 → 回落默认 0.0（不静默截断到 100）");
        assertEquals(0.0D, RagSettings.normalizeOverlapPercent(-1.0D), 1e-9);
    }

    @Test
    @DisplayName("normalizeAutoKeywords / normalizeAutoQuestions：越界（33 / 11）回落默认，0 合法")
    void normalizeAutoKeysBoundaries() {
        assertEquals(Integer.valueOf(0), RagSettings.normalizeAutoKeywords(null));
        assertEquals(Integer.valueOf(0), RagSettings.normalizeAutoKeywords(0));
        assertEquals(Integer.valueOf(32), RagSettings.normalizeAutoKeywords(32));
        assertEquals(Integer.valueOf(0), RagSettings.normalizeAutoKeywords(33),
                "33 > 32 → 回落默认 0（不静默截断）");

        assertEquals(Integer.valueOf(0), RagSettings.normalizeAutoQuestions(null));
        assertEquals(Integer.valueOf(0), RagSettings.normalizeAutoQuestions(0));
        assertEquals(Integer.valueOf(10), RagSettings.normalizeAutoQuestions(10));
        assertEquals(Integer.valueOf(0), RagSettings.normalizeAutoQuestions(11),
                "11 > 10 → 回落默认 0（不静默截断）");
    }
}

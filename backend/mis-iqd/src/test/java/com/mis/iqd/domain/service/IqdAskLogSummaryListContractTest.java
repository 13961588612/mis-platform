package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.iqd.api.dto.IqdAskLogVO;
import com.mis.iqd.domain.entity.IqdAskLog;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import com.mis.iqd.domain.repository.IqdTableAclRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@code /traces} 列表瘦身契约测试（W3 审计回查）。
 *
 * <p><b>为什么必须瘦身</b>：审计明细里的 {@code plan_steps} / {@code resolved_scope} /
 * {@code sql_text} 是长 JSON 字符串。实测 {@code limit=100} 时三项合计约 200KB，
 * 占响应 90%；它们只有<b>详情页</b>需要。列表带上它们会让响应逼近 BFF WebClient
 * 的缓冲上限（历史上因此报过「下游调用失败: HTTP 200」），且随审计量持续放大。
 *
 * <p>本测试是防回退守卫：
 * <ul>
 *   <li>列表只回短字段，<b>不含</b> plan_steps / resolved_scope / sql_text /
 *       wren_status_trail / citations / masked_columns / summary / sql_dialect；</li>
 *   <li>详情（{@link IqdAdminService#getAskLog}）仍回<b>全量</b>字段。</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class IqdAskLogSummaryListContractTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdAskLogRepository askLogRepository;
    @Mock IqdCatalogItemRepository catalogItemRepository;
    @Mock IqdScopePolicyRepository scopePolicyRepository;
    @Mock IqdTableAclRepository tableAclRepository;
    @Mock IqdMaskRuleRepository maskRuleRepository;
    @Mock IqdRowScopeDimensionRepository dimensionRepository;
    @Mock IqdSqlPairRepository sqlPairRepository;
    @Mock IqdKnowledgeRepository knowledgeRepository;
    @Mock IqdSyncJobRepository syncJobRepository;
    @Mock ObjectMapper objectMapper;

    @InjectMocks
    IqdAdminService service;

    private static IqdAskLog sampleLog() {
        IqdAskLog e = new IqdAskLog();
        e.setId(7L);
        e.setTraceId("tr-1");
        e.setSessionId("s-1");
        e.setQueryId("q-1");
        e.setUserId(1L);
        e.setEmployeeId("E1");
        e.setQuestion("今年3月各门店销售");
        e.setStatus("succeeded");
        e.setRowCount(32);
        e.setLatencyMs(1234L);
        e.setErrorCode(null);
        e.setViewMode("admin");
        e.setCreatedAt(Instant.parse("2026-03-01T00:00:00Z"));
        // 重字段：列表必须剥掉，详情必须保留
        e.setPlanSteps("[{\"seq\":1,\"code\":\"scope_check\",\"label\":\"l\",\"status\":\"done\"}]");
        e.setResolvedScope("{\"decision\":\"allow\",\"allowed_item_keys\":[\"a\",\"b\"]}");
        e.setSqlText("SELECT 1");
        e.setWrenStatusTrail("[]");
        e.setCitations("[]");
        e.setMaskedColumns("[]");
        e.setSummary("查询返回 32 行");
        e.setSqlDialect("doris");
        return e;
    }

    @Test
    @DisplayName("列表只回短字段：plan_steps/resolved_scope/sql_text 等重字段必须为 null")
    void listStripsHeavyFields() {
        // 走 status 过滤分支（findAll(Sort) 有重载歧义，any() 会编译不过）。
        when(askLogRepository.findByStatusOrderByCreatedAtDescIdDesc("succeeded"))
                .thenReturn(List.of(sampleLog()));

        List<IqdAskLogVO> rows = service.listAskLogs(100, "succeeded", null);

        assertThat(rows).hasSize(1);
        IqdAskLogVO vo = rows.get(0);
        // 列表页真正用到的短字段保留
        assertThat(vo.getId()).isEqualTo(7L);
        assertThat(vo.getQuestion()).isEqualTo("今年3月各门店销售");
        assertThat(vo.getStatus()).isEqualTo("succeeded");
        assertThat(vo.getLatencyMs()).isEqualTo(1234L);
        assertThat(vo.getCreatedAt()).isEqualTo(Instant.parse("2026-03-01T00:00:00Z"));
        // 重字段被剥离
        assertThat(vo.getPlanSteps()).isNull();
        assertThat(vo.getResolvedScope()).isNull();
        assertThat(vo.getSqlText()).isNull();
        assertThat(vo.getWrenStatusTrail()).isNull();
        assertThat(vo.getCitations()).isNull();
        assertThat(vo.getMaskedColumns()).isNull();
        assertThat(vo.getSummary()).isNull();
        assertThat(vo.getSqlDialect()).isNull();
    }

    @Test
    @DisplayName("详情仍回全量字段（含 SQL / 计划 / 引用）")
    void detailKeepsHeavyFields() {
        when(askLogRepository.findById(7L)).thenReturn(java.util.Optional.of(sampleLog()));

        IqdAskLogVO vo = service.getAskLog(7L);

        assertThat(vo.getPlanSteps()).contains("scope_check");
        assertThat(vo.getResolvedScope()).contains("allowed_item_keys");
        assertThat(vo.getSqlText()).isEqualTo("SELECT 1");
        assertThat(vo.getSqlDialect()).isEqualTo("doris");
        assertThat(vo.getSummary()).isEqualTo("查询返回 32 行");
    }
}

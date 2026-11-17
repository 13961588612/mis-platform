package com.mis.recon.service.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconCompareRule;
import com.mis.recon.domain.config.ReconMatchRule;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.dto.CheckSaveReq;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.CompareRuleRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.MatchRuleRepository;
import com.mis.recon.repository.ScenarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.Collections;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;

/**
 * CheckService 单测（mock Repository 层，验证三表事务/级联删除/uses_json 回写）。
 */
class CheckServiceTest {

    private CheckRepository checkRepository;
    private MatchRuleRepository matchRuleRepository;
    private CompareRuleRepository compareRuleRepository;
    private ScenarioRepository scenarioRepository;
    private DatasourceRepository datasourceRepository;
    private ConfigValidationService configValidationService;
    private CheckService checkService;

    @BeforeEach
    void setUp() {
        checkRepository = Mockito.mock(CheckRepository.class);
        matchRuleRepository = Mockito.mock(MatchRuleRepository.class);
        compareRuleRepository = Mockito.mock(CompareRuleRepository.class);
        scenarioRepository = Mockito.mock(ScenarioRepository.class);
        datasourceRepository = Mockito.mock(DatasourceRepository.class);
        configValidationService = Mockito.mock(ConfigValidationService.class);
        checkService = new CheckService(checkRepository, matchRuleRepository, compareRuleRepository,
                scenarioRepository, datasourceRepository, configValidationService, new ObjectMapper());
    }

    @Test
    void saveCheckWritesThreeTables() {
        Mockito.when(checkRepository.existsByScenarioCodeAndCheckName("online_order", "c1")).thenReturn(false);
        Mockito.when(checkRepository.findByScenarioCodeOrderBySeqNo("online_order")).thenReturn(Collections.emptyList());
        Mockito.when(scenarioRepository.findByScenarioCode("online_order")).thenReturn(Optional.of(new ReconScenario()));

        checkService.saveCheck(sampleReq());

        Mockito.verify(checkRepository).save(any(ReconCheck.class));
        Mockito.verify(matchRuleRepository).save(any(ReconMatchRule.class));
        Mockito.verify(compareRuleRepository).save(any(ReconCompareRule.class));
        Mockito.verify(scenarioRepository).save(any(ReconScenario.class));
    }

    @Test
    void deleteCheckCascades() {
        ReconCheck check = new ReconCheck();
        check.setScenarioCode("online_order");
        check.setCheckName("c1");
        Mockito.when(checkRepository.findByScenarioCodeAndCheckName("online_order", "c1")).thenReturn(Optional.of(check));
        Mockito.when(checkRepository.findByScenarioCodeOrderBySeqNo("online_order")).thenReturn(Collections.emptyList());
        Mockito.when(scenarioRepository.findByScenarioCode("online_order")).thenReturn(Optional.of(new ReconScenario()));

        checkService.deleteCheck("online_order", "c1");

        Mockito.verify(matchRuleRepository).deleteByScenarioCodeAndCheckName("online_order", "c1");
        Mockito.verify(compareRuleRepository).deleteByScenarioCodeAndCheckName("online_order", "c1");
        Mockito.verify(checkRepository).delete(check);
        Mockito.verify(scenarioRepository).save(any(ReconScenario.class));
    }

    @Test
    void saveCheckRewritesUsesJson() {
        AtomicReference<ReconCheck> saved = new AtomicReference<>();
        Mockito.when(checkRepository.existsByScenarioCodeAndCheckName("online_order", "c1")).thenReturn(false);
        Mockito.doAnswer(inv -> {
            saved.set(inv.getArgument(0));
            return inv.getArgument(0);
        }).when(checkRepository).save(any(ReconCheck.class));
        Mockito.when(checkRepository.findByScenarioCodeOrderBySeqNo("online_order"))
                .thenAnswer(inv -> saved.get() == null ? Collections.emptyList() : Collections.singletonList(saved.get()));
        ReconScenario scenario = new ReconScenario();
        Mockito.when(scenarioRepository.findByScenarioCode("online_order")).thenReturn(Optional.of(scenario));

        checkService.saveCheck(sampleReq());

        ArgumentCaptor<ReconScenario> captor = ArgumentCaptor.forClass(ReconScenario.class);
        Mockito.verify(scenarioRepository).save(captor.capture());
        String usesJson = captor.getValue().getUsesJson();
        assertTrue(usesJson != null);
        assertTrue(usesJson.contains("\"ds\":\"huadi2_order\""));
        assertTrue(usesJson.contains("\"alias\":\"orders\""));
        assertTrue(usesJson.contains("\"use_fields\":[]"));
    }

    @Test
    void saveCheckCopiesConsumeAliasToDatasetsWhenBlank() {
        Mockito.when(checkRepository.existsByScenarioCodeAndCheckName("online_order", "c1")).thenReturn(false);
        Mockito.when(checkRepository.findByScenarioCodeOrderBySeqNo("online_order")).thenReturn(Collections.emptyList());
        Mockito.when(scenarioRepository.findByScenarioCode("online_order")).thenReturn(Optional.of(new ReconScenario()));

        checkService.saveCheck(sampleReq());

        ArgumentCaptor<ReconMatchRule> captor = ArgumentCaptor.forClass(ReconMatchRule.class);
        Mockito.verify(matchRuleRepository).save(captor.capture());
        assertEquals("[\"orders\"]", captor.getValue().getDatasetsJson());
    }

    private CheckSaveReq sampleReq() {
        CheckSaveReq req = new CheckSaveReq();
        req.setScenarioCode("online_order");
        req.setCheckName("c1");
        req.setSeqNo(1);
        req.setConsumeJson("{\"orders\":{\"ds_code\":\"huadi2_order\",\"mode\":\"incremental\"}}");
        CheckSaveReq.MatchRuleReq match = new CheckSaveReq.MatchRuleReq();
        match.setStrategy("exact_key");
        match.setKeyFieldsJson("{\"orders\":\"{order_no}\"}");
        req.setMatchRule(match);
        CheckSaveReq.CompareRuleReq compare = new CheckSaveReq.CompareRuleReq();
        compare.setRulesJson("[{\"name\":\"amount\",\"tolerance\":1}]");
        req.setCompareRule(compare);
        return req;
    }
}

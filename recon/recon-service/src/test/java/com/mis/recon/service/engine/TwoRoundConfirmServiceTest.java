package com.mis.recon.service.engine;

import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.repository.ScenarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * 两轮确认巡检单测（T06-spec §3）：peer_advanced / timeout 双分支 + 乐观升级。
 */
class TwoRoundConfirmServiceTest {

    private DetailDao detailDao;
    private PullRunDao pullRunDao;
    private ScenarioRepository scenarioRepository;
    private TwoRoundConfirmService service;

    @BeforeEach
    void setUp() {
        detailDao = Mockito.mock(DetailDao.class);
        pullRunDao = Mockito.mock(PullRunDao.class);
        scenarioRepository = Mockito.mock(ScenarioRepository.class);
        service = new TwoRoundConfirmService(detailDao, pullRunDao, scenarioRepository);
    }

    private DetailDao.PendingRow pending(long id, String scenario, String peerDs, Long peerId,
                                         LocalDateTime pendingAt) {
        return new DetailDao.PendingRow(id, scenario, "ck1", peerDs, peerId, pendingAt);
    }

    private ReconScenario scenario(int waitHours) {
        ReconScenario s = new ReconScenario();
        s.setScenarioCode("sc");
        s.setPendingMaxWaitHours(waitHours);
        return s;
    }

    @Test
    void peerAdvancedUpgrades() {
        LocalDateTime now = LocalDateTime.now();
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(1, "sc", "right", 100L, now.minusHours(1))));
        when(pullRunDao.findMaxSuccessId("right")).thenReturn(150L);   // 越过 100
        when(detailDao.confirmPending(1, "peer_advanced")).thenReturn(1);
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.of(scenario(24)));

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(1, stats.scanned);
        assertEquals(1, stats.upgradedPeer);
        assertEquals(0, stats.upgradedTimeout);
        Mockito.verify(detailDao).confirmPending(1, "peer_advanced");
    }

    @Test
    void peerNotAdvancedStaysPending() {
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(1, "sc", "right", 100L, LocalDateTime.now().minusHours(1))));
        when(pullRunDao.findMaxSuccessId("right")).thenReturn(100L);   // 未越过
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.of(scenario(24)));

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(1, stats.scanned);
        assertEquals(0, stats.upgradedPeer);
        assertEquals(0, stats.upgradedTimeout);
        Mockito.verify(detailDao, Mockito.never()).confirmPending(anyLong(), anyString());
    }

    @Test
    void timeoutUpgrades() {
        LocalDateTime pendingAt = LocalDateTime.now().minusHours(30);
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(2, "sc", "right", 100L, pendingAt)));
        when(pullRunDao.findMaxSuccessId("right")).thenReturn(100L);   // 对端未动
        when(detailDao.confirmPending(2, "timeout")).thenReturn(1);
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.of(scenario(24)));

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(1, stats.upgradedTimeout);
        Mockito.verify(detailDao).confirmPending(2, "timeout");
    }

    @Test
    void timeoutNotReachedStaysPending() {
        LocalDateTime pendingAt = LocalDateTime.now().minusHours(1);   // 1h < 24h
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(2, "sc", "right", null, pendingAt)));
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.of(scenario(24)));

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(1, stats.scanned);
        assertEquals(0, stats.total());
        Mockito.verify(detailDao, Mockito.never()).confirmPending(anyLong(), anyString());
    }

    @Test
    void peerIdNullFallsThroughToTimeout() {
        // 首次 pending 时对端 MAX 为 0 → pendingPeerPullRunId=null，条件① 跳过，走条件②
        LocalDateTime pendingAt = LocalDateTime.now().minusHours(30);
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(3, "sc", "right", null, pendingAt)));
        when(detailDao.confirmPending(3, "timeout")).thenReturn(1);
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.of(scenario(24)));

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(1, stats.upgradedTimeout);
        Mockito.verify(detailDao, Mockito.never()).confirmPending(eq(3L), eq("peer_advanced"));
    }

    @Test
    void concurrentFlowPreventsDoubleUpgrade() {
        // confirmPending 返回 0（已被对账引擎流转）→ 不计入升级
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(1, "sc", "right", 100L, LocalDateTime.now().minusHours(1))));
        when(pullRunDao.findMaxSuccessId("right")).thenReturn(150L);
        when(detailDao.confirmPending(1, "peer_advanced")).thenReturn(0);
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.of(scenario(24)));

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(0, stats.upgradedPeer);
        assertEquals(0, stats.total());
    }

    @Test
    void missingScenarioDefaultsTo24Hours() {
        when(detailDao.scanPending()).thenReturn(List.of(
                pending(2, "sc", "right", null, LocalDateTime.now().minusHours(25))));
        when(scenarioRepository.findByScenarioCode("sc")).thenReturn(Optional.empty());  // 场景不存在 → 默认 24
        when(detailDao.confirmPending(2, "timeout")).thenReturn(1);

        TwoRoundConfirmService.ConfirmStats stats = service.scan();

        assertEquals(1, stats.upgradedTimeout);
        Mockito.verify(detailDao).confirmPending(2, "timeout");
    }
}

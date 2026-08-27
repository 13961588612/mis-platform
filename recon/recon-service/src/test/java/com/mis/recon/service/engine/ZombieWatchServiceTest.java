package com.mis.recon.service.engine;

import com.mis.recon.dao.PullRunDao;
import com.mis.recon.dao.ReconRunDao;
import com.mis.recon.service.alert.OpsAlertService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 僵尸巡检单测（T06-spec §6）：running 超 30 分钟置 failed；T07 后僵尸触发 ops 告警。
 */
class ZombieWatchServiceTest {

    private PullRunDao pullRunDao;
    private ReconRunDao reconRunDao;
    private OpsAlertService opsAlertService;
    private ZombieWatchService service;

    @BeforeEach
    void setUp() {
        pullRunDao = Mockito.mock(PullRunDao.class);
        reconRunDao = Mockito.mock(ReconRunDao.class);
        opsAlertService = Mockito.mock(OpsAlertService.class);
        service = new ZombieWatchService(pullRunDao, reconRunDao, opsAlertService);
    }

    @Test
    void marksPullAndReconZombies() {
        when(pullRunDao.scanRunningOlderThan(30)).thenReturn(List.of(11L, 12L));
        when(reconRunDao.scanRunningOlderThan(30)).thenReturn(List.of(21L));

        ZombieWatchService.ZombieStats stats = service.scan();

        assertEquals(2, stats.pullFailed);
        assertEquals(1, stats.reconFailed);
        verify(pullRunDao).finishFailed(11L, "zombie timeout (>30min)", null);
        verify(pullRunDao).finishFailed(12L, "zombie timeout (>30min)", null);
        verify(reconRunDao).finishRun(21L, "failed", 0, 0, 0, java.util.Map.of(),
                "zombie timeout (>30min)");
        verify(opsAlertService).alertOps(Mockito.anyString(), Mockito.anyString(), Mockito.eq("critical"));
    }

    @Test
    void noZombiesNoOps() {
        when(pullRunDao.scanRunningOlderThan(30)).thenReturn(List.of());
        when(reconRunDao.scanRunningOlderThan(30)).thenReturn(List.of());

        ZombieWatchService.ZombieStats stats = service.scan();

        assertEquals(0, stats.pullFailed);
        assertEquals(0, stats.reconFailed);
        Mockito.verify(pullRunDao, Mockito.never()).finishFailed(Mockito.anyLong(),
                Mockito.anyString(), Mockito.any());
        Mockito.verify(reconRunDao, Mockito.never()).finishRun(Mockito.anyLong(),
                Mockito.anyString(), Mockito.anyInt(), Mockito.anyInt(), Mockito.anyInt(),
                Mockito.any(), Mockito.anyString());
        Mockito.verify(opsAlertService, Mockito.never()).alertOps(Mockito.anyString(),
                Mockito.anyString(), Mockito.anyString());
    }
}

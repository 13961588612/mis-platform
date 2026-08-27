package com.mis.recon.service.alert;

import com.mis.recon.dao.AlertLogDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 告警留痕单测（T07-spec §4）：指纹生成一致性 / 查重。
 */
class AlertLogServiceTest {

    private AlertLogDao dao;
    private AlertLogService service;

    @BeforeEach
    void setUp() {
        dao = mock(AlertLogDao.class);
        service = new AlertLogService(dao);
    }

    @Test
    void fingerprintStableRegardlessOfIdOrder() {
        String a = service.fingerprint("sc", "ck", List.of(3L, 1L, 2L), "info");
        String b = service.fingerprint("sc", "ck", List.of(1L, 2L, 3L), "info");
        assertEquals(a, b);
    }

    @Test
    void fingerprintDiffersAcrossFields() {
        String a = service.fingerprint("sc", "ck", List.of(1L), "info");
        String b = service.fingerprint("sc", "ck", List.of(1L), "warn");
        assertFalse(a.equals(b));
    }

    @Test
    void existsDefersToDao() {
        when(dao.existsByFingerprint("fp")).thenReturn(true);
        assertTrue(service.exists("fp"));
        assertFalse(service.exists("fp2"));
    }

    @Test
    void recordWritesAlertLog() {
        service.record("sc", "ck", List.of(1L), "critical", "email", "fp", "body", "success", null);
        verify(dao).insert("sc", "ck", List.of(1L), "critical", "email", "fp", "body", "success", null);
    }
}
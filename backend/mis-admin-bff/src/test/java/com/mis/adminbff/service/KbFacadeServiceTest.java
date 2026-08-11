package com.mis.adminbff.service;

import com.mis.adminbff.client.KbWebClient;
import com.mis.adminbff.dto.kb.KbEngineReconcileVO;
import com.mis.adminbff.dto.kb.KbEngineRefVO;
import com.mis.adminbff.dto.kb.KbLibraryDeleteResultVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbFacadeService} 中 P0 新增链路的行为测试（删除三分支 + 引擎引用 + 引擎对账）。
 *
 * <p>本测试是「默认归档」这一关键保护的核心回归锁：{@code deleteLibrary} 在
 * {@code mode} 为 {@code null}/空白时一律回落为 {@code archive}，且只做 {@code trim()}
 * 不擅自改大小写——空白/非法 mode 绝不能被透传成「物理删除」。同时锁定四个新方法都是
 * 纯透传到 {@link KbWebClient}、不做任何业务加工（回执 {@code message} 文案由 mis-kb 裁定）。
 */
class KbFacadeServiceTest {

    private static final long LIB_ID = 100L;

    private KbWebClient kbWebClient;
    private KbSubjectProxyService subjectProxyService;
    private KbExportService exportService;
    private KbFacadeService facade;

    @BeforeEach
    void setUp() {
        kbWebClient = mock(KbWebClient.class);
        subjectProxyService = mock(KbSubjectProxyService.class);
        exportService = mock(KbExportService.class);
        facade = new KbFacadeService(kbWebClient, subjectProxyService, exportService);
    }

    // ---------------------------------------------------- deleteLibrary：默认归档

    @Test
    @DisplayName("mode=null → 回落 archive（绝不直接物理删除）")
    void deleteLibrary_nullModeDefaultsToArchive() {
        KbLibraryDeleteResultVO expected = new KbLibraryDeleteResultVO(
                "archive", Boolean.TRUE, null, "arch-1", 0L, 0L, "已归档");
        when(kbWebClient.deleteLibrary(LIB_ID, "archive")).thenReturn(expected);

        KbLibraryDeleteResultVO result = facade.deleteLibrary(LIB_ID, null);

        assertSame(expected, result);
        verify(kbWebClient).deleteLibrary(LIB_ID, "archive");
    }

    @Test
    @DisplayName("mode=空白 → 同样回落 archive")
    void deleteLibrary_blankModeDefaultsToArchive() {
        when(kbWebClient.deleteLibrary(LIB_ID, "archive"))
                .thenReturn(new KbLibraryDeleteResultVO(
                        "archive", Boolean.TRUE, null, "arch-1", 0L, 0L, "已归档"));

        facade.deleteLibrary(LIB_ID, "   ");

        verify(kbWebClient).deleteLibrary(LIB_ID, "archive");
    }

    @Test
    @DisplayName("mode=archive → 原样透传")
    void deleteLibrary_archivePassesThrough() {
        when(kbWebClient.deleteLibrary(LIB_ID, "archive"))
                .thenReturn(new KbLibraryDeleteResultVO(
                        "archive", Boolean.TRUE, null, "arch-1", 0L, 0L, "已归档"));

        facade.deleteLibrary(LIB_ID, "archive");

        verify(kbWebClient).deleteLibrary(LIB_ID, "archive");
    }

    @Test
    @DisplayName("mode=physical → 透传前只 trim，不改大小写、不改语义")
    void deleteLibrary_physicalTrimmedAndPassedThrough() {
        when(kbWebClient.deleteLibrary(LIB_ID, "physical"))
                .thenReturn(new KbLibraryDeleteResultVO(
                        "physical", Boolean.TRUE, null, null, 3L, 2L, "已物理删除"));

        facade.deleteLibrary(LIB_ID, " physical ");

        // 注意：facade 只 trim，不 lowercase；下游 mis-kb 负责把 physical 落到实际删除
        verify(kbWebClient).deleteLibrary(LIB_ID, "physical");
    }

    // ---------------------------------------------------- getEngineRef

    @Test
    @DisplayName("getEngineRef → 透传 kbWebClient.getEngineRef(id)")
    void getEngineRefPassesThrough() {
        KbEngineRefVO expected =
                new KbEngineRefVO(LIB_ID, "ragflow", "ds-abc123", 1, Instant.now());
        when(kbWebClient.getEngineRef(anyLong())).thenReturn(expected);

        KbEngineRefVO result = facade.getEngineRef(LIB_ID);

        assertSame(expected, result);
        verify(kbWebClient).getEngineRef(LIB_ID);
    }

    // ---------------------------------------------------- 引擎对账

    @Test
    @DisplayName("engineReconcileReport → 透传 kbWebClient.engineReconcileReport()")
    void engineReconcileReportPassesThrough() {
        KbEngineReconcileVO expected = new KbEngineReconcileVO(
                Instant.now(), Boolean.FALSE, null, "ragflow",
                new KbEngineReconcileVO.Counts(1, 1, 0, 0, 0),
                List.of(), List.of(), List.of());
        when(kbWebClient.engineReconcileReport()).thenReturn(expected);

        KbEngineReconcileVO result = facade.engineReconcileReport();

        assertSame(expected, result);
        verify(kbWebClient).engineReconcileReport();
    }

    @Test
    @DisplayName("runEngineReconcile → 透传 kbWebClient.runEngineReconcile()")
    void runEngineReconcilePassesThrough() {
        KbEngineReconcileVO expected = new KbEngineReconcileVO(
                Instant.now(), Boolean.FALSE, null, "ragflow",
                new KbEngineReconcileVO.Counts(1, 1, 0, 0, 0),
                List.of(), List.of(), List.of());
        when(kbWebClient.runEngineReconcile()).thenReturn(expected);

        KbEngineReconcileVO result = facade.runEngineReconcile();

        assertSame(expected, result);
        verify(kbWebClient).runEngineReconcile();
    }
}

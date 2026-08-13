package com.mis.adminbff.service;

import com.mis.adminbff.client.KbWebClient;
import com.mis.adminbff.dto.kb.KbDocumentChunkStatsVO;
import com.mis.adminbff.dto.kb.KbDocumentChunkVO;
import com.mis.adminbff.dto.kb.KbDocumentChunksVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbFacadeService#listDocumentChunks} 透传测试（三层透传，不做业务决策）。
 */
class KbFacadeServiceListChunksTest {

    private static final long LIB_ID = 100L;
    private static final long DOC_ID = 1001L;

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

    @Test
    @DisplayName("listDocumentChunks → 原样透传 kbWebClient.listDocumentChunks（含关键字与分页）")
    void listDocumentChunksPassesThrough() {
        KbDocumentChunksVO expected = new KbDocumentChunksVO(
                new KbDocumentChunkStatsVO(1, 3, "naive", 4096, null, "LIBRARY", 12, 3456),
                List.of(new KbDocumentChunkVO(1L, "内容", 1, 2, List.of("关键"))),
                1, 1, 50, null);
        when(kbWebClient.listDocumentChunks(LIB_ID, DOC_ID, "关键", 2, 50))
                .thenReturn(expected);

        KbDocumentChunksVO result =
                facade.listDocumentChunks(LIB_ID, DOC_ID, "关键", 2, 50);

        assertSame(expected, result);
        verify(kbWebClient).listDocumentChunks(LIB_ID, DOC_ID, "关键", 2, 50);
    }
}

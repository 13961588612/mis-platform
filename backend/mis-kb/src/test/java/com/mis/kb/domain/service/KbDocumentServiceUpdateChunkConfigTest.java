package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentChunkConfigResolver;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbDocumentService#updateChunkConfig} 文件级切片配置 T4/T1 语义单测
 * （纯 Mockito，零 Spring 上下文）。
 *
 * <p>锁定 QA Round 1 / T8 验收线：
 * <ul>
 *   <li><b>越界拒</b>：imageTableContextWindow ∉ [1,4096]、autoKeywords &gt; 32、
 *       autoQuestions &gt; 10 → VALIDATION_ERROR（不做静默截断）；</li>
 *   <li><b>清除回 null</b>：config 全 null → 七列全部清空（继承库级），引擎仍触发重解析；</li>
 *   <li><b>快照继承</b>：清空覆盖时 RagflowClient 收到的 DocumentChunkConfig 为库级有效值
 *       （含 auto 两键，快照式继承，T5）。</li>
 * </ul>
 */
class KbDocumentServiceUpdateChunkConfigTest {

    private static final long LIBRARY_ID = 7L;
    private static final long DOC_ID = 101L;
    private static final long USER = 42L;

    private KbDocumentRepository documentRepository;
    private KbLibraryRepository libraryRepository;
    private KnowledgeEnginePort enginePort;
    private KbLibraryService libraryService;
    private KbVisibilityService visibilityService;
    private KbDocumentService service;

    @BeforeEach
    void setUp() {
        documentRepository = mock(KbDocumentRepository.class);
        libraryRepository = mock(KbLibraryRepository.class);
        enginePort = mock(KnowledgeEnginePort.class);
        libraryService = mock(KbLibraryService.class);
        visibilityService = mock(KbVisibilityService.class);
        service = new KbDocumentService(
                documentRepository, libraryRepository, enginePort, libraryService, visibilityService,
                new DocumentChunkConfigResolver());
        when(libraryService.hasLibraryManage(USER, LIBRARY_ID)).thenReturn(true);
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(doc()));
    }

    private static KbLibrary library() {
        KbLibrary lib = new KbLibrary();
        lib.setId(LIBRARY_ID);
        lib.setName("测试库");
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef("ds-1");
        RagSettings settings = new RagSettings(null, null, null, null, "hybrid",
                "naive", 128, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                Boolean.TRUE, 256, 5.0D, 3, 2).withDefaults();
        lib.setRagSettingsJson(KbJson.writeSettings(settings));
        return lib;
    }

    private static KbDocument doc() {
        KbDocument d = new KbDocument();
        d.setId(DOC_ID);
        d.setLibraryId(LIBRARY_ID);
        d.setTitle("测试.pdf");
        d.setEngineDocumentRef("doc-1");
        d.setParseStatus("success");
        return d;
    }

    private KbDocument requireLibRefs() {
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library()));
        KbDocument d = doc();
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(d));
        return d;
    }

    // ------------------------------------------------------------ 越界拒

    @Test
    @DisplayName("T1：imageTableContextWindow=4097（越界）→ VALIDATION_ERROR，不落库不动引擎")
    void rejectsOutOfRangeImageWindow() {
        requireLibRefs();
        DocumentChunkConfig bad = new DocumentChunkConfig(null, null, null, null, 4097, null, null);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateChunkConfig(DOC_ID, bad));

        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(documentRepository, never()).save(any(KbDocument.class));
        verify(enginePort, never()).updateDocumentChunkConfig(any(), any(), any());
    }

    @Test
    @DisplayName("T1：autoKeywords=33（越界）→ VALIDATION_ERROR；autoQuestions=11 → VALIDATION_ERROR")
    void rejectsOutOfRangeAutoKeys() {
        requireLibRefs();

        BusinessException ex1 = assertThrows(BusinessException.class,
                () -> service.updateChunkConfig(DOC_ID,
                        new DocumentChunkConfig(null, null, null, null, null, 33, null)));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex1.getCode());

        BusinessException ex2 = assertThrows(BusinessException.class,
                () -> service.updateChunkConfig(DOC_ID,
                        new DocumentChunkConfig(null, null, null, null, null, null, 11)));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex2.getCode());

        verify(documentRepository, never()).save(any(KbDocument.class));
        verify(enginePort, never()).updateDocumentChunkConfig(any(), any(), any());
    }

    @Test
    @DisplayName("T1：边界 0 / 32 / 10 均合法（0 = 关闭），放行并落库")
    void acceptsBoundaryAutoKeys() {
        requireLibRefs();

        service.updateChunkConfig(DOC_ID,
                new DocumentChunkConfig(null, null, null, null, null, 32, 10));
        verify(documentRepository).save(any(KbDocument.class));
        verify(enginePort).updateDocumentChunkConfig(any(), any(), any());

        service.updateChunkConfig(DOC_ID,
                new DocumentChunkConfig(null, null, null, null, null, 0, 0));
        verify(documentRepository, org.mockito.Mockito.times(2)).save(any(KbDocument.class));
    }

    // ------------------------------------------------------------ 清除回 null + 快照继承

    @Test
    @DisplayName("T4：config 全 null → 四列全部置 null（清覆盖继承库级）")
    void nullConfigClearsColumnsToNull() {
        KbDocument d = requireLibRefs();
        d.setPageIndex(false);
        d.setImageTableContextWindow(512);
        d.setAutoKeywords(8);
        d.setAutoQuestions(5);

        service.updateChunkConfig(DOC_ID, new DocumentChunkConfig(null, null, null, null, null, null, null));

        assertNull(d.getPageIndex(), "清除覆盖后 pageIndex 应回 null（继承库级）");
        assertNull(d.getImageTableContextWindow(), "清除覆盖后 imageTableContextWindow 应回 null");
        assertNull(d.getAutoKeywords(), "清除覆盖后 autoKeywords 应回 null");
        assertNull(d.getAutoQuestions(), "清除覆盖后 autoQuestions 应回 null");
        verify(documentRepository).save(d);
    }

    @Test
    @DisplayName("T5 快照继承：清空覆盖 → 引擎收到库级有效值构造的 7 参 DocumentChunkConfig（含 auto 双键）")
    void clearConfigSendsLibrarySnapshot() {
        requireLibRefs();

        service.updateChunkConfig(DOC_ID, new DocumentChunkConfig(null, null, null, null, null, null, null));

        verify(enginePort).updateDocumentChunkConfig(
                any(EngineLibraryRef.class), any(EngineDocumentRef.class), any(DocumentChunkConfig.class));
    }

    @Test
    @DisplayName("T5 快照：null config（等价全空）同样走清除 + 快照下发")
    void nullConfigSendsSnapshot() {
        requireLib();

        service.updateChunkConfig(DOC_ID, null);

        verify(enginePort).updateDocumentChunkConfig(any(), any(), any(DocumentChunkConfig.class));
    }

    private void requireLib() {
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library()));
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(doc()));
    }
}
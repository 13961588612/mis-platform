package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbReparseAllResult;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.DocumentChunkConfigResolver;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.ParseStatus;
import com.mis.kb.domain.model.ParseStatusSnapshot;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbDocumentService#reparseAll} 库级一键重解析单测（P1-1）。
 *
 * <p>沿用项目既有测试风格（纯 Mockito，零 Spring 上下文），覆盖需求四点：
 * 空库返回明确结果；全部成功；部分失败不中断并返回失败明细；解析中文档幂等跳过；
 * 无引擎映射文档计失败；知识库不存在抛业务异常。
 */
class KbDocumentServiceReparseAllTest {

    private static final long LIBRARY_ID = 7L;
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
        when(libraryRepository.findById(LIBRARY_ID))
                .thenReturn(Optional.of(library()));
        // 知识库域一期：写操作双闸门（权限码 + 管辖），默认放行管辖，专项用例再拒
        when(libraryService.hasLibraryManage(USER, LIBRARY_ID)).thenReturn(true);
    }

    private static KbLibrary library() {
        KbLibrary lib = new KbLibrary();
        lib.setId(LIBRARY_ID);
        lib.setName("测试库");
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef("ds-test");
        return lib;
    }

    private static KbDocument doc(long id, String title, String engineRef, String parseStatus) {
        KbDocument d = new KbDocument();
        d.setId(id);
        d.setLibraryId(LIBRARY_ID);
        d.setTitle(title);
        d.setEngineDocumentRef(engineRef);
        d.setParseStatus(parseStatus);
        d.setEnabled(1);
        d.setCreatedAt(Instant.now());
        d.setUpdatedAt(Instant.now());
        return d;
    }

    @Test
    @DisplayName("空库：返回 success=0 的明确结果，不触碰引擎")
    void emptyLibraryReturnsZeroResult() {
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID)).thenReturn(List.of());

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, false, USER);

        assertEquals(LIBRARY_ID, result.libraryId());
        assertEquals(0, result.total());
        assertEquals(0, result.success());
        assertEquals(0, result.failed());
        assertEquals(0, result.skipped());
        assertTrue(result.failedDocuments().isEmpty());
        verify(enginePort, never()).reparseDocument(any(), any());
        verify(enginePort, never()).queryDocumentParseStatuses(any(), anyList());
    }

    @Test
    @DisplayName("全部成功：逐文档触发引擎并置 PARSING")
    void allSuccessTriggersEveryDocument() {
        KbDocument d1 = doc(1L, "a.pdf", "doc-1", ParseStatus.SUCCESS.code());
        KbDocument d2 = doc(2L, "b.pdf", "doc-2", ParseStatus.FAILED.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID)).thenReturn(List.of(d1, d2));

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, false, USER);

        assertEquals(2, result.total());
        assertEquals(2, result.success());
        assertEquals(0, result.failed());
        assertEquals(0, result.skipped());
        assertTrue(result.failedDocuments().isEmpty());
        verify(enginePort, times(2)).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")), any(EngineDocumentRef.class));
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-1")));
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-2")));
        assertEquals(ParseStatus.PARSING.code(), d1.getParseStatus());
        assertEquals(ParseStatus.PARSING.code(), d2.getParseStatus());
    }

    @Test
    @DisplayName("部分失败：单文档失败不中断其余，返回失败明细并置 FAILED")
    void partialFailureContinuesAndCollectsFailures() {
        KbDocument d1 = doc(1L, "a.pdf", "doc-1", ParseStatus.SUCCESS.code());
        KbDocument d2 = doc(2L, "b.pdf", "doc-2", ParseStatus.SUCCESS.code());
        KbDocument d3 = doc(3L, "c.pdf", "doc-3", ParseStatus.SUCCESS.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID))
                .thenReturn(List.of(d1, d2, d3));
        doThrow(new IllegalStateException("engine boom"))
                .when(enginePort).reparseDocument(
                        any(EngineLibraryRef.class), eq(new EngineDocumentRef("ragflow", "doc-2")));

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, false, USER);

        assertEquals(3, result.total());
        assertEquals(2, result.success());
        assertEquals(1, result.failed());
        assertEquals(0, result.skipped());
        assertEquals(1, result.failedDocuments().size());
        assertEquals(2L, result.failedDocuments().get(0).documentId());
        assertEquals("b.pdf", result.failedDocuments().get(0).title());
        assertTrue(result.failedDocuments().get(0).reason().contains("engine boom"));
        // 其余文档仍然触发
        verify(enginePort, times(3)).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")), any(EngineDocumentRef.class));
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-1")));
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-3")));
        // 失败文档状态如实置 FAILED
        assertEquals(ParseStatus.FAILED.code(), d2.getParseStatus());
    }

    @Test
    @DisplayName("解析中文档：幂等跳过，不重复入队")
    void alreadyParsingDocumentIsSkipped() {
        KbDocument d1 = doc(1L, "a.pdf", "doc-1", ParseStatus.SUCCESS.code());
        KbDocument d2 = doc(2L, "b.pdf", "doc-2", ParseStatus.PARSING.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID)).thenReturn(List.of(d1, d2));
        // syncOpenParseStatuses 会把 parsing 文档批量查引擎状态；返回空 map = 状态不变
        when(enginePort.queryDocumentParseStatuses(
                eq(new EngineLibraryRef("ragflow", "ds-test")), anyList()))
                .thenReturn(Map.of());

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, false, USER);

        assertEquals(1, result.success());
        assertEquals(1, result.skipped());
        assertEquals(0, result.failed());
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-1")));
        verify(enginePort, never()).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-2")));
    }

    @Test
    @DisplayName("无引擎映射文档：计失败并给出原因，不调引擎")
    void documentWithoutEngineRefCountsAsFailure() {
        KbDocument d1 = doc(1L, "a.pdf", "doc-1", ParseStatus.SUCCESS.code());
        KbDocument d2 = doc(2L, "orphan.pdf", null, ParseStatus.SUCCESS.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID)).thenReturn(List.of(d1, d2));

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, false, USER);

        assertEquals(2, result.total());
        assertEquals(1, result.success());
        assertEquals(1, result.failed());
        assertEquals(2L, result.failedDocuments().get(0).documentId());
        assertTrue(result.failedDocuments().get(0).reason().contains("尚未同步到引擎"));
        verify(enginePort, times(1)).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")), any(EngineDocumentRef.class));
    }

    @Test
    @DisplayName("知识库不存在：抛 KB_LIBRARY_NOT_FOUND")
    void libraryNotFoundThrows() {
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.empty());

        KbBusinessException ex = assertThrows(
                KbBusinessException.class, () -> service.reparseAll(LIBRARY_ID, false, USER));

        assertEquals(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode(), ex.getCode());
        verify(documentRepository, never()).findByLibraryIdOrderByCreatedAtDesc(any());
    }

    @Test
    @DisplayName("管辖外（hasLibraryManage=false）：抛 40311 且不触碰引擎（双闸门之二）")
    void outOfManageScopeRejected() {
        when(libraryService.hasLibraryManage(USER, LIBRARY_ID)).thenReturn(false);

        KbBusinessException ex = assertThrows(
                KbBusinessException.class, () -> service.reparseAll(LIBRARY_ID, false, USER));

        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
        verify(documentRepository, never()).findByLibraryIdOrderByCreatedAtDesc(any());
        verify(enginePort, never()).reparseDocument(any(), any());
    }

    @Test
    @DisplayName("库有文档但库无引擎映射：抛 KB_LIBRARY_NOT_FOUND")
    void libraryWithoutEngineRefThrows() {
        KbLibrary broken = library();
        broken.setEngineLibraryRef(null);
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(broken));
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID))
                .thenReturn(List.of(doc(1L, "a.pdf", "doc-1", ParseStatus.SUCCESS.code())));

        KbBusinessException ex = assertThrows(
                KbBusinessException.class, () -> service.reparseAll(LIBRARY_ID, false, USER));

        assertEquals(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode(), ex.getCode());
        verify(enginePort, never()).reparseDocument(any(), any());
    }

    @Test
    @DisplayName("失败明细列表为不可变副本（List.copyOf）")
    void failedDocumentsIsImmutableCopy() {
        KbDocument d1 = doc(1L, "a.pdf", "doc-1", ParseStatus.SUCCESS.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID)).thenReturn(List.of(d1));
        doThrow(new IllegalStateException("boom"))
                .when(enginePort).reparseDocument(
                        any(EngineLibraryRef.class), eq(new EngineDocumentRef("ragflow", "doc-1")));

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, false, USER);

        assertThrows(UnsupportedOperationException.class,
                () -> result.failedDocuments().add(
                        new KbReparseAllResult.FailedDocument(9L, "x", "y")));
        assertFalse(result.failedDocuments().isEmpty());
    }

    @Test
    @DisplayName("onlyFailed=true：仅触发 failed 文档，其余计入 skipped")
    void onlyFailedTriggersOnlyFailedDocuments() {
        KbDocument d1 = doc(1L, "ok.pdf", "doc-1", ParseStatus.SUCCESS.code());
        KbDocument d2 = doc(2L, "broken.pdf", "doc-2", ParseStatus.FAILED.code());
        KbDocument d3 = doc(3L, "pending.pdf", "doc-3", ParseStatus.PENDING.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID))
                .thenReturn(List.of(d1, d2, d3));

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, true, USER);

        assertEquals(3, result.total());
        assertEquals(1, result.success());
        assertEquals(0, result.failed());
        assertEquals(2, result.skipped());
        verify(enginePort, times(1)).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-2")));
        verify(enginePort, never()).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-1")));
        verify(enginePort, never()).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-3")));
        // 触发前清空失败原因（KE-04 口径）
        assertNull(d2.getParseError());
    }

    @Test
    @DisplayName("onlyFailed=true：先 sync 收敛 open 文档，收敛后不再触发（R8）")
    void onlyFailedSkipsConvergedOpenDocuments() {
        KbDocument d1 = doc(1L, "broken.pdf", "doc-1", ParseStatus.FAILED.code());
        KbDocument d2 = doc(2L, "real-broken.pdf", "doc-2", ParseStatus.FAILED.code());
        KbDocument d3 = doc(3L, "converged.pdf", "doc-3", ParseStatus.PENDING.code());
        when(documentRepository.findByLibraryIdOrderByCreatedAtDesc(LIBRARY_ID))
                .thenReturn(List.of(d1, d2, d3));
        // syncOpenParseStatuses 只查 pending/parsing（设计 §3.3 明确不增加引擎调用次数）：
        // 引擎侧 d3 实际已 DONE，收敛为 SUCCESS；d1/d2 为 failed 不入 sync 批次、保持 failed
        when(enginePort.queryDocumentParseStatuses(
                eq(new EngineLibraryRef("ragflow", "ds-test")), anyList()))
                .thenReturn(Map.of("doc-3", new ParseStatusSnapshot(
                        ParseStatus.SUCCESS.code(), 100, null)));

        KbReparseAllResult result = service.reparseAll(LIBRARY_ID, true, USER);

        // d1/d2（failed）触发、d3 经 sync 收敛为 SUCCESS 后按 onlyFailed 语义跳过
        assertEquals(3, result.total());
        assertEquals(2, result.success());
        assertEquals(0, result.failed());
        assertEquals(1, result.skipped());
        assertEquals(ParseStatus.SUCCESS.code(), d3.getParseStatus());
        assertNull(d3.getParseError());
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-1")));
        verify(enginePort).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-2")));
        verify(enginePort, never()).reparseDocument(
                eq(new EngineLibraryRef("ragflow", "ds-test")),
                eq(new EngineDocumentRef("ragflow", "doc-3")));
    }
}

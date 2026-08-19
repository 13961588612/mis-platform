package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbDocumentChunkVO;
import com.mis.kb.api.dto.KbDocumentChunksVO;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.ChunkQuery;
import com.mis.kb.domain.model.DocumentChunkPageView;
import com.mis.kb.domain.model.DocumentChunkConfigResolver;
import com.mis.kb.domain.model.DocumentChunkView;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.ParseStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbDocumentService#listDocumentChunks} 单测（纯 Mockito，零 Spring 上下文）。
 *
 * <p>覆盖：读权限双闸门（ACL 拒绝抛 40310）；解析状态预检空态（pending/parsing/failed/
 * 未同步到引擎）；引擎不可达降级空态（不抛错）；来源判定（FILE_OVERRIDE / LIBRARY）；
 * 全局连续序号；库/文档不存在。
 */
class KbDocumentServiceListChunksTest {

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
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library()));
        when(visibilityService.hasPermission(USER, LIBRARY_ID, AclAction.READ.code())).thenReturn(true);
    }

    private static KbLibrary library() {
        KbLibrary lib = new KbLibrary();
        lib.setId(LIBRARY_ID);
        lib.setName("测试库");
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef("ds-1");
        // ragSettingsJson 置 null → 继承库级时兜底 RagSettings.defaults()（naive/4096）
        lib.setRagSettingsJson(null);
        return lib;
    }

    private static KbDocument doc(String engineRef, String parseStatus) {
        KbDocument d = new KbDocument();
        d.setId(DOC_ID);
        d.setLibraryId(LIBRARY_ID);
        d.setTitle("测试.pdf");
        d.setEngineDocumentRef(engineRef);
        d.setParseStatus(parseStatus);
        d.setChunkMethod(null);
        d.setChunkTokenNum(null);
        d.setSeparator(null);
        return d;
    }

    private static DocumentChunkPageView pageView(int page, int pageSize, String... contents) {
        List<DocumentChunkView> chunks = new java.util.ArrayList<>();
        for (int i = 0; i < contents.length; i++) {
            chunks.add(new DocumentChunkView(DOC_ID, contents[i], i + 1, null, null));
        }
        return new DocumentChunkPageView(chunks, contents.length, page, pageSize, null, null);
    }

    @Test
    @DisplayName("happy path：继承库级来源，映射 seq/content/pageNo/characterCount")
    void happyPathMapsChunks() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(1, 50, "第一段", "第二段"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertNull(vo.hint());
        assertEquals(2, vo.total());
        assertEquals(2, vo.chunks().size());
        KbDocumentChunkVO first = vo.chunks().get(0);
        assertEquals(1L, first.seq());
        assertEquals("第一段", first.content());
        assertEquals(Integer.valueOf(1), first.pageNo());
        assertEquals(3, first.characterCount());
        assertEquals(2L, vo.chunks().get(1).seq());
        // 统计条：无文件级覆盖 → LIBRARY，兜底 defaults
        assertEquals(2, vo.stats().totalChunks());
        assertEquals(6, vo.stats().totalCharacterCount());
        assertEquals("LIBRARY", vo.stats().source());
        assertEquals(RagSettings.DEFAULT_CHUNK_METHOD, vo.stats().chunkMethod());
        assertEquals(RagSettings.DEFAULT_CHUNK_TOKEN_NUM, vo.stats().chunkTokenNum());
    }

    @Test
    @DisplayName("文件级覆盖：来源 FILE_OVERRIDE，展示文档级切片配置")
    void fileOverrideSource() {
        KbDocument d = doc("doc-1", ParseStatus.SUCCESS.code());
        d.setChunkMethod("qa");
        d.setChunkTokenNum(512);
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(d));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(1, 50, "内容"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertEquals("FILE_OVERRIDE", vo.stats().source());
        assertEquals("qa", vo.stats().chunkMethod());
        assertEquals(512, vo.stats().chunkTokenNum());
    }

    @Test
    @DisplayName("T4：文件级四个解析器字段任一非空 → FILE_OVERRIDE，统计条展示文档级值")
    void fileOverrideWithParserSettingsFields() {
        KbDocument d = doc("doc-1", ParseStatus.SUCCESS.code());
        d.setPageIndex(false);
        d.setImageTableContextWindow(512);
        d.setAutoKeywords(8);
        d.setAutoQuestions(5);
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(d));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(1, 50, "内容"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertEquals("FILE_OVERRIDE", vo.stats().source(),
                "四个新文件字段任一非空即算文件覆盖（T4 来源判定）");
        assertEquals(false, vo.stats().pageIndex());
        assertEquals(Integer.valueOf(512), vo.stats().imageTableContextWindow());
        assertEquals(Integer.valueOf(8), vo.stats().autoKeywords());
        assertEquals(Integer.valueOf(5), vo.stats().autoQuestions());
        assertEquals(RagSettings.DEFAULT_CHUNK_METHOD, vo.stats().chunkMethod(),
                "未指定的三字段仍走默认（文件覆盖只影响指定字段）");
    }

    @Test
    @DisplayName("T4：无文件级覆盖 → LIBRARY + 库级四个新字段生效值（缺失兜底 defaults）")
    void inheritDisplaysLibraryParserSettings() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(1, 50, "内容"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertEquals("LIBRARY", vo.stats().source());
        assertEquals(Boolean.TRUE, vo.stats().pageIndex(),
                "库级 settings 为 null 时兜底 defaults → pageIndex=true");
        assertEquals(Integer.valueOf(RagSettings.DEFAULT_IMAGE_TABLE_CONTEXT_WINDOW),
                vo.stats().imageTableContextWindow(), "兜底 256");
        assertEquals(Integer.valueOf(RagSettings.DEFAULT_AUTO_KEYWORDS),
                vo.stats().autoKeywords(), "兜底 0");
        assertEquals(Integer.valueOf(RagSettings.DEFAULT_AUTO_QUESTIONS),
                vo.stats().autoQuestions(), "兜底 0");
    }

    @Test
    @DisplayName("T4：库级 settings 带自定义四新字段 → LIBRARY stats 展示库级生效值")
    void libraryParserSettingsShownInStats() {
        KbLibrary lib = library();
        RagSettings custom = new RagSettings(null, null, null, null, "hybrid",
                "naive", 128, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                Boolean.FALSE, 768, 15.0D, 4, 3).withDefaults();
        lib.setRagSettingsJson(com.mis.kb.support.KbJson.writeSettings(custom));
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(lib));
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(1, 50, "内容"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertEquals("LIBRARY", vo.stats().source());
        assertEquals(Boolean.FALSE, vo.stats().pageIndex());
        assertEquals(Integer.valueOf(768), vo.stats().imageTableContextWindow());
        assertEquals(Integer.valueOf(4), vo.stats().autoKeywords());
        assertEquals(Integer.valueOf(3), vo.stats().autoQuestions());
    }

    @Test
    @DisplayName("P0 合并语义：文件级部分覆盖（仅 autoKeywords）→ 其余字段回落库级，source=FILE_OVERRIDE")
    void partialOverrideMergesLibraryFallback() {
        // 库级带自定义解析器字段（pageIndex=false / imageTableContextWindow=768 /
        // autoQuestions=3），文件级仅覆盖 autoKeywords=8，其余六字段 null
        KbLibrary lib = library();
        RagSettings custom = new RagSettings(null, null, null, null, "hybrid",
                "naive", 128, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                Boolean.FALSE, 768, 15.0D, 4, 3).withDefaults();
        lib.setRagSettingsJson(com.mis.kb.support.KbJson.writeSettings(custom));
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(lib));

        KbDocument d = doc("doc-1", ParseStatus.SUCCESS.code());
        d.setAutoKeywords(8);
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(d));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(1, 50, "内容"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertEquals("FILE_OVERRIDE", vo.stats().source(),
                "文件级任一字段非空即 FILE_OVERRIDE（P0 合并语义）");
        assertEquals(Integer.valueOf(8), vo.stats().autoKeywords(),
                "文件级覆盖 autoKeywords=8 必须回显");
        assertEquals("naive", vo.stats().chunkMethod(),
                "未覆盖字段 chunkMethod 回落库级");
        assertEquals(Integer.valueOf(128), vo.stats().chunkTokenNum(),
                "未覆盖字段 chunkTokenNum 回落库级");
        assertEquals(Boolean.FALSE, vo.stats().pageIndex(),
                "未覆盖字段 pageIndex 回落库级");
        assertEquals(Integer.valueOf(768), vo.stats().imageTableContextWindow(),
                "未覆盖字段 imageTableContextWindow 回落库级");
        assertEquals(Integer.valueOf(3), vo.stats().autoQuestions(),
                "未覆盖字段 autoQuestions 回落库级");
    }

    @Test
    @DisplayName("第二页序号：seq = (page-1)*pageSize + i + 1（全局连续）")
    void seqIsGloballyContinuousOnPageTwo() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(pageView(2, 50, "第三段"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 2, 50);

        assertEquals(51L, vo.chunks().get(0).seq());
        assertEquals(2, vo.page());
    }

    @Test
    @DisplayName("双口径统计：stats 携带全量 chunkCount + tokenCount（引擎 doc 值透传）")
    void statsCarriesChunkCountAndTokenCount() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        List<DocumentChunkView> chunks = List.of(
                new DocumentChunkView(DOC_ID, "第一段", 1, List.of("关键"), null));
        DocumentChunkPageView page = new DocumentChunkPageView(chunks, 1, 1, 50, 12, 3456);
        when(enginePort.listDocumentChunks(any(ChunkQuery.class))).thenReturn(page);

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        // 双口径：chunkCount 全量（不受过滤影响）与 total 过滤后分别下发
        assertEquals(Integer.valueOf(12), vo.stats().chunkCount());
        assertEquals(Integer.valueOf(3456), vo.stats().tokenCount());
        assertEquals(1, vo.stats().totalChunks());
        assertEquals(1, vo.total());
        // 空态路径双口径为 null
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenReturn(DocumentChunkPageView.empty(1, 50));
        KbDocumentChunksVO emptyVo = service.listDocumentChunks(
                LIBRARY_ID, DOC_ID, USER, null, 1, 50);
        assertNull(emptyVo.stats().chunkCount());
        assertNull(emptyVo.stats().tokenCount());
    }

    @Test
    @DisplayName("importantKeywords 透传：引擎列表到 VO 原样下发")
    void importantKeywordsPassThrough() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        List<DocumentChunkView> chunks = List.of(
                new DocumentChunkView(DOC_ID, "第一段", 1, List.of("关键", "RAGFlow"), null),
                new DocumentChunkView(DOC_ID, "第二段", 2, List.of(), null));
        DocumentChunkPageView page = new DocumentChunkPageView(chunks, 2, 1, 50, null, null);
        when(enginePort.listDocumentChunks(any(ChunkQuery.class))).thenReturn(page);

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertEquals(List.of("关键", "RAGFlow"), vo.chunks().get(0).importantKeywords());
        assertEquals(List.of(), vo.chunks().get(1).importantKeywords());
    }

    @Test
    @DisplayName("无读权限：抛 KB_NO_READ_PERMISSION(40310)，不触碰引擎")
    void noReadPermissionThrows() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        when(visibilityService.hasPermission(USER, LIBRARY_ID, AclAction.READ.code())).thenReturn(false);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50));

        assertEquals(KbResultCode.KB_NO_READ_PERMISSION.getCode(), ex.getCode());
        verify(enginePort, never()).listDocumentChunks(any());
    }

    @Test
    @DisplayName("pending/parsing：空态 + 解析中提示，不触碰引擎")
    void parsingReturnsEmptyWithHint() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.PARSING.code())));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertTrue(vo.hint().contains("解析中"));
        assertTrue(vo.chunks().isEmpty());
        assertEquals(0, vo.total());
        verify(enginePort, never()).listDocumentChunks(any());
    }

    @Test
    @DisplayName("failed：空态 + 解析失败提示，不触碰引擎")
    void failedReturnsEmptyWithHint() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.FAILED.code())));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertTrue(vo.hint().contains("解析失败"));
        assertTrue(vo.chunks().isEmpty());
        verify(enginePort, never()).listDocumentChunks(any());
    }

    @Test
    @DisplayName("未同步到引擎：空态 + 尚未同步提示，不触碰引擎")
    void notSyncedReturnsEmptyWithHint() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc(null, ParseStatus.SUCCESS.code())));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertTrue(vo.hint().contains("尚未同步到引擎"));
        assertTrue(vo.chunks().isEmpty());
        verify(enginePort, never()).listDocumentChunks(any());
    }

    @Test
    @DisplayName("引擎不可达：降级空态 + 引擎暂不可达提示（不抛错）")
    void engineUnreachableDegrades() {
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(doc("doc-1", ParseStatus.SUCCESS.code())));
        when(enginePort.listDocumentChunks(any(ChunkQuery.class)))
                .thenThrow(new IllegalStateException("connection refused"));

        KbDocumentChunksVO vo = service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50);

        assertTrue(vo.hint().contains("引擎暂不可达"));
        assertTrue(vo.chunks().isEmpty());
        assertEquals(0, vo.total());
    }

    @Test
    @DisplayName("知识库不存在：抛 KB_LIBRARY_NOT_FOUND")
    void libraryNotFoundThrows() {
        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.empty());

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50));

        assertEquals(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode(), ex.getCode());
        verify(documentRepository, never()).findById(any());
    }

    @Test
    @DisplayName("文档不存在：抛 KB_DOC_NOT_FOUND")
    void documentNotFoundThrows() {
        when(documentRepository.findById(DOC_ID)).thenReturn(Optional.empty());

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.listDocumentChunks(LIBRARY_ID, DOC_ID, USER, null, 1, 50));

        assertEquals(KbResultCode.KB_DOC_NOT_FOUND.getCode(), ex.getCode());
        verify(enginePort, never()).listDocumentChunks(any());
    }
}

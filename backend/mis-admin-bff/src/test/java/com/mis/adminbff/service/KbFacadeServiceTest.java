package com.mis.adminbff.service;

import com.mis.adminbff.client.KbWebClient;
import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbEngineReconcileVO;
import com.mis.adminbff.dto.kb.KbEngineRefVO;
import com.mis.adminbff.dto.kb.KbLibraryDeleteResultVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
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
    @DisplayName("deleteSession → 透传 kbWebClient.deleteSession(id)")
    void deleteSessionPassesThrough() {
        facade.deleteSession(123L);

        verify(kbWebClient).deleteSession(123L);
    }

    @Test
    @DisplayName("mode=null → 回落 archive（绝不直接物理删除）")
    void deleteLibrary_nullModeDefaultsToArchive() {
        KbLibraryDeleteResultVO expected = new KbLibraryDeleteResultVO(
                "archive", Boolean.TRUE, null, "arch-1", 0L, 0L, "已归档", false);
        when(kbWebClient.deleteLibrary(LIB_ID, "archive", false)).thenReturn(expected);

        KbLibraryDeleteResultVO result = facade.deleteLibrary(LIB_ID, null);

        assertSame(expected, result);
        verify(kbWebClient).deleteLibrary(LIB_ID, "archive", false);
    }

    @Test
    @DisplayName("mode=空白 → 同样回落 archive")
    void deleteLibrary_blankModeDefaultsToArchive() {
        when(kbWebClient.deleteLibrary(LIB_ID, "archive", false))
                .thenReturn(new KbLibraryDeleteResultVO(
                        "archive", Boolean.TRUE, null, "arch-1", 0L, 0L, "已归档", false));

        facade.deleteLibrary(LIB_ID, "   ");

        verify(kbWebClient).deleteLibrary(LIB_ID, "archive", false);
    }

    @Test
    @DisplayName("mode=archive → 原样透传（force=false）")
    void deleteLibrary_archivePassesThrough() {
        when(kbWebClient.deleteLibrary(LIB_ID, "archive", false))
                .thenReturn(new KbLibraryDeleteResultVO(
                        "archive", Boolean.TRUE, null, "arch-1", 0L, 0L, "已归档", false));

        facade.deleteLibrary(LIB_ID, "archive");

        verify(kbWebClient).deleteLibrary(LIB_ID, "archive", false);
    }

    @Test
    @DisplayName("mode=physical → 透传前只 trim，不改大小写、不改语义")
    void deleteLibrary_physicalTrimmedAndPassedThrough() {
        when(kbWebClient.deleteLibrary(LIB_ID, "physical", false))
                .thenReturn(new KbLibraryDeleteResultVO(
                        "physical", Boolean.TRUE, null, null, 3L, 2L, "已物理删除", false));

        facade.deleteLibrary(LIB_ID, " physical ");

        // 注意：facade 只 trim，不 lowercase；下游 mis-kb 负责把 physical 落到实际删除
        verify(kbWebClient).deleteLibrary(LIB_ID, "physical", false);
    }

    @Test
    @DisplayName("force=true → 原样透传（Q1 两段式第二段；engineMissing=true 回执原样返回）")
    void deleteLibrary_forceTruePassesThrough() {
        KbLibraryDeleteResultVO expected = new KbLibraryDeleteResultVO(
                "archive", Boolean.FALSE, null, null, 0L, 0L,
                "已归档（引擎侧数据集已不存在，跳过引擎改名）：本地已停用并标记归档，文档与授权全部保留。",
                true);
        when(kbWebClient.deleteLibrary(LIB_ID, "archive", true)).thenReturn(expected);

        KbLibraryDeleteResultVO result = facade.deleteLibrary(LIB_ID, "archive", true);

        assertSame(expected, result);
        verify(kbWebClient).deleteLibrary(LIB_ID, "archive", true);
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
                new KbEngineReconcileVO.Counts(1, 1, 0, 0, 0, 0),
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
                new KbEngineReconcileVO.Counts(1, 1, 0, 0, 0, 0),
                List.of(), List.of(), List.of());
        when(kbWebClient.runEngineReconcile()).thenReturn(expected);

        KbEngineReconcileVO result = facade.runEngineReconcile();

        assertSame(expected, result);
        verify(kbWebClient).runEngineReconcile();
    }

    // ---------------------------------------------------- listAcls：主体名称回填

    /** 构造 ACL 视图；subjectName 初始为 null（模拟 mis-kb 返回，由 BFF 回填）。 */
    private static KbAclVO acl(Long id, String subjectType, Long subjectId) {
        return new KbAclVO(
                id, LIB_ID, subjectType, subjectId, "read", Instant.now(), Instant.now(), null);
    }

    @Test
    @DisplayName("listAcls → 正常回填 user/role/dept 三类主体名称")
    void listAcls_fillsSubjectNamesForAllTypes() {
        List<KbAclVO> raw = List.of(
                acl(1L, "user", 11L),
                acl(2L, "role", 22L),
                acl(3L, "dept", 33L));
        when(kbWebClient.listAcls(LIB_ID)).thenReturn(raw);
        Map<String, String> names = new HashMap<>();
        names.put("user:11", "张三");
        names.put("role:22", "内容管理员");
        names.put("dept:33", "研发一部");
        when(subjectProxyService.resolveNames(anySet())).thenReturn(names);

        List<KbAclVO> result = facade.listAcls(LIB_ID);

        assertNotNull(result);
        assertEquals(3, result.size());
        assertEquals("张三", result.get(0).subjectName());
        assertEquals("内容管理员", result.get(1).subjectName());
        assertEquals("研发一部", result.get(2).subjectName());
        // 回填只改名称，其余字段原样保留
        assertEquals(11L, result.get(0).subjectId());
        assertEquals("user", result.get(0).subjectType());
        // 解析 key 应为 {user:11, role:22, dept:33} 去重后的集合
        Set<KbSubjectProxyService.SubjectKey> expectedKeys = new HashSet<>();
        expectedKeys.add(new KbSubjectProxyService.SubjectKey("user", 11L));
        expectedKeys.add(new KbSubjectProxyService.SubjectKey("role", 22L));
        expectedKeys.add(new KbSubjectProxyService.SubjectKey("dept", 33L));
        verify(subjectProxyService).resolveNames(expectedKeys);
    }

    @Test
    @DisplayName("listAcls → resolveNames 抛异常时降级返回原始列表，不抛错")
    void listAcls_degradesToRawListWhenResolveFails() {
        List<KbAclVO> raw = List.of(acl(1L, "user", 11L));
        when(kbWebClient.listAcls(LIB_ID)).thenReturn(raw);
        when(subjectProxyService.resolveNames(anySet()))
                .thenThrow(new IllegalStateException("IAM 不可达"));

        List<KbAclVO> result = facade.listAcls(LIB_ID);

        // 不抛异常；返回原始列表；名称保持 null
        assertNotNull(result);
        assertEquals(1, result.size());
        assertNull(result.get(0).subjectName());
        assertEquals(11L, result.get(0).subjectId());
    }

    @Test
    @DisplayName("listAcls → subjectType/subjectId 为 null 的条目名称保持 null")
    void listAcls_keepsNullNameWhenSubjectFieldsMissing() {
        KbAclVO noType = new KbAclVO(
                1L, LIB_ID, null, 11L, "read", Instant.now(), Instant.now(), null);
        KbAclVO noId = new KbAclVO(
                2L, LIB_ID, "user", null, "read", Instant.now(), Instant.now(), null);
        when(kbWebClient.listAcls(LIB_ID)).thenReturn(List.of(noType, noId));
        // 即使名字映射里有对应 key，也不该查询到（null 字段条目不构造 SubjectKey）
        when(subjectProxyService.resolveNames(anySet())).thenReturn(Map.of());

        List<KbAclVO> result = facade.listAcls(LIB_ID);

        assertNotNull(result);
        assertEquals(2, result.size());
        assertNull(result.get(0).subjectName());
        assertNull(result.get(1).subjectName());
        // 空 key 集合仍会调用 resolveNames（入参空集合，返回空 map，无副作用）
        verify(subjectProxyService).resolveNames(new HashSet<>());
    }

    @Test
    @DisplayName("listAcls → 空列表原样返回空列表，不调用名称解析")
    void listAcls_emptyListReturnsEmpty() {
        when(kbWebClient.listAcls(LIB_ID)).thenReturn(List.of());

        List<KbAclVO> result = facade.listAcls(LIB_ID);

        assertNotNull(result);
        assertTrue(result.isEmpty());
        verify(subjectProxyService, never()).resolveNames(anySet());
    }
}

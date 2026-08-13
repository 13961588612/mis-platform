package com.mis.adminbff.controller;

import com.mis.adminbff.dto.kb.KbEngineReconcileVO;
import com.mis.adminbff.dto.kb.KbEngineRefVO;
import com.mis.adminbff.dto.kb.KbLibraryDeleteResultVO;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.KbFacadeService;
import com.mis.common.core.result.Result;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * P0 新增的 3 个 BFF 端点行为测试：
 * {@code DELETE /libraries/{id}?mode=}、{@code GET /libraries/{id}/engine-ref}、
 * {@code GET|POST /engine/reconcile}。
 *
 * <p>BFF 层只做参数装配 + 透传，业务规则（默认归档、权限判定的兜底）在 mis-kb / 网关侧裁定；
 * 本测试锁定「{@link KbController} 把请求原样委托给 {@link KbFacadeService}、且不做任何加工」
 * 这一契约，防止将来有人在 BFF 层改写 {@code mode} 或 {@code message} 文案——
 * 那会破坏「默认归档」「已归档未删引擎数据」这两道关键保护。
 *
 * <p>这些端点无 Controller 内判权（权限由网关 {@code sys_api} 收口，{@code @OperLog} 仅留痕），
 * 故只需 mock {@link KbFacadeService}，{@link UserPermissionLoader} 仅用于满足构造函数。
 */
class KbControllerDeleteReconcileTest {

    private static final long LIB_ID = 100L;

    private KbFacadeService kbFacadeService;
    private UserPermissionLoader userPermissionLoader;
    private KbController controller;

    @BeforeEach
    void setUp() {
        kbFacadeService = mock(KbFacadeService.class);
        userPermissionLoader = mock(UserPermissionLoader.class);
        controller = new KbController(kbFacadeService, userPermissionLoader);
    }

    @AfterEach
    void tearDown() {
        // 这些端点不依赖登录上下文，无需清理 ThreadLocal；保留空方法以对齐兄弟测试结构
    }

    // ---------------------------------------------------- DELETE /libraries/{id}?mode=

    @Test
    @DisplayName("DELETE ?mode=archive → 原样委托 facade.deleteLibrary(id, archive)，回执不得改写")
    void deleteLibrary_archiveDelegatesToFacade() {
        KbLibraryDeleteResultVO expected = new KbLibraryDeleteResultVO(
                "archive", Boolean.TRUE, null, "arch-20260811-100", 0L, 0L,
                "已归档，未删除引擎数据");
        when(kbFacadeService.deleteLibrary(LIB_ID, "archive")).thenReturn(expected);

        Result<KbLibraryDeleteResultVO> result = controller.deleteLibrary(LIB_ID, "archive");

        assertNotNull(result);
        assertSame(expected, result.getData(), "回执应原样透传，BFF 不得改写 message");
        verify(kbFacadeService).deleteLibrary(LIB_ID, "archive");
    }

    @Test
    @DisplayName("DELETE ?mode=physical → 原样委托 facade.deleteLibrary(id, physical)")
    void deleteLibrary_physicalDelegatesToFacade() {
        KbLibraryDeleteResultVO expected = new KbLibraryDeleteResultVO(
                "physical", Boolean.TRUE, null, null, 3L, 2L, "已物理删除");
        when(kbFacadeService.deleteLibrary(LIB_ID, "physical")).thenReturn(expected);

        Result<KbLibraryDeleteResultVO> result = controller.deleteLibrary(LIB_ID, "physical");

        assertSame(expected, result.getData());
        verify(kbFacadeService).deleteLibrary(LIB_ID, "physical");
    }

    // ---------------------------------------------------- GET /libraries/{id}/engine-ref

    @Test
    @DisplayName("GET /engine-ref → 委托 facade.getEngineRef(id)，dataset_id 经此唯一路径透出")
    void getEngineRefDelegatesToFacade() {
        KbEngineRefVO expected =
                new KbEngineRefVO(LIB_ID, "ragflow", "ds-abc123", 1, Instant.now());
        when(kbFacadeService.getEngineRef(anyLong())).thenReturn(expected);

        Result<KbEngineRefVO> result = controller.getEngineRef(LIB_ID);

        assertSame(expected, result.getData());
        verify(kbFacadeService).getEngineRef(LIB_ID);
    }

    // ---------------------------------------------------- GET|POST /engine/reconcile

    @Test
    @DisplayName("GET /engine/reconcile → 委托 facade.engineReconcileReport()（只读缓存，无审计）")
    void engineReconcileReportDelegatesToFacade() {
        KbEngineReconcileVO expected = new KbEngineReconcileVO(
                Instant.now(), Boolean.FALSE, null, "ragflow",
                new KbEngineReconcileVO.Counts(1, 1, 0, 0, 0, 0),
                List.of(), List.of(), List.of());
        when(kbFacadeService.engineReconcileReport()).thenReturn(expected);

        Result<KbEngineReconcileVO> result = controller.engineReconcileReport();

        assertSame(expected, result.getData());
        verify(kbFacadeService).engineReconcileReport();
    }

    @Test
    @DisplayName("POST /engine/reconcile → 委托 facade.runEngineReconcile()（触发对账，记审计）")
    void runEngineReconcileDelegatesToFacade() {
        KbEngineReconcileVO expected = new KbEngineReconcileVO(
                Instant.now(), Boolean.FALSE, null, "ragflow",
                new KbEngineReconcileVO.Counts(1, 1, 0, 0, 0, 0),
                List.of(), List.of(), List.of());
        when(kbFacadeService.runEngineReconcile()).thenReturn(expected);

        Result<KbEngineReconcileVO> result = controller.runEngineReconcile();

        assertSame(expected, result.getData());
        verify(kbFacadeService).runEngineReconcile();
    }
}

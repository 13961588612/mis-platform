package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.api.dto.KbLibraryCreateRequest;
import com.mis.kb.api.dto.KbLibraryUpdateRequest;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.LibraryDeleteMode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * KBP-01 库级管理闸门负分支单测（越权一律 40311，且越权发生在任何引擎/落库动作之前）。
 *
 * <p><b>本类承载 {@code KbLibraryServiceDeleteTest} 注释指向的越权负分支</b>
 * （该文件 setUp 默认放行 {@code hasLibraryManage=true}，聚焦删除/归档/回执正分支语义；
 * 越权路径集中在此钉死）。
 *
 * <p>四条用例分别守 KBP-01 的四道闸门，任何一道被改回「不判权」都会立刻挂：
 * <ol>
 *   <li>{@code create} 首行 {@code assertNodeManage(userId, categoryId)}——
 *       目标分类非管辖即 40311，引擎零接触、库零落库；</li>
 *   <li>{@code update} 在 {@code require(id)} 之后 {@code hasLibraryManage}——
 *       非管理 40311，不落库、不打引擎；</li>
 *   <li>{@code delete} 归档路径 {@code hasLibraryManage}——非管理 40311，不 rename、不落库；</li>
 *   <li>{@code delete} 物理删路径同一道闸——非管理 40311，不 deleteLibrary、三表零变更。</li>
 * </ol>
 *
 * <p>用 Mockito 纯单测（与 mis-kb 既有测试风格一致）：事务回滚语义靠「越权后
 * 引擎/仓储零交互」断言——比真起容器测 rollback 更直接也更快。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("KBP-01 知识库写操作越权闸门")
class KbLibraryServiceManageGateTest {

    private static final long LIBRARY_ID = 1_954_321_987_654_321L;
    private static final long CATEGORY_ID = 700L;
    /** KBP-06：写路径新增的 userId 参数（可测性优先，Service 不读线程上下文）。 */
    private static final long USER_ID = 7L;

    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbDocumentRepository documentRepository;
    @Mock
    private KbAclRepository aclRepository;
    @Mock
    private KbCategoryRepository categoryRepository;
    @Mock
    private KnowledgeEnginePort enginePort;
    @Mock
    private NodeAdminResolver nodeAdminResolver;
    /** KBP-06：list(scope=visible) 分支依赖（mock，本测试不触发可见性解析）。 */
    @Mock
    private KbVisibilityService visibilityService;

    private RagflowProperties props;
    private KbLibraryService service;
    private KbLibrary library;

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setType("ragflow");
        props.setDeleteSupported(true);
        service = new KbLibraryService(libraryRepository, documentRepository, aclRepository,
                categoryRepository, enginePort, props, nodeAdminResolver, visibilityService);

        library = new KbLibrary();
        library.setId(LIBRARY_ID);
        library.setCategoryId(CATEGORY_ID);
        library.setName("报销制度");
        library.setSecrecy("internal");
        library.setStatus(LibraryStatus.ENABLED.code());
        library.setEngineType("ragflow");
        library.setEngineLibraryRef("rf-dataset-abc");
        library.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);

        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library));
        // 全局默认「无管理权」——本类只测越权负分支；具体闸门按用例单独放开
        when(nodeAdminResolver.hasLibraryManage(eq(USER_ID), anyLong())).thenReturn(false);
        when(nodeAdminResolver.hasNodeManage(eq(USER_ID), anyLong())).thenReturn(false);
    }

    @Test
    @DisplayName("create：目标分类非管辖 → 40311，引擎零接触、库零落库")
    void createRejectedWhenCategoryNotManageable() {
        // 让 mock 的 assertNodeManage 走真实实现：内部 hasNodeManage（setUp 已 stub=false）
        // → 抛 KB_CATEGORY_NOT_MANAGEABLE(40311)。用 doCallRealMethod 而非 doThrow——
        // 这样才能验证「判定逻辑本身在首行拦截」，而非仅验证异常传播。
        org.mockito.Mockito.doCallRealMethod()
                .when(nodeAdminResolver).assertNodeManage(USER_ID, CATEGORY_ID);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.create(USER_ID,
                        new KbLibraryCreateRequest(CATEGORY_ID, "越权库", "internal", null, null)));

        assertEquals(40311, ex.getCode(), "非管辖分类建库必须 40311");
        verify(nodeAdminResolver).assertNodeManage(USER_ID, CATEGORY_ID);
        verify(enginePort, never()).createLibrary(any());
        verify(libraryRepository, never()).save(any());
    }

    @Test
    @DisplayName("create：管辖断言抛异常时（权限码缺位等）不落库（fail-closed 兜底）")
    void createRejectedWhenAssertThrows() {
        org.mockito.Mockito.doThrow(new com.mis.kb.support.KbBusinessException(
                com.mis.kb.domain.model.KbResultCode.KB_CATEGORY_NOT_MANAGEABLE))
                .when(nodeAdminResolver).assertNodeManage(USER_ID, CATEGORY_ID);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.create(USER_ID,
                        new KbLibraryCreateRequest(CATEGORY_ID, "越权库", "internal", null, null)));

        assertEquals(40311, ex.getCode());
        verify(enginePort, never()).createLibrary(any());
        verify(libraryRepository, never()).save(any());
    }

    @Test
    @DisplayName("update：非 hasLibraryManage → 40311，不落库、不打引擎")
    void updateRejectedWhenNotManageable() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.update(USER_ID, LIBRARY_ID,
                        new KbLibraryUpdateRequest("改名", "internal", null, null)));

        assertEquals(40311, ex.getCode(), "非管理更新必须 40311");
        verify(nodeAdminResolver).hasLibraryManage(USER_ID, LIBRARY_ID);
        verify(libraryRepository, never()).save(any());
        verify(enginePort, never()).updateLibrarySettings(any(), any());
    }

    @Test
    @DisplayName("delete(archive)：非 hasLibraryManage → 40311，不 rename、不落库")
    void deleteArchiveRejectedWhenNotManageable() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE));

        assertEquals(40311, ex.getCode(), "非管理归档必须 40311");
        verify(nodeAdminResolver).hasLibraryManage(USER_ID, LIBRARY_ID);
        verify(enginePort, never()).renameLibrary(any(), any());
        verify(libraryRepository, never()).save(any());
        verify(libraryRepository, never()).delete(any());
    }

    @Test
    @DisplayName("delete(physical)：非 hasLibraryManage → 40311，不 deleteLibrary、三表零变更")
    void deletePhysicalRejectedWhenNotManageable() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL));

        assertEquals(40311, ex.getCode(), "非管理物理删必须 40311");
        verify(nodeAdminResolver).hasLibraryManage(USER_ID, LIBRARY_ID);
        verify(enginePort, never()).deleteLibrary(any());
        verify(documentRepository, never()).deleteByLibraryId(anyLong());
        verify(aclRepository, never()).deleteByLibraryId(anyLong());
        verify(libraryRepository, never()).delete(any());
    }
}

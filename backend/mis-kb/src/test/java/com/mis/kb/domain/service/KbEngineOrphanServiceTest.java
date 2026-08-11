package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.domain.entity.KbEngineOrphan;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.KbEngineOrphanAction;
import com.mis.kb.domain.model.KbEngineOrphanResolveReq;
import com.mis.kb.domain.model.KbEngineOrphanResolveResult;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.repository.KbEngineOrphanRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 游离 dataset 认领/清理服务单测（P1-T3）。
 *
 * <p>覆盖三种正常流程（bind_existing / adopt_new / ignore）与四类护栏
 * （目标库已绑定、ignore 备注过短、动作非法、非 ragflow 引擎）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("P1-T3 游离 dataset 处置")
class KbEngineOrphanServiceTest {

    @Mock
    private KbEngineOrphanRepository orphanRepository;
    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbLibraryService libraryService;
    @Mock
    private KnowledgeEnginePort enginePort;

    private RagflowProperties props;
    private KbEngineOrphanService service;

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setType("ragflow");
        service = new KbEngineOrphanService(orphanRepository, libraryRepository, libraryService, enginePort, props);
        when(enginePort.engineType()).thenReturn("ragflow");
        when(libraryService.expectedEngineName(any(KbLibrary.class))).thenReturn("财务-制度库-123456");
        when(orphanRepository.findByEngineTypeAndNativeId(anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(orphanRepository.save(any(KbEngineOrphan.class))).thenAnswer(inv -> inv.getArgument(0));
        when(libraryRepository.save(any(KbLibrary.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private KbEngineOrphan orphan(String nativeId, String nativeName) {
        KbEngineOrphan o = new KbEngineOrphan();
        o.setId(9001L);
        o.setEngineType("ragflow");
        o.setNativeId(nativeId);
        o.setNativeName(nativeName);
        o.setDocCount(3);
        o.setResolved(0);
        return o;
    }

    private KbLibrary library(long id, String engineLibraryRef) {
        KbLibrary lib = new KbLibrary();
        lib.setId(id);
        lib.setName("制度库");
        lib.setCategoryId(700L);
        lib.setStatus(LibraryStatus.ENABLED.code());
        lib.setEngineLibraryRef(engineLibraryRef);
        return lib;
    }

    @Nested
    @DisplayName("正常流程")
    class Normal {

        /** bind_existing：绑定 ref + 引擎改名到规范名 + 游离行标记 resolved。 */
        @Test
        @DisplayName("认领到已有库：绑定 ref 并改引擎名")
        void bindExisting() {
            KbEngineOrphan o = orphan("ds-1", "实际名");
            KbLibrary target = library(10L, null);
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-1")).thenReturn(Optional.of(o));
            when(libraryRepository.findById(10L)).thenReturn(Optional.of(target));

            KbEngineOrphanResolveResult r = service.resolve(
                    null, "ds-1",
                    new KbEngineOrphanResolveReq(KbEngineOrphanAction.BIND_EXISTING.code(), null, 10L, null, null, null, null),
                    100L);

            assertEquals(1, o.getResolved());
            assertEquals(KbEngineOrphanAction.BIND_EXISTING.code(), o.getResolvedAction());
            assertEquals(100L, o.getResolvedBy().longValue());
            assertEquals("ds-1", target.getEngineLibraryRef());
            verify(enginePort, times(1)).renameLibrary(any(EngineLibraryRef.class), anyString());
            assertEquals(10L, r.libraryId().longValue());
        }

        /** adopt_new：跳过引擎 create、直接落库并绑定 ref。 */
        @Test
        @DisplayName("新建库认领：落库并绑定 ref")
        void adoptNew() {
            KbEngineOrphan o = orphan("ds-2", "实际名");
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-2")).thenReturn(Optional.of(o));
            when(libraryRepository.existsByNameAndCategoryId("新制度库", 700L)).thenReturn(false);

            KbEngineOrphanResolveResult r = service.resolve(
                    null, "ds-2",
                    new KbEngineOrphanResolveReq(KbEngineOrphanAction.ADOPT_NEW.code(), null, null, "新制度库", 700L, "public", 200L),
                    100L);

            assertEquals(1, o.getResolved());
            assertEquals(KbEngineOrphanAction.ADOPT_NEW.code(), o.getResolvedAction());
            // 库 ID 由 IdGenerator 生成（时间戳级大数），只断言「新库已建」而非具体值
            assertNotNull(r.libraryId());
            // 新建库的 owner 取请求里的 200L（而非操作者 100L），且绑定到游离 dataset。
            // save 会被调两次：创建（status=UNKNOWN）+ renameIfNeeded 成功后回写（status=CONSISTENT）。
            // ⚠️ mock 的 save 返回同一可变对象引用（thenAnswer 原样返回入参），两次捕获到的是
            // 同一个实例——到断言时它已被 renameIfNeeded 改成 CONSISTENT，无法观察「创建时」的
            // 中间态，只能断言最终落库状态（引擎改名成功 = CONSISTENT，设计 §1.2 语义）。
            ArgumentCaptor<KbLibrary> captor = ArgumentCaptor.forClass(KbLibrary.class);
            verify(libraryRepository, times(2)).save(captor.capture());
            KbLibrary savedLib = captor.getAllValues().get(0);
            assertEquals(200L, savedLib.getOwner().longValue());
            assertEquals("ds-2", savedLib.getEngineLibraryRef());
            assertEquals(EngineSyncStatus.CONSISTENT, savedLib.getEngineSyncStatus());
            verify(enginePort, times(1)).renameLibrary(any(EngineLibraryRef.class), anyString());
        }

        /** ignore：仅标记已处理，不碰引擎数据。 */
        @Test
        @DisplayName("忽略：标记 resolved 且不动引擎")
        void ignore() {
            KbEngineOrphan o = orphan("ds-3", "实际名");
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-3")).thenReturn(Optional.of(o));

            KbEngineOrphanResolveResult r = service.resolve(
                    null, "ds-3",
                    new KbEngineOrphanResolveReq(KbEngineOrphanAction.IGNORE.code(), "确认该数据集已废弃", null, null, null, null, null),
                    100L);

            assertEquals(1, o.getResolved());
            assertEquals(KbEngineOrphanAction.IGNORE.code(), o.getResolvedAction());
            assertEquals("确认该数据集已废弃", o.getResolvedNote());
            assertEquals(null, r.libraryId());
            verify(enginePort, never()).renameLibrary(any(), any());
        }
    }

    @Nested
    @DisplayName("护栏")
    class Guards {

        /** 目标库已绑定引擎 dataset，不能认领。 */
        @Test
        @DisplayName("bind_existing：目标库已绑定 → 40940")
        void targetBound() {
            KbEngineOrphan o = orphan("ds-4", "实际名");
            KbLibrary target = library(11L, "already-bound");
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-4")).thenReturn(Optional.of(o));
            when(libraryRepository.findById(11L)).thenReturn(Optional.of(target));

            KbBusinessException ex = assertThrows(KbBusinessException.class, () ->
                    service.resolve(null, "ds-4",
                            new KbEngineOrphanResolveReq(KbEngineOrphanAction.BIND_EXISTING.code(), null, 11L, null, null, null, null),
                            100L));
            assertEquals(KbResultCode.KB_ENGINE_ORPHAN_TARGET_BOUND.getCode(), ex.getCode());
            verify(enginePort, never()).renameLibrary(any(), any());
        }

        /** ignore 备注过短。 */
        @Test
        @DisplayName("ignore：备注 < 5 字 → 40941")
        void ignoreNoteTooShort() {
            KbEngineOrphan o = orphan("ds-5", "实际名");
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-5")).thenReturn(Optional.of(o));

            KbBusinessException ex = assertThrows(KbBusinessException.class, () ->
                    service.resolve(null, "ds-5",
                            new KbEngineOrphanResolveReq(KbEngineOrphanAction.IGNORE.code(), "短", null, null, null, null, null),
                            100L));
            assertEquals(KbResultCode.KB_ENGINE_ORPHAN_ACTION_INVALID.getCode(), ex.getCode());
        }

        /** 动作码非法。 */
        @Test
        @DisplayName("动作非法 → 40941")
        void invalidAction() {
            KbEngineOrphan o = orphan("ds-6", "实际名");
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-6")).thenReturn(Optional.of(o));

            KbBusinessException ex = assertThrows(KbBusinessException.class, () ->
                    service.resolve(null, "ds-6",
                            new KbEngineOrphanResolveReq("bogus", null, null, null, null, null, null),
                            100L));
            assertEquals(KbResultCode.KB_ENGINE_ORPHAN_ACTION_INVALID.getCode(), ex.getCode());
        }

        /** 非 ragflow 引擎不应有游离项处置。 */
        @Test
        @DisplayName("非 ragflow 引擎：resolve 直接拒绝")
        void nonRagflowRejected() {
            props.setType("noop");
            KbEngineOrphan o = orphan("ds-7", "实际名");
            when(orphanRepository.findByEngineTypeAndNativeId("noop", "ds-7")).thenReturn(Optional.of(o));

            BusinessException ex = assertThrows(BusinessException.class, () ->
                    service.resolve(null, "ds-7",
                            new KbEngineOrphanResolveReq(KbEngineOrphanAction.IGNORE.code(), "备注足够长", null, null, null, null, null),
                            100L));
            assertNotNull(ex.getMessage());
        }
    }
}

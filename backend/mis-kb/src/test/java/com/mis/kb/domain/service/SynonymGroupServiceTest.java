package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.PageResult;
import com.mis.kb.api.dto.SynonymGroupVO;
import com.mis.kb.domain.entity.KbSynonymConfig;
import com.mis.kb.domain.entity.KbSynonymGroup;
import com.mis.kb.domain.entity.KbSynonymTerm;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SynonymTermNormalizer;
import com.mis.kb.domain.repository.KbSynonymConfigRepository;
import com.mis.kb.domain.repository.KbSynonymGroupRepository;
import com.mis.kb.domain.repository.KbSynonymTermRepository;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbSynonymConflictException;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 术语组服务单测（Wave D · T07 验收）。
 *
 * <p>逐条对应设计文档 T07 的完成判据：
 * <ol>
 *   <li>把已属 A 组的 {@code OKR} 加进 B 组 → 40927，且 {@code data} 三样齐全；</li>
 *   <li><b>停用 A 组后</b>再加 → <b>仍然</b> 40927（Q3 裁决的直接验证）；</li>
 *   <li>冲突检测<b>只查一次库</b>（WD-01 性能红线，用 {@code verify(times(1))} 钉死）；</li>
 *   <li>写事务内 {@code bumpVersion()}，提交后 {@code reloadNow()}（顺序铁律）。</li>
 * </ol>
 *
 * <p><b>为什么把「只查一次库」写成断言而不是靠 code review：</b>
 * 这条约束在代码里长得很不起眼——把批量查换成循环单查，diff 只有三行，评审极易放过。
 * 但它决定了 T08 导入两千组时是 1 次往返还是 2000 次。让它以红灯的形式失败，
 * 比写在注释里靠人自觉可靠得多。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SynonymGroupServiceTest {

    @Mock
    private KbSynonymGroupRepository groupRepository;
    @Mock
    private KbSynonymTermRepository termRepository;
    @Mock
    private KbSynonymConfigRepository configRepository;

    private RecordingDictLoader dictLoader;
    private SynonymGroupService service;

    /** A 组：规范词「关键结果法」，别名「OKR」。 */
    private static final long GROUP_A = 101L;
    /** B 组：规范词「目标管理」。 */
    private static final long GROUP_B = 202L;

    private static final long OPERATOR = 9001L;

    /**
     * 记录刷新调用的加载器替身。
     *
     * <p>仓储全传 {@code null}：本类不该触发任何真实加载；一旦实现里误调 {@code doLoad}，
     * 会立刻以 NPE 炸出来，这正是想要的信号。
     */
    private static final class RecordingDictLoader extends SynonymDictLoader {

        private final List<Long> reloadedVersions = new ArrayList<>();

        private RecordingDictLoader() {
            super(null, null, null, null);
        }

        @Override
        public void reloadNow(long newVersion) {
            reloadedVersions.add(newVersion);
        }
    }

    @BeforeEach
    void setUp() {
        dictLoader = new RecordingDictLoader();
        service = new SynonymGroupService(groupRepository, termRepository, configRepository, dictLoader);
        // 版本自增后的读回值；无事务上下文时 scheduleReload 会同步调用 reloadNow
        when(configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID)).thenReturn(7L);
        when(groupRepository.save(any(KbSynonymGroup.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(termRepository.saveAll(any()))
                .thenAnswer(inv -> new ArrayList<>((Collection<KbSynonymTerm>) inv.getArgument(0)));
    }

    // ---------------------------------------------------------------- 构造工具

    private static KbSynonymGroup group(long id, String canonical, int status) {
        KbSynonymGroup g = new KbSynonymGroup();
        g.setId(id);
        g.setCanonicalTerm(canonical);
        g.setStatus(status);
        g.setCreatedAt(Instant.EPOCH);
        g.setUpdatedAt(Instant.EPOCH);
        return g;
    }

    private static KbSynonymTerm term(long id, long groupId, String raw, boolean canonical, int sortNo) {
        KbSynonymTerm t = new KbSynonymTerm();
        t.setId(id);
        t.setGroupId(groupId);
        t.setTerm(raw);
        t.setTermNorm(SynonymTermNormalizer.normalize(raw));
        t.setCanonical(canonical ? KbSynonymTerm.CANONICAL_YES : KbSynonymTerm.CANONICAL_NO);
        t.setSortNo(sortNo);
        t.setCreatedAt(Instant.EPOCH);
        return t;
    }

    /** 让「OKR」这个词形被 A 组占用。 */
    private void okrOwnedByGroupA(int aStatus) {
        when(termRepository.findByTermNormIn(any()))
                .thenAnswer(inv -> {
                    Collection<String> norms = inv.getArgument(0);
                    return norms.contains("okr")
                            ? List.of(term(1L, GROUP_A, "OKR", false, 1))
                            : List.of();
                });
        when(groupRepository.findById(GROUP_A))
                .thenReturn(Optional.of(group(GROUP_A, "关键结果法", aStatus)));
    }

    // ---------------------------------------------------------------- 冲突检测

    @Nested
    @DisplayName("词条冲突（WD-01 / 40927）")
    class Conflict {

        @Test
        @DisplayName("已属 A 组的 OKR 加进 B 组 → 40927，data 带 term/ownerGroupId/ownerCanonicalTerm")
        void conflictCarriesFullDetail() {
            okrOwnedByGroupA(KbSynonymGroup.STATUS_ENABLED);

            KbSynonymConflictException ex = assertThrows(KbSynonymConflictException.class,
                    () -> service.create("目标管理", List.of("OKR"), null, 1, OPERATOR));

            assertEquals(KbResultCode.KB_SYNONYM_TERM_CONFLICT.getCode(), ex.getCode());
            assertNotNull(ex.detail(), "冲突明细不能为 null");
            // ★ 三样缺一不可：前端 toConflictError 只认这三个字段
            assertEquals("OKR", ex.detail().term(), "term 必须是提交时的原始写法");
            assertEquals(GROUP_A, ex.detail().ownerGroupId());
            assertEquals("关键结果法", ex.detail().ownerCanonicalTerm());
            // data 通道：全局异常处理器要从这里取值写进响应体
            assertSame(ex.detail(), ex.getData(), "getData() 必须返回同一份明细");
        }

        @Test
        @DisplayName("★ Q3：停用 A 组后，OKR 加进 B 组仍然 40927")
        void disabledGroupStillOccupiesTerm() {
            // A 组已停用 —— 但 uk_synonym_term_norm 不带 status 条件，词照样被占
            okrOwnedByGroupA(KbSynonymGroup.STATUS_DISABLED);

            KbSynonymConflictException ex = assertThrows(KbSynonymConflictException.class,
                    () -> service.create("目标管理", List.of("OKR"), null, 1, OPERATOR));

            assertEquals(GROUP_A, ex.detail().ownerGroupId());
            assertTrue(ex.getMessage().contains("已停用"),
                    "message 必须点明停用组同样占用，否则用户会困惑「我明明已经停用了那个组」");
        }

        @Test
        @DisplayName("★ 冲突检测只允许查一次库（批量，不许 N 次单查）")
        void conflictCheckHitsDbExactlyOnce() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.create("目标管理", List.of("OKR", "目标与关键成果", "绩效目标", "KPI"), null, 1, OPERATOR);

            verify(termRepository, times(1)).findByTermNormIn(any());
        }

        @Test
        @DisplayName("全角 ＯＫＲ 与半角 OKR 判为同一个词（U4 · NFKC）")
        void fullWidthConflictsWithHalfWidth() {
            okrOwnedByGroupA(KbSynonymGroup.STATUS_ENABLED);

            KbSynonymConflictException ex = assertThrows(KbSynonymConflictException.class,
                    () -> service.create("目标管理", List.of("ＯＫＲ"), null, 1, OPERATOR));

            // 回传的是用户敲的那个全角原文，不是归一化后的 okr
            assertEquals("ＯＫＲ", ex.detail().term());
            assertEquals("关键结果法", ex.detail().ownerCanonicalTerm());
        }

        @Test
        @DisplayName("编辑时本组自己占用的词不算冲突")
        void selfOwnedTermIsNotConflict() {
            when(groupRepository.findById(GROUP_A))
                    .thenReturn(Optional.of(group(GROUP_A, "关键结果法", 1)));
            when(termRepository.findByTermNormIn(any()))
                    .thenReturn(List.of(term(1L, GROUP_A, "OKR", false, 1)));

            SynonymGroupVO vo = service.update(
                    GROUP_A, "关键结果法", List.of("OKR"), "改个备注", 1, OPERATOR);

            assertEquals("关键结果法", vo.canonicalTerm());
            assertEquals(2, vo.terms().size());
        }

        @Test
        @DisplayName("多个冲突时报最靠前那个，保证报错稳定可复现")
        void reportsFirstConflictInSubmitOrder() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of(
                    term(1L, GROUP_A, "KPI", false, 1),
                    term(2L, GROUP_A, "OKR", false, 2)));
            when(groupRepository.findById(GROUP_A))
                    .thenReturn(Optional.of(group(GROUP_A, "关键结果法", 1)));

            KbSynonymConflictException ex = assertThrows(KbSynonymConflictException.class,
                    () -> service.create("目标管理", List.of("OKR", "KPI"), null, 1, OPERATOR));

            assertEquals("OKR", ex.detail().term(), "OKR 在提交列表里更靠前");
        }

        @Test
        @DisplayName("findConflictOwners 一次报回全部冲突（供 T08 逐行报告用），不抛异常")
        void findConflictOwnersReportsAllWithoutThrowing() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of(
                    term(1L, GROUP_A, "OKR", false, 1),
                    term(2L, GROUP_B, "KPI", false, 1)));

            Map<String, Long> owners = service.findConflictOwners(null, Set.of("okr", "kpi", "新词"));

            assertEquals(2, owners.size());
            assertEquals(GROUP_A, owners.get("okr"));
            assertEquals(GROUP_B, owners.get("kpi"));
            assertNull(owners.get("新词"));
        }
    }

    // ---------------------------------------------------------------- 词条落库

    @Nested
    @DisplayName("组内词条落库")
    class Terms {

        @Test
        @DisplayName("规范词恒在首位：canonical=1 且 sortNo=0，别名从 1 递增")
        void canonicalFirstAliasesFromOne() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.create("关键结果法", List.of("OKR", "目标与关键成果"), null, 1, OPERATOR);

            ArgumentCaptor<List<KbSynonymTerm>> captor = ArgumentCaptor.forClass(List.class);
            verify(termRepository).saveAll(captor.capture());
            List<KbSynonymTerm> saved = captor.getValue();

            assertEquals(3, saved.size());
            assertEquals("关键结果法", saved.get(0).getTerm());
            assertTrue(saved.get(0).isCanonical());
            assertEquals(0, saved.get(0).getSortNo());

            assertEquals("OKR", saved.get(1).getTerm());
            assertFalse(saved.get(1).isCanonical());
            assertEquals(1, saved.get(1).getSortNo());

            assertEquals("目标与关键成果", saved.get(2).getTerm());
            assertEquals(2, saved.get(2).getSortNo());
        }

        @Test
        @DisplayName("term_norm 落归一化词形，term 落原文")
        void storesBothRawAndNormalizedForms() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.create("关键结果法", List.of("ＯＫＲ"), null, 1, OPERATOR);

            ArgumentCaptor<List<KbSynonymTerm>> captor = ArgumentCaptor.forClass(List.class);
            verify(termRepository).saveAll(captor.capture());
            KbSynonymTerm alias = captor.getValue().get(1);

            assertEquals("ＯＫＲ", alias.getTerm(), "原文保留用户写法");
            assertEquals("okr", alias.getTermNorm(), "唯一性走归一化词形");
        }

        @Test
        @DisplayName("同批内 OKR 与 ＯＫＲ 静默合并，不撞唯一索引")
        void deduplicatesWithinSameSubmission() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.create("关键结果法", List.of("OKR", "ＯＫＲ", "okr"), null, 1, OPERATOR);

            ArgumentCaptor<List<KbSynonymTerm>> captor = ArgumentCaptor.forClass(List.class);
            verify(termRepository).saveAll(captor.capture());

            assertEquals(2, captor.getValue().size(), "规范词 + 一个别名，三种写法只留最先出现的");
            assertEquals("OKR", captor.getValue().get(1).getTerm());
        }

        @Test
        @DisplayName("别名与规范词同词时不重复落库")
        void aliasEqualToCanonicalIsDropped() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.create("OKR", List.of("okr", "目标"), null, 1, OPERATOR);

            ArgumentCaptor<List<KbSynonymTerm>> captor = ArgumentCaptor.forClass(List.class);
            verify(termRepository).saveAll(captor.capture());

            assertEquals(2, captor.getValue().size());
            assertEquals("OKR", captor.getValue().get(0).getTerm());
            assertEquals("目标", captor.getValue().get(1).getTerm());
        }

        @Test
        @DisplayName("编辑走先删后插，且删完必须 flush（否则新插的 term_norm 会撞旧行）")
        void updateDeletesThenFlushesThenInserts() {
            when(groupRepository.findById(GROUP_A))
                    .thenReturn(Optional.of(group(GROUP_A, "关键结果法", 1)));
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.update(GROUP_A, "关键结果法", List.of("OKR"), null, 1, OPERATOR);

            verify(termRepository).deleteByGroupId(GROUP_A);
            verify(termRepository).flush();
            verify(termRepository).saveAll(any());
        }

        @Test
        @DisplayName("空白规范词被拒（参数校验，不是 500）")
        void blankCanonicalTermRejected() {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.create("   ", List.of("OKR"), null, 1, OPERATOR));
            assertTrue(ex.getMessage().contains("规范词"));
            verify(termRepository, never()).saveAll(any());
        }
    }

    // ---------------------------------------------------------------- 版本与刷新

    @Nested
    @DisplayName("版本自增与词典刷新（顺序铁律）")
    class VersionAndReload {

        @Test
        @DisplayName("新建后：bumpVersion 一次 + reloadNow 收到新版本号")
        void createBumpsVersionThenReloads() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.create("关键结果法", List.of("OKR"), null, 1, OPERATOR);

            verify(configRepository, times(1)).bumpVersion(any(Instant.class), eq(OPERATOR));
            assertEquals(List.of(7L), dictLoader.reloadedVersions);
        }

        @Test
        @DisplayName("编辑后同样自增并刷新")
        void updateBumpsVersionThenReloads() {
            when(groupRepository.findById(GROUP_A))
                    .thenReturn(Optional.of(group(GROUP_A, "关键结果法", 1)));
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());

            service.update(GROUP_A, "关键结果法", List.of("OKR"), null, 1, OPERATOR);

            verify(configRepository, times(1)).bumpVersion(any(Instant.class), eq(OPERATOR));
            assertEquals(List.of(7L), dictLoader.reloadedVersions);
        }

        @Test
        @DisplayName("删除后同样自增并刷新，且词条先于组被删")
        void deleteBumpsVersionThenReloads() {
            when(groupRepository.findById(GROUP_A))
                    .thenReturn(Optional.of(group(GROUP_A, "关键结果法", 1)));

            service.delete(GROUP_A, OPERATOR);

            verify(termRepository).deleteByGroupId(GROUP_A);
            verify(groupRepository).delete(any(KbSynonymGroup.class));
            verify(configRepository, times(1)).bumpVersion(any(Instant.class), eq(OPERATOR));
            assertEquals(List.of(7L), dictLoader.reloadedVersions);
        }

        @Test
        @DisplayName("冲突抛出时不得自增版本、不得刷新（写入根本没发生）")
        void conflictDoesNotTouchVersion() {
            okrOwnedByGroupA(KbSynonymGroup.STATUS_ENABLED);

            assertThrows(KbSynonymConflictException.class,
                    () -> service.create("目标管理", List.of("OKR"), null, 1, OPERATOR));

            verify(configRepository, never()).bumpVersion(any(), any());
            assertTrue(dictLoader.reloadedVersions.isEmpty());
        }

        @Test
        @DisplayName("config 单行缺失时降级为不刷新，但不抛异常（词表是增强能力，不该拖死写入）")
        void missingConfigRowDegradesGracefully() {
            when(termRepository.findByTermNormIn(any())).thenReturn(List.of());
            when(configRepository.findVersionById(KbSynonymConfig.SINGLETON_ID)).thenReturn(null);

            SynonymGroupVO vo = service.create("关键结果法", List.of("OKR"), null, 1, OPERATOR);

            assertNotNull(vo);
            assertTrue(dictLoader.reloadedVersions.isEmpty());
        }
    }

    // ---------------------------------------------------------------- 查询

    @Nested
    @DisplayName("分页搜索（WD-03）")
    class Search {

        @Test
        @DisplayName("命中别名时回填 matchedAlias，命中规范词时不回填")
        void matchedAliasOnlyWhenCanonicalMisses() {
            KbSynonymGroup a = group(GROUP_A, "关键结果法", 1);
            when(groupRepository.search(any(), any(), any(Pageable.class)))
                    .thenReturn(new PageImpl<>(List.of(a)));
            when(termRepository.findByGroupIdInOrderBySortNo(any())).thenReturn(List.of(
                    term(1L, GROUP_A, "关键结果法", true, 0),
                    term(2L, GROUP_A, "OKR", false, 1)));

            PageResult<SynonymGroupVO> byAlias = service.search("okr", null, 0, 20);
            assertEquals("OKR", byAlias.getList().get(0).matchedAlias());

            PageResult<SynonymGroupVO> byCanonical = service.search("关键", null, 0, 20);
            assertNull(byCanonical.getList().get(0).matchedAlias(),
                    "规范词自己就显示在列表上，再提示一次纯属噪声");
        }

        @Test
        @DisplayName("列表只带 termCount 不带 terms（避免响应体膨胀）")
        void listOmitsTermsButKeepsCount() {
            when(groupRepository.search(any(), any(), any(Pageable.class)))
                    .thenReturn(new PageImpl<>(List.of(group(GROUP_A, "关键结果法", 1))));
            when(termRepository.findByGroupIdInOrderBySortNo(any())).thenReturn(List.of(
                    term(1L, GROUP_A, "关键结果法", true, 0),
                    term(2L, GROUP_A, "OKR", false, 1)));

            SynonymGroupVO vo = service.search(null, null, 0, 20).getList().get(0);

            assertNull(vo.terms());
            assertEquals(2, vo.termCount());
        }

        @Test
        @DisplayName("★ size 超上限被截断到 200，size<=0 回落 20（WD-03：不许拉全表）")
        void pageSizeIsClamped() {
            when(groupRepository.search(any(), any(), any(Pageable.class)))
                    .thenReturn(new PageImpl<>(List.of()));

            ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);

            service.search(null, null, 0, 100000);
            service.search(null, null, 0, 0);
            verify(groupRepository, times(2)).search(any(), any(), captor.capture());

            assertEquals(200, captor.getAllValues().get(0).getPageSize());
            assertEquals(20, captor.getAllValues().get(1).getPageSize());
        }

        @Test
        @DisplayName("关键词转小写后加通配符；空白关键词传 null（不过滤）")
        void keywordIsLoweredAndWrapped() {
            when(groupRepository.search(any(), any(), any(Pageable.class)))
                    .thenReturn(new PageImpl<>(List.of()));

            ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);

            service.search("OKR", null, 0, 20);
            service.search("   ", null, 0, 20);
            verify(groupRepository, times(2)).search(captor.capture(), any(), any(Pageable.class));

            assertEquals("%okr%", captor.getAllValues().get(0));
            assertNull(captor.getAllValues().get(1));
        }

        @Test
        @DisplayName("详情回填完整 terms")
        void detailReturnsAllTerms() {
            when(groupRepository.findById(GROUP_A))
                    .thenReturn(Optional.of(group(GROUP_A, "关键结果法", 1)));
            when(termRepository.findByGroupIdOrderBySortNo(GROUP_A)).thenReturn(List.of(
                    term(1L, GROUP_A, "关键结果法", true, 0),
                    term(2L, GROUP_A, "OKR", false, 1)));

            SynonymGroupVO vo = service.get(GROUP_A);

            assertEquals(2, vo.terms().size());
            assertTrue(vo.terms().get(0).canonical());
            assertEquals("OKR", vo.terms().get(1).term());
        }

        @Test
        @DisplayName("组不存在 → 40415")
        void missingGroupYields40415() {
            when(groupRepository.findById(anyLong())).thenReturn(Optional.empty());

            KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.get(999L));
            assertEquals(KbResultCode.KB_SYNONYM_GROUP_NOT_FOUND.getCode(), ex.getCode());
        }

        @Test
        @DisplayName("空结果页不触发词条查询（省掉一次无意义往返）")
        void emptyPageSkipsTermLookup() {
            Page<KbSynonymGroup> empty = new PageImpl<>(List.of());
            when(groupRepository.search(any(), any(), any(Pageable.class))).thenReturn(empty);

            PageResult<SynonymGroupVO> result = service.search("查不到的词", null, 0, 20);

            assertTrue(result.getList().isEmpty());
            verify(termRepository, never()).findByGroupIdInOrderBySortNo(any());
        }
    }
}

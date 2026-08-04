package com.mis.kb.domain.service;

import com.mis.kb.domain.model.GroupEntry;
import com.mis.kb.domain.model.SynonymDictionary;
import com.mis.kb.domain.model.SynonymExpansion;
import com.mis.kb.domain.model.SynonymHit;
import com.mis.kb.domain.model.SynonymTermNormalizer;
import com.mis.kb.engine.SynonymProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 同义词扩展服务单测（Wave D · T05 验收）。
 *
 * <p>覆盖设计文档 §7.4 的七步算法与 PRD 的四类验收点：
 * <ol>
 *   <li><b>最长匹配</b>——长词优先，同组只取首次；</li>
 *   <li><b>ASCII 词边界</b>——{@code IT} 不得命中 {@code WITH}（D6-3 的红线用例）；</li>
 *   <li><b>预算截断</b>——组数优先丢弃、字符超预算整组回退；</li>
 *   <li><b>短词过滤</b>——低于 {@code minTermLength} 不参与匹配，但要如实回传（WD-19）；</li>
 *   <li><b>四态收敛</b>——{@code EXPANDED / NO_MATCH / DISABLED_GLOBAL / DISABLED_REQUEST}，
 *       且 {@code DISABLED_*} 两态<b>绝不合并</b>。</li>
 * </ol>
 *
 * <p><b>测试替身策略：</b>用 {@link FixedDictLoader} 覆写 {@code current()} / {@code ensureFresh()} /
 * {@code enabled()}，仓储传 {@code null} —— 本类只验证<b>纯算法</b>，一次数据库都不该碰。
 * 若哪天实现里偷偷加了查库，这些用例会立刻以 NPE 的形式炸出来，这正是我们要的信号。
 */
class SynonymExpandServiceTest {

    // ---------------------------------------------------------------- 测试替身与构造工具

    /**
     * 固定词典的加载器替身。
     *
     * <p>记录 {@code ensureFresh()} 调用次数，用于证明「热路径 {@code expand()} 不做版本校验、
     * 命中测试 {@code expandFresh()} 才做」这条 AC-06 前提。
     */
    private static final class FixedDictLoader extends SynonymDictLoader {

        private final SynonymDictionary dictionary;
        private final boolean dbEnabled;
        private int ensureFreshCalls = 0;

        private FixedDictLoader(SynonymDictionary dictionary, boolean dbEnabled) {
            super(null, null, null, null);
            this.dictionary = dictionary;
            this.dbEnabled = dbEnabled;
        }

        @Override
        public SynonymDictionary current() {
            return dictionary;
        }

        @Override
        public SynonymDictionary ensureFresh() {
            ensureFreshCalls++;
            return dictionary;
        }

        @Override
        public boolean enabled() {
            return dbEnabled;
        }
    }

    /** 组装一份内存词典：termIndex 由 orderedTerms 归一化后自动生成。 */
    private static SynonymDictionary dictOf(GroupEntry... entries) {
        Map<String, Long> index = new HashMap<>();
        Map<Long, GroupEntry> groups = new HashMap<>();
        for (GroupEntry e : entries) {
            groups.put(e.groupId(), e);
            for (String term : e.orderedTerms()) {
                index.put(SynonymTermNormalizer.normalize(term), e.groupId());
            }
        }
        return new SynonymDictionary(1L, index, groups);
    }

    /** 快捷构造一个术语组：首个词即规范词。 */
    private static GroupEntry group(long id, String canonical, String... aliases) {
        List<String> ordered = new ArrayList<>(aliases.length + 1);
        ordered.add(canonical);
        ordered.addAll(List.of(aliases));
        return new GroupEntry(id, canonical, ordered);
    }

    private static SynonymProperties props() {
        return new SynonymProperties();
    }

    private static SynonymExpandService serviceOf(SynonymDictionary dict, SynonymProperties p) {
        return new SynonymExpandService(new FixedDictLoader(dict, true), p);
    }

    /**
     * 去掉全部就地插入片段，还原原问句。
     *
     * <p>「原问句字符 100% 保留」这条约束光靠肉眼看断言字符串是保证不了的 ——
     * 用例里的期望串本身就可能抄错。这个还原函数把约束变成可机检的等式。
     *
     * @param expanded 扩展后的查询串
     * @return 剥离所有 {@code （…）} 插入段后的字符串
     */
    private static String stripInsertions(String expanded) {
        StringBuilder sb = new StringBuilder(expanded.length());
        int depth = 0;
        for (int i = 0; i < expanded.length(); i++) {
            char c = expanded.charAt(i);
            if (c == '（') {
                depth++;
            } else if (c == '）') {
                depth--;
            } else if (depth == 0) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    // ---------------------------------------------------------------- 一、基本扩展

    @Nested
    @DisplayName("基本扩展：就地插入，原问句字符一个不动")
    class BasicExpansion {

        @Test
        @DisplayName("OKR 怎么填 → EXPANDED，插入格式为 原词（别名…）")
        void expandsSingleGroup() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "OKR", "目标与关键成果")), props());

            SynonymExpansion r = svc.expand("OKR 怎么填", false);

            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
            assertEquals("OKR（目标与关键成果） 怎么填", r.expandedQuery());
            assertEquals("OKR 怎么填", r.originalQuestion());
            assertEquals(1, r.totalMatchedGroups());
            assertEquals(1, r.usedGroups());
            assertFalse(r.truncated());
            assertEquals("OKR 怎么填", stripInsertions(r.expandedQuery()),
                    "剥掉插入段必须逐字符还原原问句");
        }

        @Test
        @DisplayName("命中轨迹如实记录组 ID、命中面、规范词与并入数量")
        void hitTrailIsAccurate() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(7L, "报销", "费用报销", "实报实销")), props());

            SynonymExpansion r = svc.expand("报销怎么弄", false);

            assertEquals(1, r.hits().size());
            SynonymHit hit = r.hits().get(0);
            assertEquals(7L, hit.groupId());
            assertEquals("报销", hit.matchedTerm());
            assertEquals("报销", hit.canonicalTerm());
            assertEquals(2, hit.addedTermCount(), "规范词与命中面重复，只应并入 2 个别名");
        }

        @Test
        @DisplayName("U4 集成验证：全角 ＯＫＲ 同样命中半角词条")
        void fullWidthQuestionStillMatches() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "OKR", "目标与关键成果")), props());

            SynonymExpansion r = svc.expand("ＯＫＲ 怎么填", false);

            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
            assertEquals("ＯＫＲ（目标与关键成果） 怎么填", r.expandedQuery(),
                    "命中面必须保留原文的全角形态，只有匹配是归一化的");
        }

        @Test
        @DisplayName("同一组在句中出现两次只扩展首次")
        void sameGroupExpandedOnlyOnce() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "报销", "费用报销")), props());

            SynonymExpansion r = svc.expand("报销的报销流程", false);

            assertEquals(1, r.hits().size());
            assertEquals(1, r.totalMatchedGroups());
            assertEquals("报销（费用报销）的报销流程", r.expandedQuery());
        }

        @Test
        @DisplayName("已在原句中出现的别名不重复并入")
        void aliasAlreadyPresentIsNotAdded() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "报销", "费用报销", "实报实销")), props());

            SynonymExpansion r = svc.expand("报销和费用报销一样吗", false);

            assertEquals("报销（实报实销）和费用报销一样吗", r.expandedQuery());
            assertEquals(1, r.hits().get(0).addedTermCount());
        }

        @Test
        @DisplayName("问句含正则元字符（? + ( 等）不影响装配")
        void regexMetaCharactersAreSafe() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "报销", "费用报销")), props());

            SynonymExpansion r = svc.expand("报销 (a+b)*c ? 怎么算", false);

            assertEquals("报销（费用报销） (a+b)*c ? 怎么算", r.expandedQuery());
            assertEquals("报销 (a+b)*c ? 怎么算", stripInsertions(r.expandedQuery()));
        }
    }

    // ---------------------------------------------------------------- 二、最长匹配

    @Nested
    @DisplayName("最长匹配：长词优先，短词不得抢先")
    class LongestMatch {

        @Test
        @DisplayName("「年假」与「年假申请」共存时，命中长的那个")
        void longerTermWins() {
            SynonymExpandService svc = serviceOf(
                    dictOf(
                            group(1L, "年假", "带薪年假"),
                            group(2L, "年假申请", "休假申请")),
                    props());

            SynonymExpansion r = svc.expand("年假申请怎么走", false);

            assertEquals(1, r.hits().size());
            assertEquals(2L, r.hits().get(0).groupId(), "必须命中更长的「年假申请」");
            assertEquals("年假申请（休假申请）怎么走", r.expandedQuery());
        }

        @Test
        @DisplayName("命中后指针跳过整段，不在词内二次匹配")
        void cursorSkipsMatchedSpan() {
            SynonymExpandService svc = serviceOf(
                    dictOf(
                            group(1L, "申请", "提交"),
                            group(2L, "年假申请", "休假申请")),
                    props());

            SynonymExpansion r = svc.expand("年假申请单", false);

            assertEquals(1, r.hits().size(), "「申请」被包含在已命中区间里，不应再单独命中");
            assertEquals(2L, r.hits().get(0).groupId());
        }
    }

    // ---------------------------------------------------------------- 三、词边界

    @Nested
    @DisplayName("ASCII 词边界：IT 不得命中 WITH（D6-3 红线）")
    class WordBoundary {

        @Test
        @DisplayName("WITH 语句怎么写 + 词条 IT → 不命中，返回 NO_MATCH")
        void itDoesNotMatchInsideWith() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "IT", "信息技术部")), props());

            SynonymExpansion r = svc.expand("WITH 语句怎么写", false);

            assertEquals(SynonymExpansion.STATUS_NO_MATCH, r.status());
            assertEquals("WITH 语句怎么写", r.expandedQuery());
            assertTrue(r.hits().isEmpty());
        }

        @Test
        @DisplayName("IT 部门在哪 + 词条 IT（minTermLength=2） → 命中")
        void standaloneItMatches() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "IT", "信息技术部")), props());

            SynonymExpansion r = svc.expand("IT 部门在哪", false);

            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
            assertEquals("IT（信息技术部） 部门在哪", r.expandedQuery());
        }

        @Test
        @DisplayName("中文词不受边界限制：请假流程里的「请假」照常命中")
        void chineseTermHasNoBoundaryRequirement() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "请假", "休假")), props());

            SynonymExpansion r = svc.expand("请假流程", false);

            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
            assertEquals("请假（休假）流程", r.expandedQuery());
        }
    }

    // ---------------------------------------------------------------- 四、短词过滤

    @Nested
    @DisplayName("短词过滤（WD-19）：不参与匹配，但必须如实回传")
    class ShortTerms {

        @Test
        @DisplayName("minTermLength=3 时词条 IT 不参与匹配，进 skippedShortTerms")
        void shortTermIsSkippedButReported() {
            SynonymProperties p = props();
            p.setMinTermLength(3);
            SynonymExpandService svc = serviceOf(dictOf(group(1L, "IT", "信息技术部")), p);

            SynonymExpansion r = svc.expand("IT 部门在哪", false);

            assertEquals(SynonymExpansion.STATUS_NO_MATCH, r.status());
            assertEquals("IT 部门在哪", r.expandedQuery());
            assertEquals(List.of("IT"), r.skippedShortTerms(),
                    "管理员必须能看到「IT 因过短未生效」，否则会反复重录同一个词");
            assertEquals(3, r.budget().minTermLength(), "预算快照要带上门槛值供前端组文案");
        }

        @Test
        @DisplayName("短词未出现在问句中时不入 skippedShortTerms（不制造噪声）")
        void absentShortTermIsNotReported() {
            SynonymProperties p = props();
            p.setMinTermLength(3);
            SynonymExpandService svc = serviceOf(dictOf(group(1L, "IT", "信息技术部")), p);

            SynonymExpansion r = svc.expand("财务部门在哪", false);

            assertTrue(r.skippedShortTerms().isEmpty());
        }
    }

    // ---------------------------------------------------------------- 五、预算截断

    @Nested
    @DisplayName("预算截断：组数优先丢弃，字符超限整组回退")
    class BudgetTruncation {

        /** 造 12 组各带一个别名的词典：a1..a12 为规范词，b1..b12 为别名。 */
        private SynonymDictionary twelveGroups() {
            GroupEntry[] entries = new GroupEntry[12];
            for (int i = 1; i <= 12; i++) {
                entries[i - 1] = group(i, "a" + i, "b" + i);
            }
            return dictOf(entries);
        }

        @Test
        @DisplayName("命中 12 组、maxGroups=8 → used=8 / dropped=4 / total=12")
        void groupCountTruncation() {
            SynonymProperties p = props();
            p.setMaxGroups(8);
            SynonymExpandService svc = serviceOf(twelveGroups(), p);

            String question = "a1 a2 a3 a4 a5 a6 a7 a8 a9 a10 a11 a12";
            SynonymExpansion r = svc.expand(question, false);

            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
            assertEquals(12, r.totalMatchedGroups());
            assertEquals(8, r.usedGroups());
            assertEquals(List.of("a9", "a10", "a11", "a12"), r.droppedGroups(),
                    "丢弃的必须是命中位置最靠后的 4 组，且以规范词呈现");
            assertTrue(r.truncated());
            assertEquals(question, stripInsertions(r.expandedQuery()));
            assertEquals(8, r.hits().size());
        }

        @Test
        @DisplayName("每组并入上限 = maxTermsPerGroup（规范词不占额度）")
        void perGroupTermLimit() {
            SynonymProperties p = props();
            p.setMaxTermsPerGroup(2);
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "报销", "费用报销", "实报实销", "报账", "冲账")), p);

            SynonymExpansion r = svc.expand("报销怎么弄", false);

            // orderedTerms 取前 maxTermsPerGroup + 1 = 3 项：规范词 + 2 个别名
            assertEquals("报销（费用报销 实报实销）怎么弄", r.expandedQuery());
            assertEquals(2, r.hits().get(0).addedTermCount());
        }

        @Test
        @DisplayName("字符超预算 → 从最靠后的组开始整组回退，直到装得下")
        void charBudgetRollsBackWholeGroups() {
            SynonymProperties p = props();
            p.setMaxQueryChars(20);
            SynonymExpandService svc = serviceOf(
                    dictOf(
                            group(1L, "报销", "费用报销", "实报实销"),
                            group(2L, "流程", "步骤", "办理流程")),
                    p);

            SynonymExpansion r = svc.expand("报销流程是什么", false);

            assertEquals("报销（费用报销 实报实销）流程是什么", r.expandedQuery());
            assertTrue(r.expandedQuery().length() <= 20);
            assertEquals(2, r.totalMatchedGroups());
            assertEquals(1, r.usedGroups());
            assertEquals(List.of("流程"), r.droppedGroups());
            assertTrue(r.truncated());
        }

        @Test
        @DisplayName("预算极紧 → 全部回退，扩展串等于原问句（仍是 EXPANDED + truncated）")
        void allGroupsRolledBack() {
            SynonymProperties p = props();
            p.setMaxQueryChars(12);
            SynonymExpandService svc = serviceOf(
                    dictOf(
                            group(1L, "报销", "费用报销", "实报实销"),
                            group(2L, "流程", "步骤", "办理流程")),
                    p);

            SynonymExpansion r = svc.expand("报销流程是什么", false);

            // 刻意不收敛成 NO_MATCH：命中过 2 组只是被预算挡了，
            // 报成「未命中术语」会让管理员去改词表，而真正该改的是预算。
            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
            assertEquals("报销流程是什么", r.expandedQuery());
            assertEquals(2, r.totalMatchedGroups());
            assertEquals(0, r.usedGroups());
            assertEquals(2, r.droppedGroups().size());
            assertTrue(r.truncated());
        }

        @Test
        @DisplayName("原问句自身超 maxQueryChars → 字符级硬截，且本次不扩展")
        void oversizedQuestionIsHardCut() {
            SynonymProperties p = props();
            p.setMaxQueryChars(10);
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "报销", "费用报销")), p);

            String question = "报销报销报销报销报销报销";
            SynonymExpansion r = svc.expand(question, false);

            assertEquals(10, r.expandedQuery().length());
            assertEquals(question.substring(0, 10), r.expandedQuery());
            assertTrue(r.truncated());
            assertEquals(0, r.usedGroups());
            assertTrue(r.hits().isEmpty());
        }
    }

    // ---------------------------------------------------------------- 六、四态收敛

    @Nested
    @DisplayName("四态收敛：DISABLED_GLOBAL 与 DISABLED_REQUEST 绝不合并")
    class FourStates {

        @Test
        @DisplayName("Nacos 熔断闸关 → DISABLED_GLOBAL，扩展串逐字符等于原问句")
        void nacosKillSwitchYieldsDisabledGlobal() {
            SynonymProperties p = props();
            p.setEnabled(false);
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "OKR", "目标与关键成果")), p);

            SynonymExpansion r = svc.expand("OKR 怎么填", false);

            assertEquals(SynonymExpansion.STATUS_DISABLED_GLOBAL, r.status());
            assertEquals("OKR 怎么填", r.expandedQuery());
            assertEquals(r.originalQuestion(), r.expandedQuery());
            assertTrue(r.hits().isEmpty());
            assertFalse(r.truncated());
        }

        @Test
        @DisplayName("库内开关关 → 同样是 DISABLED_GLOBAL（双闸相与，Q2）")
        void dbSwitchOffYieldsDisabledGlobal() {
            SynonymExpandService svc = new SynonymExpandService(
                    new FixedDictLoader(dictOf(group(1L, "OKR", "目标与关键成果")), false),
                    props());

            SynonymExpansion r = svc.expand("OKR 怎么填", false);

            assertEquals(SynonymExpansion.STATUS_DISABLED_GLOBAL, r.status());
            assertEquals("OKR 怎么填", r.expandedQuery());
        }

        @Test
        @DisplayName("本次请求关 → DISABLED_REQUEST，且优先级低于全局闸")
        void perRunDisableYieldsDisabledRequest() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "OKR", "目标与关键成果")), props());

            SynonymExpansion r = svc.expand("OKR 怎么填", true);

            assertEquals(SynonymExpansion.STATUS_DISABLED_REQUEST, r.status());
            assertEquals("OKR 怎么填", r.expandedQuery());
        }

        @Test
        @DisplayName("全局关 + 本次也关 → 报 DISABLED_GLOBAL（管理员该去改的是全局开关）")
        void globalSwitchWinsOverPerRun() {
            SynonymProperties p = props();
            p.setEnabled(false);
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "OKR", "目标与关键成果")), p);

            assertEquals(SynonymExpansion.STATUS_DISABLED_GLOBAL,
                    svc.expand("OKR 怎么填", true).status());
        }

        @Test
        @DisplayName("空词典 / 空问句 → NO_MATCH，绝不返回 null")
        void emptyInputsYieldNoMatch() {
            SynonymExpandService empty = serviceOf(SynonymDictionary.empty(), props());
            SynonymExpansion r1 = empty.expand("OKR 怎么填", false);
            assertEquals(SynonymExpansion.STATUS_NO_MATCH, r1.status());
            assertEquals("OKR 怎么填", r1.expandedQuery());

            SynonymExpandService svc = serviceOf(dictOf(group(1L, "OKR", "目标")), props());
            SynonymExpansion r2 = svc.expand("   ", false);
            assertEquals(SynonymExpansion.STATUS_NO_MATCH, r2.status());
            assertEquals("   ", r2.expandedQuery());

            SynonymExpansion r3 = svc.expand(null, false);
            assertNotNull(r3);
            assertEquals(SynonymExpansion.STATUS_NO_MATCH, r3.status());
            assertEquals("", r3.expandedQuery());
        }

        @Test
        @DisplayName("四态下 budget 与 expandedQuery 恒非空（前端不需要判空）")
        void budgetAndQueryAlwaysPresent() {
            SynonymProperties off = props();
            off.setEnabled(false);
            List<SynonymExpansion> all = List.of(
                    serviceOf(dictOf(group(1L, "OKR", "目标")), props()).expand("OKR", false),
                    serviceOf(dictOf(group(1L, "OKR", "目标")), props()).expand("零命中", false),
                    serviceOf(dictOf(group(1L, "OKR", "目标")), off).expand("OKR", false),
                    serviceOf(dictOf(group(1L, "OKR", "目标")), props()).expand("OKR", true));

            for (SynonymExpansion r : all) {
                assertNotNull(r.budget(), "状态 " + r.status() + " 的 budget 不得为空");
                assertNotNull(r.expandedQuery(), "状态 " + r.status() + " 的 expandedQuery 不得为空");
                assertNotNull(r.hits());
                assertNotNull(r.droppedGroups());
                assertNotNull(r.skippedShortTerms());
            }
        }
    }

    // ---------------------------------------------------------------- 七、热路径与强一致

    @Nested
    @DisplayName("热路径零查询 vs 命中测试强一致（AC-06 / Q7）")
    class FreshnessContract {

        @Test
        @DisplayName("expand() 不触发 ensureFresh，expandFresh() 每次都触发")
        void onlyHitTestForcesVersionCheck() {
            FixedDictLoader loader =
                    new FixedDictLoader(dictOf(group(1L, "OKR", "目标与关键成果")), true);
            SynonymExpandService svc = new SynonymExpandService(loader, props());

            svc.expand("OKR 怎么填", false);
            svc.expand("OKR 怎么填", false);
            assertEquals(0, loader.ensureFreshCalls,
                    "问答热路径一旦调用 ensureFresh，AC-06「热路径不查库」即告失守");

            svc.expandFresh("OKR 怎么填", false);
            assertEquals(1, loader.ensureFreshCalls);
        }

        @Test
        @DisplayName("expandFresh 与 expand 产出同一份结果（AC-03：所见即所得）")
        void bothPathsShareTheSameAlgorithm() {
            SynonymExpandService svc = serviceOf(
                    dictOf(group(1L, "OKR", "目标与关键成果")), props());

            SynonymExpansion hot = svc.expand("OKR 怎么填", false);
            SynonymExpansion fresh = svc.expandFresh("OKR 怎么填", false);

            assertEquals(hot.status(), fresh.status());
            assertEquals(hot.expandedQuery(), fresh.expandedQuery());
            assertEquals(hot.hits().size(), fresh.hits().size());
        }

        @Test
        @DisplayName("engineNativeHint 原样透传（Q9：运维声明式开关）")
        void engineNativeHintIsPassedThrough() {
            SynonymProperties p = props();
            p.setEngineNativeHint(true);
            SynonymExpandService svc = serviceOf(dictOf(group(1L, "OKR", "目标")), p);

            assertTrue(svc.expand("OKR", false).engineNativeHint());
            assertTrue(svc.expand("零命中", false).engineNativeHint());
            assertTrue(svc.expand("OKR", true).engineNativeHint());
        }

        @Test
        @DisplayName("预算快照来自配置而非硬编码（Q5：前端数字不许写死）")
        void budgetComesFromProperties() {
            SynonymProperties p = props();
            p.setMaxGroups(3);
            p.setMaxTermsPerGroup(4);
            p.setMaxQueryChars(256);
            p.setMinTermLength(2);
            SynonymExpandService svc = serviceOf(dictOf(group(1L, "OKR", "目标")), p);

            SynonymExpansion r = svc.expand("OKR", false);
            assertEquals(3, r.budget().maxGroups());
            assertEquals(4, r.budget().maxTermsPerGroup());
            assertEquals(256, r.budget().maxQueryChars());
            assertEquals(2, r.budget().minTermLength());
            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.status());
        }
    }
}

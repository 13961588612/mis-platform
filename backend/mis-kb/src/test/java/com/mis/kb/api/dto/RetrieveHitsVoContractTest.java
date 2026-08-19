package com.mis.kb.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.kb.domain.model.SynonymBudget;
import com.mis.kb.domain.model.SynonymExpansion;
import com.mis.kb.domain.model.SynonymHit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ⛔ <b>WD-06 红线守卫</b>：{@link RetrieveHitsVO} 的对外契约恒等断言（T06 完成判据第 1 条）。
 *
 * <p><b>这个测试挡的是什么：</b>Wave D 之后，{@code RetrieveQueryResolver.Resolution}
 * 上挂了一个 {@code expansion}，里头有<b>扩展后的完整查询串</b>。问答链路
 * （{@code KbRetrieveService}）离它只有一行之遥——任何人「顺手」把它拼进
 * {@link RetrieveHitsVO}，扩展串就会随 {@code /internal/v1/kb/rag/retrieve} 流到
 * {@code mis-rag}，AC-03b 直接判死。
 *
 * <p><b>为什么靠测试而不是靠注释：</b>注释挡不住「就加一个字段而已」。
 * 而这个断言是<b>恒等</b>的——不是「必须包含这三个键」，是「必须<b>只有</b>这三个键」，
 * 多一个即红灯，且失败信息会直接把红线原文摔在改动者脸上。
 *
 * <p><b>三层防线：</b>
 * <ol>
 *   <li><b>JSON 键集合恒等</b>——挡住直接加字段；</li>
 *   <li><b>类型图谱递归扫描</b>——挡住「藏进 {@code ChunkHitVO} 里」这种迂回；</li>
 *   <li><b>反向对照</b>——同时断言 {@link HitTestResultVO} <b>确实</b>带 {@code synonym}，
 *       证明本测试的检测机制是活的。少了这一条，哪天序列化整个坏掉、
 *       所有 VO 都序列化成 {@code {}}，前两条断言反而会「全绿」。</li>
 * </ol>
 */
class RetrieveHitsVoContractTest {

    /** 问答链路响应体<b>允许且仅允许</b>出现的顶层键。改这行前先读 WD-06。 */
    private static final Set<String> ALLOWED_KEYS =
            new TreeSet<>(List.of("hits", "emptyResultStrategy", "effectiveParams"));

    private static final String RED_LINE = """
            ⛔ WD-06 红线被触碰：RetrieveHitsVO 是问答链路（/internal/v1/kb/rag/retrieve）的响应体，
            它的字段会原样流向 mis-rag。同义词扩展轨迹（含扩展后的完整查询串）只允许经由
            HitTestResultVO.synonym 回显给命中测试页。
            如果你确实需要在问答链路回传新信息，请先与架构确认，并同步更新本测试与设计文档 §7.3。""";

    private final ObjectMapper mapper = new ObjectMapper();

    // ------------------------------------------------------------ 防线一：键集合恒等

    @Test
    @DisplayName("★ RetrieveHitsVO 序列化后的键集合必须恒等于 {hits, emptyResultStrategy, effectiveParams}")
    void jsonKeysAreExactlyThree() throws Exception {
        RetrieveHitsVO vo = new RetrieveHitsVO(
                List.of(new ChunkHitVO(10L, 100L, "片段正文", 0.87D, "员工手册", 12, 3, null)),
                "SUGGEST",
                new EffectiveParamsVO(
                        10, 0.3D, "hybrid", 0.3D, false, null, "SUGGEST", "LIBRARY", List.of(),
                        null, null));

        Set<String> actual = topLevelKeys(mapper.valueToTree(vo));
        assertEquals(ALLOWED_KEYS, actual, RED_LINE);
    }

    @Test
    @DisplayName("兼容构造（仅 hits）同样只产出这三个键，不因 null 而漏键或多键")
    void compactConstructorKeepsSameKeySet() throws Exception {
        RetrieveHitsVO vo = new RetrieveHitsVO(List.of());
        assertEquals(ALLOWED_KEYS, topLevelKeys(mapper.valueToTree(vo)), RED_LINE);
    }

    @Test
    @DisplayName("record 组件名与 JSON 键一一对应（防止有人靠 @JsonProperty 改名绕过键集合断言）")
    void recordComponentsMatchAllowedKeys() {
        Set<String> components = new TreeSet<>();
        for (RecordComponent rc : RetrieveHitsVO.class.getRecordComponents()) {
            components.add(rc.getName());
        }
        assertEquals(ALLOWED_KEYS, components, RED_LINE);
    }

    // ------------------------------------------------------------ 防线二：类型图谱

    @Test
    @DisplayName("★ RetrieveHitsVO 的整个类型图谱中不得出现任何 Synonym* 类型（含嵌套与泛型参数）")
    void typeGraphContainsNoSynonymType() {
        Set<Class<?>> graph = typeGraphOf(RetrieveHitsVO.class);
        List<String> offenders = new ArrayList<>();
        for (Class<?> c : graph) {
            if (c.getSimpleName().contains("Synonym")) {
                offenders.add(c.getName());
            }
        }
        assertTrue(offenders.isEmpty(),
                RED_LINE + "\n实际在类型图谱中发现：" + offenders);
    }

    @Test
    @DisplayName("序列化后的 JSON 文本中不得出现扩展痕迹关键字")
    void serializedTextHasNoExpansionTrace() throws Exception {
        RetrieveHitsVO vo = new RetrieveHitsVO(
                List.of(new ChunkHitVO(10L, 100L, "片段正文", 0.87D, "员工手册", 12, 3, null)),
                "SUGGEST",
                new EffectiveParamsVO(
                        10, 0.3D, "hybrid", 0.3D, false, null, "SUGGEST", "LIBRARY", List.of(),
                        null, null));

        String json = mapper.writeValueAsString(vo);
        for (String forbidden : List.of(
                "synonym", "expandedQuery", "originalQuestion", "droppedGroups", "EXPANDED")) {
            assertFalse(json.contains(forbidden),
                    RED_LINE + "\n实际 JSON 中出现了禁用片段「" + forbidden + "」：" + json);
        }
    }

    // ------------------------------------------------------------ 防线三：反向对照

    @Test
    @DisplayName("反向对照：HitTestResultVO 必须带 synonym（证明本测试的检测机制没坏）")
    void hitTestResultStillCarriesSynonym() throws Exception {
        SynonymExpansion expansion = new SynonymExpansion(
                SynonymExpansion.STATUS_EXPANDED,
                "OKR 怎么填",
                "OKR（目标与关键成果） 怎么填",
                List.of(new SynonymHit(1L, "OKR", "OKR", 1)),
                List.of(), List.of(), 1, 1, false, false, SynonymBudget.defaults());

        HitTestResultVO vo = new HitTestResultVO(
                List.of(), null, 12L, "SUGGEST", false, SynonymExpansionVO.from(expansion));

        JsonNode node = mapper.valueToTree(vo);
        assertTrue(topLevelKeys(node).contains("synonym"),
                "命中测试是扩展轨迹的唯一合法出口，这个键丢了 WD-19 就没了数据来源");
        assertEquals("EXPANDED", node.path("synonym").path("status").asText());
        assertEquals("OKR（目标与关键成果） 怎么填",
                node.path("synonym").path("expandedQuery").asText());
        // Q5：预算数字随响应下发，前端不许写死
        assertEquals(SynonymBudget.DEFAULT_MAX_GROUPS,
                node.path("synonym").path("budget").path("maxGroups").asInt());
    }

    @Test
    @DisplayName("SynonymExpansionVO.from 保真：四态、轨迹、预算逐字段映射，不丢不改")
    void expansionVoMapsFaithfully() {
        SynonymExpansion expansion = new SynonymExpansion(
                SynonymExpansion.STATUS_DISABLED_REQUEST,
                "年假怎么请",
                "年假怎么请",
                List.of(), List.of("休假"), List.of("IT"),
                3, 0, true, true, new SynonymBudget(4, 2, 128, 3));

        SynonymExpansionVO vo = SynonymExpansionVO.from(expansion);
        assertNotNull(vo);
        assertEquals(SynonymExpansion.STATUS_DISABLED_REQUEST, vo.status());
        assertEquals("年假怎么请", vo.originalQuestion());
        assertEquals("年假怎么请", vo.expandedQuery());
        assertEquals(List.of("休假"), vo.droppedGroups());
        assertEquals(List.of("IT"), vo.skippedShortTerms());
        assertEquals(3, vo.totalMatchedGroups());
        assertEquals(0, vo.usedGroups());
        assertTrue(vo.truncated());
        assertTrue(vo.engineNativeHint());
        assertEquals(4, vo.budget().maxGroups());
        assertEquals(2, vo.budget().maxTermsPerGroup());
        assertEquals(128, vo.budget().maxQueryChars());
        assertEquals(3, vo.budget().minTermLength());
    }

    @Test
    @DisplayName("SynonymExpansionVO.from(null) 返回 null；预算为 null 时回落默认值而非 null")
    void expansionVoHandlesNulls() {
        assertEquals(null, SynonymExpansionVO.from(null));

        SynonymExpansionVO.SynonymBudgetVO budget = SynonymExpansionVO.SynonymBudgetVO.from(null);
        assertNotNull(budget, "预算给 null，前端拼出来的提示就是「最多 undefined 组」");
        assertEquals(SynonymBudget.DEFAULT_MAX_GROUPS, budget.maxGroups());
        assertEquals(SynonymBudget.DEFAULT_MIN_TERM_LENGTH, budget.minTermLength());
    }

    // ------------------------------------------------------------ 工具

    /** 取 JSON 对象的顶层键集合（有序，便于失败信息可读）。 */
    private static Set<String> topLevelKeys(JsonNode node) {
        Set<String> keys = new TreeSet<>();
        Iterator<String> it = node.fieldNames();
        while (it.hasNext()) {
            keys.add(it.next());
        }
        return keys;
    }

    /**
     * 递归收集一个类型可达的全部类型（含 record 组件、泛型实参）。
     *
     * <p>只递归 record —— 本项目的对外 VO 全是 record，普通类（{@code String}、
     * 包装类型）不必展开，展开反而会把 JDK 内部类型拖进来。
     *
     * @param root 根类型
     * @return 可达类型集合
     */
    private static Set<Class<?>> typeGraphOf(Class<?> root) {
        Set<Class<?>> out = new LinkedHashSet<>();
        collect(root, new HashSet<>(), out);
        return out;
    }

    private static void collect(Type type, Set<Type> seen, Set<Class<?>> out) {
        if (type == null || !seen.add(type)) {
            return;
        }
        if (type instanceof ParameterizedType pt) {
            collect(pt.getRawType(), seen, out);
            for (Type arg : pt.getActualTypeArguments()) {
                collect(arg, seen, out);
            }
            return;
        }
        if (!(type instanceof Class<?> clazz)) {
            return;
        }
        out.add(clazz);
        if (clazz.isRecord()) {
            for (RecordComponent rc : clazz.getRecordComponents()) {
                collect(rc.getGenericType(), seen, out);
            }
        }
    }
}

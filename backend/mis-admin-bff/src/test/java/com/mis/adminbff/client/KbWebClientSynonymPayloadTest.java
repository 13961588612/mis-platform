package com.mis.adminbff.client;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.dto.kb.KbSynonymGroupVO;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code KbWebClient.resolveSynonym()} 的载荷解包行为测试（Wave D / T10）。
 *
 * <p><b>这个测试守的是什么</b>：40927 词条冲突的结构化明细
 * {@code {term, ownerGroupId, ownerCanonicalTerm}} 必须从 mis-kb 一路活到前端。
 * 前端 {@code toConflictError()} 靠这三个字段拼「「X」与术语组「Owner」中的「Y」冲突」
 * 并提供跳转，缺任何一个都会降级成一个没有意义的 {@code #-}，AC-11 直接判死。
 *
 * <p><b>为什么值得单独测这一跳</b>：BFF 侧最容易吞掉明细的地方就是这里。
 * 若照抄其余端点的写法用 {@code Result<KbSynonymGroupVO>} 直接解码，Jackson 默认
 * {@code FAIL_ON_UNKNOWN_PROPERTIES=false}，错误态那三个字段会被<b>静默丢弃</b>——
 * 不抛异常、不打日志、编译通过、其它用例全绿，只有前端弹出「与术语组「null」冲突」时才暴露。
 * {@link SilentLossRegression} 把这个失败模式本身固化成用例，
 * 证明「改用 JsonNode」不是风格偏好而是必需品。
 */
class KbWebClientSynonymPayloadTest {

    /**
     * 容器里那个 ObjectMapper 的等价物。
     *
     * <p><b>不能用裸 {@code new ObjectMapper()} 顶替</b>——本轮实测踩到的坑：
     * Jackson 库默认 {@code FAIL_ON_UNKNOWN_PROPERTIES=true}（未知字段直接抛），
     * 而 <b>Spring Boot 自动配置把它关掉了</b>（{@code Jackson2ObjectMapperBuilder.configure()}
     * 显式 disable）。差别恰好落在本测试要守的那条线上：
     * 裸实例会让「按成功态类型解错误明细」<b>大声报错</b>，
     * 生产里的容器实例则是<b>静默丢字段</b>。用裸实例测，得到的会是一个
     * 与线上行为相反的假结论。
     *
     * <p>本模块无自定义 {@code ObjectMapper} Bean、{@code application.yml} 无 jackson 配置，
     * 故 {@code Jackson2ObjectMapperBuilder.json().build()} 就是容器实例的忠实复制品
     * （同一个 builder，Spring Boot 也是在它基础上叠加配置）。
     */
    private static final ObjectMapper MAPPER = Jackson2ObjectMapperBuilder.json().build();

    private static final TypeReference<KbSynonymGroupVO> GROUP = new TypeReference<>() {};

    /** 冲突码：词条已属于其它术语组（设计 §7.5）。 */
    private static final int KB_SYNONYM_TERM_CONFLICT = 40927;

    /**
     * 造一个下游冲突响应。
     *
     * @param term          冲突词条<b>原文</b>
     * @param ownerGroupId  占用方组 ID
     * @param ownerCanonical 占用方规范词原文
     * @return 下游 {@code Result}
     */
    private static Result<JsonNode> conflict(String term, long ownerGroupId, String ownerCanonical) {
        Map<String, Object> detail = Map.of(
                "term", term,
                "ownerGroupId", ownerGroupId,
                "ownerCanonicalTerm", ownerCanonical);
        Result<JsonNode> result = Result.fail(KB_SYNONYM_TERM_CONFLICT, "词条已存在于其它术语组");
        result.setData(MAPPER.valueToTree(detail));
        return result;
    }

    @Nested
    @DisplayName("40927 冲突明细原样透出")
    class ConflictDetailPassthrough {

        @Test
        @DisplayName("三个字段一个都不少，且 code/message 保持下游原值")
        void keepsAllThreeFields() {
            Result<JsonNode> downstream = conflict("OKR", 42L, "关键结果法");

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(downstream, MAPPER, GROUP));

            assertEquals(KB_SYNONYM_TERM_CONFLICT, ex.getCode(), "业务码必须原样上抛，不得归一成 500");
            assertEquals("词条已存在于其它术语组", ex.getMessage());

            Map<?, ?> data = assertInstanceOf(Map.class, ex.getData(), "明细必须随异常一起带走");
            assertEquals(3, data.size(), "多一个字段少一个字段都说明这一跳在加工明细");
            assertEquals("OKR", data.get("term"));
            assertEquals(42, ((Number) data.get("ownerGroupId")).intValue());
            assertEquals("关键结果法", data.get("ownerCanonicalTerm"));
        }

        @Test
        @DisplayName("term 是用户输入的原始写法，不是归一化词形")
        void keepsOriginalTermSpelling() {
            // U4 归一化 = trim + NFKC + toLowerCase：全角「ＯＫＲ」归一化后是半角小写「okr」。
            // 前端要在提示里同时展示两种原始写法来说破「全半角视为同一个词」，
            // 这一跳但凡做一次归一化，提示就退化成「「okr」与「okr」冲突」——用户只会以为系统坏了。
            Result<JsonNode> downstream = conflict("ＯＫＲ", 7L, "目标与关键结果");

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(downstream, MAPPER, GROUP));

            Map<?, ?> data = assertInstanceOf(Map.class, ex.getData());
            assertEquals("ＯＫＲ", data.get("term"), "必须是全角原文，不能被归一成 okr");
        }

        @Test
        @DisplayName("明细被摊平成普通 Map，而不是把 JsonNode 直接塞进异常")
        void flattensToPlainJavaTypes() {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(conflict("年假", 1L, "带薪年休假"), MAPPER, GROUP));

            assertFalse(ex.getData() instanceof JsonNode,
                    "JsonNode 能被 Jackson 正确写出，却会在别处（日志 toString、审计切面）表现得不一样");
            assertInstanceOf(Map.class, ex.getData());
        }

        @Test
        @DisplayName("嵌套结构（数组明细）同样逐项保留")
        void keepsNestedStructures() {
            Result<JsonNode> downstream = Result.fail(KB_SYNONYM_TERM_CONFLICT, "批量冲突");
            downstream.setData(MAPPER.valueToTree(Map.of(
                    "conflicts", List.of(
                            Map.of("term", "OKR", "ownerGroupId", 1, "ownerCanonicalTerm", "关键结果法"),
                            Map.of("term", "KPI", "ownerGroupId", 2, "ownerCanonicalTerm", "关键绩效指标")))));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(downstream, MAPPER, GROUP));

            Map<?, ?> data = assertInstanceOf(Map.class, ex.getData());
            List<?> conflicts = assertInstanceOf(List.class, data.get("conflicts"));
            assertEquals(2, conflicts.size());
            assertEquals("KPI", ((Map<?, ?>) conflicts.get(1)).get("term"));
        }

        @Test
        @DisplayName("下游只给 code/message 不给 data 时，data 保持 null 而非空对象")
        void nullDetailStaysNull() {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(
                            Result.fail(40415, "术语组不存在"), MAPPER, GROUP));

            assertEquals(40415, ex.getCode());
            assertNull(ex.getData(), "凭空造一个 {} 会让前端把「没有明细」误判成「明细为空」");
        }
    }

    @Nested
    @DisplayName("成功态解包")
    class SuccessPath {

        @Test
        @DisplayName("data 按成功态类型转换，词条原文与顺序不变")
        void convertsToTargetType() {
            Result<JsonNode> downstream = Result.ok();
            downstream.setData(MAPPER.valueToTree(Map.of(
                    "id", 9L,
                    "canonicalTerm", "关键结果法",
                    "status", 1,
                    "termCount", 3,
                    "terms", List.of(
                            Map.of("term", "关键结果法", "canonical", true, "sortNo", 0),
                            Map.of("term", "OKR", "canonical", false, "sortNo", 1),
                            Map.of("term", "ＯＫＲ", "canonical", false, "sortNo", 2)))));

            KbSynonymGroupVO vo = KbWebClient.resolveSynonym(downstream, MAPPER, GROUP);

            assertNotNull(vo);
            assertEquals(9L, vo.id());
            assertEquals("关键结果法", vo.canonicalTerm());
            assertEquals(3, vo.terms().size());
            // WD-25：顺序即语义，禁止字典序重排
            assertEquals(List.of("关键结果法", "OKR", "ＯＫＲ"),
                    vo.terms().stream().map(KbSynonymGroupVO.KbSynonymTermItemVO::term).toList());
            assertEquals(0, vo.terms().get(0).sortNo());
        }

        @Test
        @DisplayName("成功码 + 空 data 返回 null，交由门面统一判空")
        void nullDataReturnsNull() {
            assertNull(KbWebClient.resolveSynonym(Result.ok(), MAPPER, GROUP));
        }

        @Test
        @DisplayName("成功码 + JSON null 节点同样返回 null，不抛 NPE")
        void jsonNullReturnsNull() {
            Result<JsonNode> downstream = Result.ok();
            downstream.setData(MAPPER.nullNode());
            assertNull(KbWebClient.resolveSynonym(downstream, MAPPER, GROUP));
        }
    }

    @Nested
    @DisplayName("异常与边界")
    class EdgeCases {

        @Test
        @DisplayName("下游整个 Result 为空时报 500 而不是 NPE")
        void nullResultFailsFast() {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(null, MAPPER, GROUP));
            assertEquals(50000, ex.getCode());
        }

        @Test
        @DisplayName("成功态 data 形状对不上目标类型时，报解析失败而不是静默返回 null")
        void malformedSuccessDataFails() {
            Result<JsonNode> downstream = Result.ok();
            // terms 应为数组，这里给字符串
            downstream.setData(MAPPER.valueToTree(Map.of("id", 1L, "terms", "not-an-array")));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> KbWebClient.resolveSynonym(downstream, MAPPER, GROUP));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("下游响应解析失败"));
        }
    }

    @Nested
    @DisplayName("回归护栏：证明「直接按成功态类型解码」会静默丢明细")
    class SilentLossRegression {

        /**
         * 固化「错误的写法」会造成什么。
         *
         * <p>把冲突明细 {@code {term, ownerGroupId, ownerCanonicalTerm}} 按
         * {@link KbSynonymGroupVO} 解码——这正是照抄其余端点会写出的代码。
         * 容器里的 ObjectMapper 关闭了 {@code FAIL_ON_UNKNOWN_PROPERTIES}，
         * 于是三个字段<b>无声无息地蒸发</b>，得到一个所有字段都是 null 的空壳。
         * 没有异常、没有日志、编译通过。
         *
         * <p>这个用例存在的意义：如果哪天有人「统一风格」把 {@code SYNONYM_RAW}
         * 改回 {@code Result<KbSynonymGroupVO>}，上面那些断言会失败，
         * 而这一条会解释<b>为什么</b>失败。
         */
        @Test
        @DisplayName("按 KbSynonymGroupVO 解错误明细 → 三个字段全部蒸发，且不报错")
        void decodingErrorBodyAsSuccessTypeLosesEverything() {
            JsonNode detail = MAPPER.valueToTree(Map.of(
                    "term", "OKR", "ownerGroupId", 42, "ownerCanonicalTerm", "关键结果法"));

            KbSynonymGroupVO decoded = MAPPER.convertValue(detail, KbSynonymGroupVO.class);

            assertNotNull(decoded, "容器 mapper 不会报错，这正是危险之处");
            assertNull(decoded.id());
            assertNull(decoded.canonicalTerm());
            assertNull(decoded.terms());
            // 结论：错误态 data 与成功态类型无关，转一次就什么都不剩。
            // 故 resolveSynonym 的失败分支刻意不做类型转换。
        }

        /**
         * 同一份明细，换成裸 {@code new ObjectMapper()} 会<b>抛异常</b>而不是静默丢字段。
         *
         * <p>固化这个差异，是为了拦住下一个人「测试里 new 一个 mapper 就行」的直觉：
         * 用裸实例写上面那条用例，会得到一个与线上行为完全相反的结论，
         * 从而误判「这条链路本来就是安全的」。
         */
        @Test
        @DisplayName("裸 ObjectMapper 会报错——所以它不能用来模拟容器实例")
        void bareMapperBehavesDifferently() {
            JsonNode detail = MAPPER.valueToTree(Map.of(
                    "term", "OKR", "ownerGroupId", 42, "ownerCanonicalTerm", "关键结果法"));

            assertThrows(IllegalArgumentException.class,
                    () -> new ObjectMapper().convertValue(detail, KbSynonymGroupVO.class),
                    "Jackson 库默认 FAIL_ON_UNKNOWN_PROPERTIES=true，与 Spring Boot 容器实例相反");
        }
    }
}

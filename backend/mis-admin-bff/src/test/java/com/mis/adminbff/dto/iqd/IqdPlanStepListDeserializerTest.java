package com.mis.adminbff.dto.iqd;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link IqdPlanStepListDeserializer} 回归测试。
 *
 * <p>覆盖四场景：textual 数组、object 数组、混合数组、畸形 object 数组。
 * 关键约束：每个场景都必须实际执行一次序列化（{@code objectMapper.writeValueAsString}），
 * 因为原 Bug（50000 "object is not an instance of declaring class"）正是在【序列化】阶段炸的，
 * 仅测反序列化无法复现/验证修复。
 *
 * <p>ObjectMapper 配置与 BFF 运行时保持一致：关闭 {@code FAIL_ON_UNKNOWN_PROPERTIES}
 * （见 IqdAskFacadeService 中的 mapper 配置），以匹配场景 D 的 unknown_field 行为。
 */
@DisplayName("IqdPlanStepListDeserializer 回归测试")
class IqdPlanStepListDeserializerTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    /** 把 list 包装进 IqdAskResponse 并完整序列化，复现原 Bug 的序列化路径。 */
    private String serializeWithPlan(List<IqdPlanStep> plan) throws Exception {
        IqdAskResponse resp = new IqdAskResponse();
        resp.setPlan(plan);
        return objectMapper.writeValueAsString(resp);
    }

    @Test
    @DisplayName("A: textual 数组 -> 2 个 IqdPlanStep，code 正确；序列化不抛异常且字段正确")
    void scenarioA_textualArray() throws Exception {
        // Arrange
        String json = "{\"plan\":[\"scope_check\",\"finished\"]}";

        // Act
        IqdAskResponse resp = objectMapper.readValue(json, IqdAskResponse.class);
        List<IqdPlanStep> plan = resp.getPlan();

        // Assert - 反序列化
        assertThat(plan).hasSize(2);
        assertThat(plan).allSatisfy(step -> assertThat(step).isInstanceOf(IqdPlanStep.class));
        assertThat(plan.get(0).code()).isEqualTo("scope_check");
        assertThat(plan.get(1).code()).isEqualTo("finished");
        assertThat(plan.get(0).label()).isNull();
        assertThat(plan.get(1).durationMs()).isNull();

        // Assert - 序列化（原 Bug 炸点）：不抛异常且内容正确
        String serialized = serializeWithPlan(plan);
        assertThat(serialized).contains("\"plan\"");
        assertThat(serialized).doesNotContain("\"code\":null");
    }

    @Test
    @DisplayName("B: object 数组 -> IqdPlanStep(durationMs=123)；序列化回 JSON 含 duration_ms=123")
    void scenarioB_objectArray() throws Exception {
        // Arrange
        String json = "{\"plan\":[{\"code\":\"scope_check\",\"label\":\"范围核查\",\"status\":\"done\",\"duration_ms\":123}]}";

        // Act
        IqdAskResponse resp = objectMapper.readValue(json, IqdAskResponse.class);
        List<IqdPlanStep> plan = resp.getPlan();

        // Assert - 反序列化
        assertThat(plan).hasSize(1);
        IqdPlanStep step = plan.get(0);
        assertThat(step).isInstanceOf(IqdPlanStep.class);
        assertThat(step.code()).isEqualTo("scope_check");
        assertThat(step.label()).isEqualTo("范围核查");
        assertThat(step.status()).isEqualTo("done");
        assertThat(step.durationMs()).isEqualTo(123L);

        // Assert - 序列化（@JsonProperty("duration_ms") 生效）
        String serialized = serializeWithPlan(plan);
        assertThat(serialized).contains("\"duration_ms\":123");
    }

    @Test
    @DisplayName("C: 混合数组 -> 第1为 textual 构造、第2为 object 解析；list 大小2，均 IqdPlanStep")
    void scenarioC_mixedArray() throws Exception {
        // Arrange
        String json = "{\"plan\":[\"scope_check\",{\"code\":\"finished\",\"status\":\"done\"}]}";

        // Act
        IqdAskResponse resp = objectMapper.readValue(json, IqdAskResponse.class);
        List<IqdPlanStep> plan = resp.getPlan();

        // Assert - 反序列化
        assertThat(plan).hasSize(2);
        assertThat(plan).allSatisfy(step -> assertThat(step).isInstanceOf(IqdPlanStep.class));
        assertThat(plan.get(0).code()).isEqualTo("scope_check");
        assertThat(plan.get(0).label()).isNull();
        assertThat(plan.get(1).code()).isEqualTo("finished");
        assertThat(plan.get(1).status()).isEqualTo("done");

        // Assert - 序列化不抛异常
        String serialized = serializeWithPlan(plan);
        assertThat(serialized).contains("\"plan\"");
    }

    @Test
    @DisplayName("D1: 含 unknown_field 的 object 不触发 skip（未知字段被容忍），全部 IqdPlanStep 且无 crash")
    void scenarioD_unknownFieldTolerated() throws Exception {
        // Arrange
        // 第1个元素带 unknown_field；因 mapper 关闭 FAIL_ON_UNKNOWN_PROPERTIES，
        // treeToValue 仍可成功反序列化出 IqdPlanStep{code=x}，不会被 skip。
        String json = "{\"plan\":[{\"code\":\"x\",\"unknown_field\":1},\"finished\"]}";

        // Act
        IqdAskResponse resp = objectMapper.readValue(json, IqdAskResponse.class);
        List<IqdPlanStep> plan = resp.getPlan();

        // Assert - 反序列化：两个元素都成功解析，size=2，均为 IqdPlanStep
        assertThat(plan).hasSize(2);
        assertThat(plan).allSatisfy(step -> assertThat(step).isInstanceOf(IqdPlanStep.class));
        assertThat(plan.get(0).code()).isEqualTo("x");
        assertThat(plan.get(1).code()).isEqualTo("finished");
        // 守卫：绝不含任何非 IqdPlanStep 的残留元素（无 ArrayList / raw JsonNode）
        assertThat(plan).noneSatisfy(step -> assertThat(step).isNotInstanceOf(IqdPlanStep.class));

        // Assert - 序列化不抛异常（原 Bug 炸点）
        String serialized = serializeWithPlan(plan);
        assertThat(serialized).contains("\"plan\"");
        assertThat(serialized).contains("\"finished\"");
    }

    @Test
    @DisplayName("D2: 类型不兼容 object（duration_ms 为字符串）触发 treeToValue 失败 -> 反序列化器返回 null（skip）")
    void scenarioD_typeMismatchSkipped() throws Exception {
        // Arrange
        // 第1个元素 duration_ms 是字符串而非数字，treeToValue 抛异常 -> 反序列化器返回 null（skip）；
        // 第2个 textual 元素正常解析为 IqdPlanStep{code=finished}。
        // 注：Jackson 以 contentUsing 注册时，反序列化器返回的 null 内容元素【默认保留】为 List 中的
        // null 槽位（不会自动剔除），因此 list 实际为 [null, IqdPlanStep{code=finished}]（size=2）。
        // 这仍是正确行为：没有 ArrayList / raw JsonNode 等「非 IqdPlanStep 的实体对象」混入，
        // 序列化阶段不会再有原 Bug 的 ClassCastException。
        String json = "{\"plan\":[{\"code\":\"y\",\"duration_ms\":\"not-a-number\"},\"finished\"]}";

        // Act
        IqdAskResponse resp = objectMapper.readValue(json, IqdAskResponse.class);
        List<IqdPlanStep> plan = resp.getPlan();

        // Assert - 反序列化：第1个元素被 skip（反序列化器返回 null），第2个正常解析
        // 守卫核心：所有「非 null」元素都必须是 IqdPlanStep 实例，绝不混入 ArrayList / raw JsonNode
        List<IqdPlanStep> nonNull = plan.stream()
                .filter(java.util.Objects::nonNull)
                .toList();
        assertThat(nonNull).hasSize(1);
        assertThat(nonNull.get(0).code()).isEqualTo("finished");
        // 绝不含任何非 null 且非 IqdPlanStep 的残留元素（用 stream 过滤后断言，避免 AssertJ
        // noneSatisfy 对 null 元素内部 Optional.of 触发 NPE）
        assertThat(nonNull).allSatisfy(step -> assertThat(step).isInstanceOf(IqdPlanStep.class));

        // Assert - 序列化不抛异常（原 Bug 炸点；null 槽位可被 Jackson 正常序列化）
        String serialized = serializeWithPlan(plan);
        assertThat(serialized).contains("\"plan\"");
        assertThat(serialized).contains("\"finished\"");
    }
}

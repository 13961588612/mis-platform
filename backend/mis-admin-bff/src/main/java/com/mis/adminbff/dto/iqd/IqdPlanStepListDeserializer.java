package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;

/**
 * plan 字段元素的容错反序列化器（按 List 元素粒度注册，配合
 * {@code @JsonDeserialize(contentUsing = ...)} 使用）。
 *
 * <p>注册方式为 {@code contentUsing}，其语义是：<b>对 List 的【每个元素】调用一次
 * 本反序列化器</b>，每次传入的是单个元素的 {@link JsonParser}（而不是整个数组）。
 * 因此本类声明为 {@code JsonDeserializer<IqdPlanStep>}，只负责把一个元素转换为
 * 一个 {@link IqdPlanStep}（或返回 {@code null} 表示该元素被跳过）。
 *
 * <p>Worker 正常成功路径下 {@code plan} 为对象数组
 * {@code [{"code":"scope_check","label":"...","status":"done",...}]}（由
 * Python {@code PlanMapper} 产出，与 {@link IqdPlanStep} record 对齐）。
 * 但在无权限 / scope 拦截分支下，Worker 退化为 String 数组
 * {@code ["scope_check","finished"]}。
 *
 * <p>Jackson 默认无法把 JSON 字符串反序列化为 {@link IqdPlanStep} 对象，会抛
 * {@code InvalidDefinitionException} 进而被上游包成 45299。此处对单个元素做分流：
 * textual 元素映射为 {@code IqdPlanStep{code=该字符串}}（其余字段置 null），
 * object 元素按正常 record 反序列化。
 *
 * <p>对无法识别或解析失败的元素返回 {@code null}；Jackson 在使用 {@code contentUsing}
 * 注册时默认不会把 {@code null} 元素加入 List（等同于跳过该元素），从而不会把
 * raw JsonNode / ArrayList / 任意非 {@link IqdPlanStep} 对象塞进 result，避免序列化
 *阶段出现 "object is not an instance of declaring class" / ClassCastException。
 *
 * <p>前端仅消费 {@code plan[].code} 通过 {@code PLAN_LABEL} 映射渲染中文步骤名，
 * 因此退化 String 被包成 {@code {code}} 即可零改动正常展示。
 */
public class IqdPlanStepListDeserializer extends JsonDeserializer<IqdPlanStep> {

    @Override
    public IqdPlanStep deserialize(JsonParser p, DeserializationContext ctxt)
            throws IOException {
        // 复用当前 JsonParser 所绑定的 codec（即 Spring 配置的 ObjectMapper），
        // 保证 record 上的 @JsonProperty("duration_ms") 等注解与全局配置一致，
        // 且不再自建裸 ObjectMapper 导致 codec 不一致 / 静默吞错。
        ObjectMapper mapper = (ObjectMapper) p.getCodec();
        JsonNode el = mapper.readTree(p);
        if (el == null || el.isNull()) {
            // 元素为 null：跳过（返回 null，不进入 List）
            return null;
        }
        if (el.isTextual()) {
            // 退化 String 元素：仅填 code，其余字段传 null
            // record 构造顺序：seq, code, label, detail, sql, status, durationMs
            return new IqdPlanStep(null, el.asText(), null, null, null, null, null);
        }
        if (el.isObject()) {
            // object 元素：用 codec 的 mapper 反序列化；单元素失败则返回 null（跳过）
            try {
                return mapper.treeToValue(el, IqdPlanStep.class);
            } catch (Exception ignored) {
                // 解析失败跳过该元素（返回 null，不向上抛，避免再次触发 45299）
                return null;
            }
        }
        // 其它非预期类型（数组 / 数字 / 布尔等）：跳过，不污染 List
        return null;
    }
}

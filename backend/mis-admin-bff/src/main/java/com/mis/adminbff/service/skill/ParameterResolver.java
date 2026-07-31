package com.mis.adminbff.service.skill;

import com.mis.adminbff.dto.ai.FieldDef;
import com.mis.adminbff.service.AiCapabilityTranslator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 参数三级降级解析器。
 *
 * <p>解析顺序：
 * <ol>
 *   <li>${xxx} 依赖 → 从 prevResults 获取</li>
 *   <li>LLM 抽取 → 通过 AiCapabilityTranslator 从 userInput 抽取</li>
 *   <li>上下文 / 默认值 → 从 pageContext 或参数模板本身取值</li>
 * </ol>
 * </p>
 */
@Component
public class ParameterResolver {

    private static final Logger log = LoggerFactory.getLogger(ParameterResolver.class);

    private static final Pattern PARAM_REF = Pattern.compile("\\$\\{(\\w+)\\}");

    private final AiCapabilityTranslator aiCapabilityTranslator;

    public ParameterResolver(AiCapabilityTranslator aiCapabilityTranslator) {
        this.aiCapabilityTranslator = aiCapabilityTranslator;
    }

    /**
     * 解析实体字段的 params。
     *
     * @param fieldDef    字段定义
     * @param userInput   用户输入
     * @param pageContext 表单上下文
     * @param prevResults 已执行字段的结果
     * @return 解析后的参数 map
     */
    public Map<String, Object> resolve(FieldDef fieldDef, String userInput,
                                       Map<String, Object> pageContext,
                                       Map<String, Object> prevResults) {
        Map<String, Object> resolved = new HashMap<>();
        Map<String, String> params = fieldDef.getParams();
        if (params == null) {
            return resolved;
        }

        for (Map.Entry<String, String> entry : params.entrySet()) {
            String paramName = entry.getKey();
            String paramValue = entry.getValue();

            if (paramValue == null) {
                resolved.put(paramName, null);
                continue;
            }

            // ① ${xxx} 依赖 → 从 prevResults 获取
            Matcher m = PARAM_REF.matcher(paramValue);
            if (m.matches()) {
                String dependency = m.group(1);
                Object value = prevResults.get(dependency);
                if (value == null) {
                    // 依赖未就绪，尝试从 pageContext 取
                    value = pageContext.get(dependency);
                }
                resolved.put(paramName, value);
                continue;
            }

            // ② 非依赖参数：对于实体字段，name 参数从 userInput 用 LLM 抽取
            if (fieldDef.getEntityRef() != null && "name".equals(paramName)) {
                String extracted = extractFromLLM(userInput, fieldDef);
                if (extracted != null) {
                    resolved.put(paramName, extracted);
                    continue;
                }
            }

            // ③ 从 pageContext 取
            Object ctxValue = pageContext.get(paramName);
            if (ctxValue != null) {
                resolved.put(paramName, ctxValue);
                continue;
            }

            // ④ 直接用原始参数值（字面量）
            resolved.put(paramName, paramValue);
        }

        return resolved;
    }

    /**
     * 解析非实体字段的值（无需调 MCP）。
     * 从 userInput、pageContext、prevResults 中按优先级获取。
     */
    public Object resolveNonEntity(FieldDef fieldDef, String userInput,
                                    Map<String, Object> pageContext,
                                    Map<String, Object> prevResults) {
        String fieldName = null;
        if (fieldDef.getParams() != null) {
            fieldName = fieldDef.getParams().get("name");
        }

        // 优先从 prevResults 取
        if (fieldName != null && prevResults.containsKey(fieldName)) {
            return prevResults.get(fieldName);
        }

        // 从 pageContext 取
        if (fieldName != null && pageContext.containsKey(fieldName)) {
            return pageContext.get(fieldName);
        }

        // 从 userInput LLM 抽取
        if (fieldDef.getEntityRef() != null) {
            return extractFromLLM(userInput, fieldDef);
        }

        // 字面量兜底
        return fieldName;
    }

    /**
     * 从用户输入中通过 LLM 抽取实体名称。
     * <p>P0 简单实现：将 userInput 直接作为 name 返回（因为 user-fill 场景
     * 用户说的话通常就是实体名称本身）。P1 应接入 AiCapabilityTranslator 的 extract 能力做精确抽取。</p>
     */
    private String extractFromLLM(String userInput, FieldDef fieldDef) {
        if (userInput == null || userInput.isEmpty()) {
            return null;
        }
        // P0 直通：整个 userInput 作为实体名
        // 可替换为 aiCapabilityTranslator 的 LLM 抽取方法
        return userInput;
    }
}

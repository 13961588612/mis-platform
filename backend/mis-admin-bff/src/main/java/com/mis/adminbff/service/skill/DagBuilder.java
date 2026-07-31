package com.mis.adminbff.service.skill;

import com.mis.adminbff.dto.ai.FieldDef;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 构建 Skill outputSchema 的依赖 DAG 并执行拓扑排序。
 *
 * <p>依赖识别规则：扫描每个 FieldDef 的 params 值，匹配 ${xxx} 模式。
 * 如果 field A 的 params 引用 ${B}，则 A 依赖 B（B → A 有边）。
 * 无 ${} 引用的字段是入度为 0 的根节点。</p>
 */
@Component
public class DagBuilder {

    private static final Pattern PARAM_REF = Pattern.compile("\\$\\{(\\w+)\\}");

    /**
     * 对 outputSchema 执行拓扑排序，返回字段名的执行顺序。
     *
     * @param schema outputSchema 字段定义
     * @return 拓扑排序后的字段名列表
     * @throws IllegalArgumentException 如果存在循环依赖
     */
    public List<String> topologicalSort(Map<String, FieldDef> schema) {
        // 构建邻接表和入度表
        Map<String, List<String>> graph = new HashMap<>();
        Map<String, Integer> inDegree = new HashMap<>();

        for (String field : schema.keySet()) {
            graph.putIfAbsent(field, new ArrayList<>());
            inDegree.putIfAbsent(field, 0);
        }

        for (Map.Entry<String, FieldDef> entry : schema.entrySet()) {
            String field = entry.getKey();
            FieldDef def = entry.getValue();
            if (def.getParams() != null) {
                for (String paramValue : def.getParams().values()) {
                    if (paramValue == null) {
                        continue;
                    }
                    Matcher m = PARAM_REF.matcher(paramValue);
                    while (m.find()) {
                        String dependency = m.group(1);
                        if (schema.containsKey(dependency)) {
                            graph.get(dependency).add(field);
                            inDegree.put(field, inDegree.get(field) + 1);
                        }
                    }
                }
            }
        }

        // Kahn 算法
        Queue<String> queue = new LinkedList<>();
        for (Map.Entry<String, Integer> e : inDegree.entrySet()) {
            if (e.getValue() == 0) {
                queue.offer(e.getKey());
            }
        }

        List<String> result = new ArrayList<>();
        while (!queue.isEmpty()) {
            String node = queue.poll();
            result.add(node);
            for (String neighbor : graph.get(node)) {
                inDegree.put(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) == 0) {
                    queue.offer(neighbor);
                }
            }
        }

        if (result.size() < schema.size()) {
            List<String> unvisited = schema.keySet().stream()
                    .filter(f -> !result.contains(f))
                    .collect(Collectors.toList());
            throw new IllegalArgumentException(
                    "Circular dependency detected in skill outputSchema. Fields: " + unvisited);
        }

        return result;
    }
}

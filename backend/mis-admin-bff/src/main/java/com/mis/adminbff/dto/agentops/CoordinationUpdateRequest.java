package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 保存调度配置入参（§4.3 #26）。
 *
 * <p>字段集合与 {@link CoordinationVO} 一致，唯独 {@code role} 必填 ——
 * 它是服务端判定「哪组字段适用」的唯一依据（§4.5）。缺了它，服务端只能猜，
 * 而猜错的后果是把 worker 的字段当 coordinator 的存下来，配置看似保存成功却永不生效。
 *
 * <p><b>互斥校验为什么不在 BFF 做</b>：role 变更会触发级联清理
 * （一个 coordinator 降级为 worker 时，引用它的其它 coordinator 的
 * {@code allowed_workers} 要同步剔除，见 {@code affected_agents} 回传）。
 * 这个级联只有持有全量 agent 关系的下游能算。BFF 单独校验字段互斥，
 * 会出现「BFF 放行但下游因级联冲突拒绝」或反之，两套规则各说各话。
 * 校验与级联在同一侧完成才自洽。
 *
 * @param role              角色，必填
 * @param whenToUse         [worker]
 * @param inputContract     [worker]
 * @param outputContract    [worker]
 * @param safetyLevel       [worker]
 * @param allowedWorkers    [coordinator]
 * @param maxDepth          [coordinator]
 * @param maxFanout         [coordinator]
 * @param taskBriefTemplate [coordinator]
 */
public record CoordinationUpdateRequest(
        @JsonProperty("role")
        @NotBlank(message = "role 不能为空（服务端据此判定字段适用性）")
        String role,

        @JsonProperty("when_to_use") String whenToUse,
        @JsonProperty("input_contract") String inputContract,
        @JsonProperty("output_contract") String outputContract,
        @JsonProperty("safety_level") String safetyLevel,
        @JsonProperty("allowed_workers") List<String> allowedWorkers,
        @JsonProperty("max_depth") Integer maxDepth,
        @JsonProperty("max_fanout") Integer maxFanout,
        @JsonProperty("task_brief_template") String taskBriefTemplate) {
}

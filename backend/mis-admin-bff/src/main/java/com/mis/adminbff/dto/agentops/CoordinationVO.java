package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * C–W 调度配置（§4.3 #25，对应前端 {@code types.ts:Coordination}）。
 *
 * <h2>coordinator 字段与 worker 字段互斥</h2>
 * 一个 Agent 要么是派活的，要么是干活的，两组字段永远只有一组有意义。
 * 表达互斥有两种做法：<b>密封接口 + 两个实现</b>，或<b>一个扁平结构 + role 判别</b>。
 * 这里选后者，理由是 wire format 已经定死为扁平 JSON（前端 {@code Coordination}
 * 就是一个可选字段全展开的 interface）——Java 侧强行做成密封层级，
 * 只会在序列化边界上多一层自定义 {@code JsonDeserializer}，
 * 而互斥校验最终仍要在服务端做一遍（§4.5 的 COORD_FIELD_NOT_APPLICABLE）。
 * 多出来的类型安全没有覆盖真正的风险点，却增加了两处必须同步的映射。
 *
 * @param role              {@code coordinator} | {@code worker}，判别字段
 * @param whenToUse         [worker] 何时该派给它
 * @param inputContract     [worker] 入参约定
 * @param outputContract    [worker] 出参约定
 * @param safetyLevel       [worker] {@code low} | {@code medium} | {@code high}
 * @param allowedWorkers    [coordinator] 允许派发的 worker 列表
 * @param maxDepth          [coordinator] 最大派发深度
 * @param maxFanout         [coordinator] 单层最大并发派发数
 * @param taskBriefTemplate [coordinator] 任务简报模板
 */
public record CoordinationVO(
        @JsonProperty("role") String role,
        @JsonProperty("when_to_use") String whenToUse,
        @JsonProperty("input_contract") String inputContract,
        @JsonProperty("output_contract") String outputContract,
        @JsonProperty("safety_level") String safetyLevel,
        @JsonProperty("allowed_workers") List<String> allowedWorkers,
        @JsonProperty("max_depth") Integer maxDepth,
        @JsonProperty("max_fanout") Integer maxFanout,
        @JsonProperty("task_brief_template") String taskBriefTemplate) {

    /** @return 是否为 coordinator 角色 */
    public boolean isCoordinator() {
        return AgentVO.ROLE_COORDINATOR.equals(role);
    }
}

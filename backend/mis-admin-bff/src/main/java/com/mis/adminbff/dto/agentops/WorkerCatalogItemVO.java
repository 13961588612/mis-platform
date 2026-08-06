package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Worker Catalog 单行（§4.3 #43，对应前端 {@code types.ts:WorkerCatalogEntry}）。
 *
 * <p>Catalog 是 coordinator 选 worker 时的「目录页」：{@code whenToUse} 与
 * {@code safetyLevel} 直接参与调度决策，因此它们虽然也存在于
 * {@link CoordinationVO} 里，仍要在这里冗余一份 —— 否则渲染一张 N 行的目录
 * 就要发 N 次 coordination 请求。
 *
 * @param agentId     Agent ID
 * @param displayName 显示名
 * @param role        {@code coordinator} | {@code worker}
 * @param whenToUse   何时该派给它，coordinator 行为 null
 * @param safetyLevel {@code low} | {@code medium} | {@code high}
 * @param enabled     是否可被派发
 */
public record WorkerCatalogItemVO(
        @JsonProperty("agent_id") String agentId,
        @JsonProperty("display_name") String displayName,
        @JsonProperty("role") String role,
        @JsonProperty("when_to_use") String whenToUse,
        @JsonProperty("safety_level") String safetyLevel,
        @JsonProperty("enabled") Boolean enabled) {
}

package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Agent 可用技能与绑定态（§4.3 #20，对应前端 {@code types.ts:AgentSkillBinding} 列表）。
 *
 * <h2>为什么返回「全池 + enabled 标记」而不是「已绑定列表」</h2>
 * UI#5 是一个多选面板：要同时显示<b>可选</b>与<b>已选</b>。若只回传已绑定的技能，
 * 前端还得再拉一次技能池、再做一次差集 —— 两次请求之间技能池若发生变化
 * （管理员刚停用了一个），前端算出的差集就是错的，且错得很隐蔽。
 * 一次返回带标记的全量，前端无需任何集合运算。
 *
 * <p>{@code skill_status} 让前端能把「已绑定但技能已下线」的项<b>置灰而非隐藏</b>。
 * 隐藏会让用户以为绑定已解除，实际上下次保存时才被静默丢弃。
 *
 * @param agentId  Agent ID
 * @param bindings 技能绑定列表，覆盖技能池全量；永不为 null
 */
public record AgentSkillsVO(
        @JsonProperty("agent_id") String agentId,
        @JsonProperty("bindings") List<Binding> bindings) {

    public AgentSkillsVO {
        bindings = (bindings == null) ? List.of() : List.copyOf(bindings);
    }

    /**
     * 单条技能绑定。
     *
     * @param skillId     技能 ID
     * @param enabled     该 Agent 是否启用此技能
     * @param skillStatus 该技能在池内的状态（{@code active} / {@code disabled}），用于前端置灰
     */
    public record Binding(
            @JsonProperty("skill_id") String skillId,
            @JsonProperty("enabled") Boolean enabled,
            @JsonProperty("skill_status") String skillStatus) {
    }
}

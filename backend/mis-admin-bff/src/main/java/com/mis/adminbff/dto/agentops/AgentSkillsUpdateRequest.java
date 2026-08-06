package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 保存 Agent 技能绑定入参（§4.3 #21）。
 *
 * <p>与 {@link SkillGrantUpdateRequest} 同理，语义是<b>全量覆盖</b>：
 * {@code bindings} 未出现的技能视为解绑。{@code @NotNull} 挡住「字段丢失被当成清空」
 * 这一类静默数据损失，空列表则是合法输入（解绑全部技能）。
 *
 * <p><b>为什么不在 BFF 校验「只能绑 active 技能」</b>：这条规则的真值源是技能池状态，
 * 而技能池在 ai-platform 侧。BFF 校验需要先拉一次全量技能池，
 * 这中间存在 TOCTOU 窗口 —— 校验通过后、写入前技能被停用，照样落库。
 * 规则由持有数据的一侧（下游）做才是原子的；BFF 这层重复一遍只会制造
 * 「BFF 说不行但其实可以」或反之的错位。前端的置灰是<b>体验</b>优化，不是校验。
 *
 * @param bindings 保存后应生效的完整绑定集合；允许为空列表，不允许为 null
 */
public record AgentSkillsUpdateRequest(
        @JsonProperty("bindings")
        @NotNull(message = "bindings 不能为 null（解绑全部请传空数组 []）")
        List<Item> bindings) {

    /**
     * 单条绑定项。
     *
     * @param skillId 技能 ID，必填
     * @param enabled 是否启用；为 null 时按 {@code true} 处理（出现在列表里即表示要绑）
     */
    public record Item(
            @JsonProperty("skill_id") String skillId,
            @JsonProperty("enabled") Boolean enabled) {

        /** @return 归一后的启用标记，null 视为 true */
        public boolean enabledOrTrue() {
            return enabled == null || enabled;
        }
    }

    /** @return 永不为 null 的绑定列表 */
    public List<Item> normalizedBindings() {
        return bindings == null ? List.of() : bindings;
    }
}

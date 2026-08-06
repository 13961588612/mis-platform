package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 保存技能授权入参（§4.3 #11）。
 *
 * <h2>语义是「全量覆盖」，不是「增量追加」</h2>
 * {@code roleIds} 表示<b>保存后应当持有该技能执行码的完整角色集合</b>：
 * 不在列表里的角色一律回收。这与授权页的交互一致（多选框，勾掉即取消）。
 *
 * <p>因此 {@code @NotNull} 是必须的，而空列表是<b>合法</b>的：
 * 「一个角色都不授」是一个有意义的操作（收回全部授权）。
 * 如果把 null 当成空列表容错，一次前端 bug 导致的字段丢失就会被解释成
 * 「清空所有授权」—— 静默的权限回收比报错严重得多。所以 null 必须报错，
 * 空列表必须放行，两者不能混为一谈。
 *
 * @param roleIds 保存后应持有该技能执行码的完整角色 ID 集合；允许为空列表，不允许为 null
 */
public record SkillGrantUpdateRequest(
        @JsonProperty("role_ids")
        @NotNull(message = "role_ids 不能为 null（清空授权请传空数组 []）")
        List<Long> roleIds) {

    /**
     * @return 去重后的角色 ID 列表，永不为 null
     */
    public List<Long> normalizedRoleIds() {
        if (roleIds == null) {
            return List.of();
        }
        return roleIds.stream()
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }
}

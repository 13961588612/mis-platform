package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 技能授权现状（§4.3 #10，对应前端 {@code types.ts:SkillGrant}）。
 *
 * <p>这是 <b>BFF 自建</b>的结构，不是下游透传：ai-platform 完全不知道 MIS 的角色体系，
 * 授权数据的真值源是 mis-iam 的 {@code sys_role_menu}。BFF 在这里做的事是
 * 「把 {@code roleId → menuIds} 的关系翻转成 {@code skillId → roleIds}」。
 *
 * <h2>{@code permission_code} 为什么要回传</h2>
 * 它恒为 {@code ai:skill:{skill_id}:run}，前端<b>能自己拼</b>。但拼接规则一旦分散到前端，
 * 就变成了两个真值源：V21 迁移里的实际码格式若与前端拼法有一个字符出入
 * （例如某天决定改成 {@code ai:skill:run:{id}}），前端的权限展示会和后端判权错位，
 * 且不会有任何报错。由后端回传实际生效的码，前端只负责显示，规则永远只有一份。
 *
 * @param skillId        技能 ID
 * @param permissionCode 实际生效的执行码，恒为 {@code ai:skill:{skillId}:run}
 * @param targetAppCode  码挂载的 App，当前恒为 {@code system}（V21 口径）
 * @param roleIds        已授予该码的角色 ID 列表，永不为 null
 */
public record SkillGrantVO(
        @JsonProperty("skill_id") String skillId,
        @JsonProperty("permission_code") String permissionCode,
        @JsonProperty("target_app_code") String targetAppCode,
        @JsonProperty("role_ids") List<Long> roleIds) {

    /** V21 把技能执行码统一挂在 {@code system} App 下；保留 {@code agent} 取值供 T05 扩展。 */
    public static final String APP_SYSTEM = "system";

    /**
     * 紧凑构造：把 {@code roleIds} 归一成不可变空列表，避免调用方拿到 null。
     *
     * <p>授权页的 {@code role_ids} 为 null 与为 {@code []} 在前端是两种渲染
     * （前者可能被当成「加载中」），但在后端语义上完全一样 ——「没有任何角色被授权」。
     * 在这里收敛掉，比要求每个调用方各自判空可靠。
     */
    public SkillGrantVO {
        roleIds = (roleIds == null) ? List.of() : List.copyOf(roleIds);
    }

    /**
     * 按 V21 约定拼技能执行码。
     *
     * <p>{@code skillId} 中的点<b>原样保留</b>（如 {@code ai:skill:member.profile:run}）——
     * V21 建的按钮节点就是这个形状，任何「把点换成冒号 / 下划线」的规范化都会导致
     * 拼出来的码在 {@code sys_menu} 里查无此行，授权保存后实际不生效。
     *
     * @param skillId 技能 ID
     * @return 执行码
     */
    public static String permissionCodeOf(String skillId) {
        return "ai:skill:" + skillId + ":run";
    }
}

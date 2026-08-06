package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 技能池条目（对应前端 {@code types.ts:Skill}）。
 *
 * <h2>字段为什么是 snake_case</h2>
 * 这些结构由 ai-platform（FastAPI）产出、BFF 原样透传、前端直接消费。
 * 三端保持同一套 wire format，就没有任何一处需要写映射函数；
 * 一旦在 BFF 这层改成 camelCase，前端 {@code types.ts} 与下游 Pydantic 模型
 * 就有了两套命名，每加一个字段都要同步三处 —— 而漏改的表现是字段静默变
 * {@code undefined}，不报错、不进日志。
 *
 * <h2>为什么用 record</h2>
 * 这类 VO 只在「下游 JSON → 强类型 → 响应」的单向链路上出现，没有可变需求。
 * record 天然不可变、自带 {@code equals/hashCode/toString}，也让「谁改了这个对象」
 * 这个问题在代码层面不成立。
 *
 * <p><b>注意</b>：本 VO 只用于 BFF <b>确实要读字段</b>的场景（如授权页要拿 {@code id}
 * 去补建权限码）。纯透传端点走 {@code JsonNode}，不经过这里 —— 详见
 * {@code AgentOpsClient} 类注释里的策略 A。
 *
 * @param id          技能 ID，可含点（如 {@code member.profile}）
 * @param name        显示名
 * @param description 描述
 * @param status      {@code active} | {@code disabled}
 * @param category    分类，可为 null
 * @param version     版本号，可为 null
 * @param tags        标签，可为 null
 * @param updatedAt   最后更新时间（ISO-8601 字符串）
 */
public record SkillVO(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name,
        @JsonProperty("description") String description,
        @JsonProperty("status") String status,
        @JsonProperty("category") String category,
        @JsonProperty("version") String version,
        @JsonProperty("tags") List<String> tags,
        @JsonProperty("updated_at") String updatedAt) {

    /** 技能池内的启用态，与 {@code types.ts:SkillStatus} 对齐。 */
    public static final String STATUS_ACTIVE = "active";

    /** 技能池内的停用态。 */
    public static final String STATUS_DISABLED = "disabled";

    /** @return 是否处于启用态（Agent 技能绑定只允许挂启用中的技能） */
    public boolean isActive() {
        return STATUS_ACTIVE.equals(status);
    }
}

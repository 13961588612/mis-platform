package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 新建 / 编辑技能入参（§4.3 #4 / #5）。
 *
 * <h2>为什么新建与编辑共用一个 DTO</h2>
 * 两者的字段集合完全一致，差异只在「{@code skill_id} 从 body 来还是从路径来」。
 * 拆成两个类会产生一对必须永远同步修改的孪生文件 —— 加字段时漏改一个，
 * 表现是「新建能填、编辑填不了」这种只有手工点击才发现的问题。
 *
 * <h2>{@code skill_id} 的校验只在新建时生效</h2>
 * 编辑走 {@code PUT /skills/{id}}，路径已带 ID，body 里的 {@code skill_id} 会被下游忽略。
 * 因此这里<b>不</b>给 {@code skill_id} 加 {@code @NotBlank} —— 加了会让编辑请求
 * 必须冗余回传一个它根本不使用的字段。新建时的必填由
 * {@code AgentOpsFacadeService#createSkill} 显式校验，报错信息也更贴合场景。
 *
 * <h2>线协议主键是 {@code skill_id} 不是 {@code id}</h2>
 * 前端 {@code SkillPayload} 与 ai-platform {@code SkillCreateRequest} 均为
 * {@code skill_id}。只认 {@code id} 会把新建请求判成「未指定 ID」（40917），
 * 且 {@code handler}/{@code body} 也会在 BFF 这一跳被静默丢弃。
 * {@code @JsonAlias("id")} 仅兼容旧客户端。
 *
 * @param id          技能 ID（JSON {@code skill_id}）；新建必填，编辑忽略
 * @param name        显示名，必填
 * @param description 描述
 * @param category    分类
 * @param version     版本号
 * @param tags        标签
 * @param handler     执行器标识；空串 = 文档型/检索型
 * @param body        SKILL.md 正文；custom 技能落盘用
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SkillUpsertRequest(
        @JsonProperty("skill_id")
        @JsonAlias("id")
        @Size(max = 128, message = "技能 ID 长度不能超过 128")
        String id,

        @JsonProperty("name")
        @NotBlank(message = "技能名称不能为空")
        @Size(max = 128, message = "技能名称长度不能超过 128")
        String name,

        @JsonProperty("description")
        @Size(max = 2000, message = "技能描述长度不能超过 2000")
        String description,

        @JsonProperty("category")
        @Size(max = 64, message = "分类长度不能超过 64")
        String category,

        @JsonProperty("version")
        @Size(max = 32, message = "版本号长度不能超过 32")
        String version,

        @JsonProperty("tags") List<String> tags,

        @JsonProperty("handler")
        @Size(max = 256, message = "handler 长度不能超过 256")
        String handler,

        @JsonProperty("body")
        String body) {

    /** @return 去掉首尾空白的技能 ID；未填时返回 {@code null} */
    public String normalizedId() {
        if (id == null) {
            return null;
        }
        String trimmed = id.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 批量删除会话入参（§4.3 #31）。
 *
 * <h2>这里用 {@code @NotEmpty} 而不是 {@code @NotNull}，与授权类 DTO 相反</h2>
 * 区别在于「空集合」在两个场景下的语义完全不同：
 * <ul>
 *   <li>{@link SkillGrantUpdateRequest} 是<b>全量覆盖</b>，空列表 = 「收回全部授权」，
 *       是一个有意义的操作，必须放行；</li>
 *   <li>本请求是<b>逐条删除</b>，空列表 = 「什么也不删」，是一次纯粹的无效调用。
 *       放行它只会产生一条什么都没做却返回成功的审计记录，
 *       日后排查「谁删的」时反而增加噪声。</li>
 * </ul>
 * 同一个注解在不同语义下的正确选择不同，照抄另一个 DTO 就会错。
 *
 * <p>{@code @Size(max = 500)} 是保护下游：批量删除通常是一个事务，
 * 不设上限时一次几万条会把下游事务撑爆并长时间持锁。
 *
 * @param ids 待删除会话 ID 列表，至少 1 条，至多 500 条
 */
public record SessionBatchDeleteRequest(
        @JsonProperty("ids")
        @NotEmpty(message = "ids 不能为空")
        @Size(max = 500, message = "单次批量删除不能超过 500 条")
        List<String> ids) {

    /** @return 去重且剔除空白项后的 ID 列表 */
    public List<String> normalizedIds() {
        if (ids == null) {
            return List.of();
        }
        return ids.stream()
                .filter(id -> id != null && !id.isBlank())
                .map(String::trim)
                .distinct()
                .toList();
    }
}

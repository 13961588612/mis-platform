package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 用户端评价提交请求（POST /api/v1/agent-ops/sessions/{session_id}/feedback）。
 *
 * <p>与 ai-platform {@code MessageFeedbackRequest} 同构（snake_case wire）：
 * <ul>
 *   <li>{@code rating}：up 点赞 / down 吐槽，必填；</li>
 *   <li>{@code comment}：≤500 字；down 必填（服务端 4001 校验，BFF 只限长不判方向）；</li>
 *   <li>{@code message_id}：done 帧透传的后端消息 UUID（推荐，精确锚定）；</li>
 *   <li>{@code content}：兜底，message_id 缺失时按内容对齐。</li>
 * </ul>
 *
 * <p>BFF 侧零加工，body 原样透传 ai-platform {@code POST /api/v1/sessions/{session_id}/feedback}；
 * {@code agent_id} 由下游会话自动带出（= mis-iqd），不在此注入。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record IqdFeedbackRequest(
        @JsonProperty("rating")
        @NotBlank(message = "评价方向不能为空")
        @Size(max = 16, message = "评价方向长度不能超过 16")
        String rating,

        @JsonProperty("comment")
        @Size(max = 500, message = "评价说明不能超过 500 字")
        String comment,

        @JsonProperty("message_id")
        @Size(max = 64, message = "消息 ID 长度不能超过 64")
        String messageId,

        @JsonProperty("content")
        @Size(max = 20000, message = "回答正文长度不能超过 20000")
        String content) {

    /** @return 归一后的小写评价方向（up / down）；空串表示未填。 */
    public String normalizedRating() {
        return rating == null ? "" : rating.trim().toLowerCase();
    }
}

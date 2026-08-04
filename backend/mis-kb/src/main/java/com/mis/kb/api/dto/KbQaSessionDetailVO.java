package com.mis.kb.api.dto;

import java.util.List;

/**
 * 问答会话详情视图（含消息与引用）。
 *
 * <p>A-02a 扩展：新增 {@code visibility}（命中库的密级 + ACL 摘要）与
 * {@code recallParams}（召回参数快照），供运营排障「为什么答成这样」。
 * 两者在普通用户视角下可能为 {@code null}——只有运营端点才会填充。
 *
 * @param session      会话基本信息
 * @param messages     消息列表（含引用）
 * @param feedback     反馈；未提交为 {@code null}
 * @param visibility   可见范围（运营视角）；用户视角为 {@code null}
 * @param recallParams 召回参数快照（运营视角）；用户视角为 {@code null}
 */
public record KbQaSessionDetailVO(
        KbQaSessionVO session,
        List<QaMessageVO> messages,
        KbQaFeedbackVO feedback,
        VisibilityVO visibility,
        RecallParamsVO recallParams) {

    /** 用户视角便捷构造（不含运营专属字段）。 */
    public KbQaSessionDetailVO(
            KbQaSessionVO session, List<QaMessageVO> messages, KbQaFeedbackVO feedback) {
        this(session, messages, feedback, null, null);
    }
}

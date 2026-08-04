package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 问答会话详情视图（BFF 侧镜像，含消息、引用、反馈）。
 *
 * <p>A-02a 新增 {@code visibility}（可见范围快照）与 {@code recallParams}（召回参数快照）；
 * 用户视角（{@code /qa/sessions/{id}}）这两个字段为 {@code null}，
 * 只有运营视角（{@code /operations/qa/sessions/{id}}）才会填充——
 * 普通用户没必要知道命中库的授权明细。
 *
 * @param session      会话基本信息
 * @param messages     消息列表（含引用）
 * @param feedback     反馈；未提交为 {@code null}
 * @param visibility   可见范围快照；仅运营视角非空
 * @param recallParams 召回参数快照；仅运营视角非空
 */
public record KbQaSessionDetailVO(
        KbQaSessionVO session,
        List<KbQaMessageVO> messages,
        KbQaFeedbackVO feedback,
        KbVisibilityVO visibility,
        KbRecallParamsVO recallParams) {
}

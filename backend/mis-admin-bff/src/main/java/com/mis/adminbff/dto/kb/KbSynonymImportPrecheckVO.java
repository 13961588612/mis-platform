package com.mis.adminbff.dto.kb;

import java.time.Instant;
import java.util.List;

/**
 * 导入预检报告（BFF 侧镜像，字段与 mis-kb {@code SynonymImportPrecheckVO} 一一对齐）。
 *
 * <p>Wave D 新增，纯透传。<b>预检阶段不写任何词表数据</b>，
 * 这是「跳过而非整批回滚」这个产品决策的第 1 条前置条件。
 *
 * <p>{@link #token} 与 {@link #batchId} 都给，是因为二者生命周期不同：
 * token 是一次性提交凭据（提交后作废、30 分钟过期），
 * batchId 是长期批次标识（提交后仍可反复下载未导入行）。
 *
 * @param token         阶段二提交凭据
 * @param batchId       批次 ID（阶段三下载未导入行用）
 * @param format        {@code CSV} / {@code JSON}
 * @param plannedCreate 计划新增组数
 * @param plannedMerge  计划并入已有组的组数
 * @param plannedSkip   计划跳过行数
 * @param rows          逐行明细
 * @param warnings      非阻断提示（水位、空别名、过短词等）
 * @param expiresAt     令牌过期时刻
 */
public record KbSynonymImportPrecheckVO(
        String token,
        Long batchId,
        String format,
        Integer plannedCreate,
        Integer plannedMerge,
        Integer plannedSkip,
        List<KbSynonymImportRowVO> rows,
        List<String> warnings,
        Instant expiresAt) {
}

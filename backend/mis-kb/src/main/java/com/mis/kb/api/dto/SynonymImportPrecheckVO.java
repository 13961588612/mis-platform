package com.mis.kb.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * 导入预检报告（Wave D，WD-04，阶段一产物）。
 *
 * <p>字段与前端 {@code KbSynonymImportPrecheck} 逐字段对齐。
 *
 * <p><b>本阶段不写任何词表数据</b>，只 INSERT 一行 {@code kb_synonym_import_batch}。
 * 这是 PRD §4.4.4「跳过而非整批回滚」这个产品决策的第 1 条前置条件：
 * 管理员必须先看到报告、再显式点「确认导入」。
 *
 * <p>{@link #token} 是阶段二的提交凭据；{@link #batchId} 用于阶段三下载未导入行。
 * 两个都给，是因为它们服务于不同的调用：token 是一次性凭据（提交后作废），
 * batchId 是长期可查的批次标识（提交后仍能反复下载未导入行）。
 *
 * @param token         提交凭据（一次性）
 * @param batchId       批次 ID（下载未导入行用）
 * @param format        文件格式 {@code CSV} / {@code JSON}
 * @param plannedCreate 计划新增组数
 * @param plannedMerge  计划并入已有组的组数
 * @param plannedSkip   计划跳过行数
 * @param rows          逐行明细（含行号 + 冲突词 + 现属组）
 * @param warnings      非阻断提示（水位、空别名、过短词等）
 * @param expiresAt     令牌过期时刻
 */
public record SynonymImportPrecheckVO(
        String token,
        Long batchId,
        String format,
        Integer plannedCreate,
        Integer plannedMerge,
        Integer plannedSkip,
        List<SynonymImportRowVO> rows,
        List<String> warnings,
        Instant expiresAt) {

    /**
     * 紧凑构造：列表收敛为不可变非空，避免前端拿到 {@code null} 还要判空。
     */
    public SynonymImportPrecheckVO {
        rows = rows == null ? List.of() : List.copyOf(rows);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
}

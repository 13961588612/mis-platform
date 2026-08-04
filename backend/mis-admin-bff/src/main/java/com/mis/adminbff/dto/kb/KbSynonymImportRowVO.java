package com.mis.adminbff.dto.kb;

/**
 * 导入预检逐行明细（BFF 侧镜像，字段与 mis-kb {@code SynonymImportRowVO} 一一对齐）。
 *
 * <p>Wave D 新增，纯透传。
 *
 * <p><b>后四个字段一个都不能省。</b>报告里那句「第 27 行「OKR」已属于术语组「关键结果法」」
 * 由 {@link #lineNo} + {@link #conflictTerm} + {@link #ownerCanonicalTerm} 拼出，
 * {@link #ownerGroupId} 支撑「点击跳到那个组」。少任何一个，
 * 前端就只能显示一句无信息量的「有冲突」——管理员拿着 2000 行的文件无从下手。
 *
 * @param lineNo             原始文件行号（1 起）
 * @param canonicalTerm      本行规范词原文
 * @param action             {@code CREATE} / {@code MERGE} / {@code SKIP}
 * @param skipReason         跳过原因（仅 SKIP 行非空）
 * @param conflictTerm       冲突词<b>原文</b>（仅冲突类 SKIP 行非空）
 * @param ownerGroupId       冲突词现属组 ID
 * @param ownerCanonicalTerm 冲突词现属组规范词
 */
public record KbSynonymImportRowVO(
        Integer lineNo,
        String canonicalTerm,
        String action,
        String skipReason,
        String conflictTerm,
        Long ownerGroupId,
        String ownerCanonicalTerm) {
}

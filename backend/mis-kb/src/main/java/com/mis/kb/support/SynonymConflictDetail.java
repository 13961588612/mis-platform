package com.mis.kb.support;

/**
 * 词条唯一性冲突明细（Wave D，WD-01 / 40927 的响应体 {@code data}）。
 *
 * <p><b>三个字段缺一不可。</b>前端 {@code toConflictError()} 只认这三样，
 * 用来拼 PRD §4.3 那句「「OKR」与术语组「目标管理」中的「ＯＫＲ」冲突」：
 * <ul>
 *   <li>{@link #term} —— 冲突词，前端拿它做 {@code normalizeSynonymTerm()} 定位是哪一行标红；</li>
 *   <li>{@link #ownerGroupId} —— 现属组 ID，跳转链接的目标；</li>
 *   <li>{@link #ownerCanonicalTerm} —— 现属组规范词，缺失时前端降级显示 {@code #{id}}，
 *       两个都缺就变成一个没有意义的 {@code #-}，AC-11 直接判不通过。</li>
 * </ul>
 *
 * <p><b>{@link #term} 必须是原始写法，不是 {@code term_norm}</b>（U4 衍生裁决）。
 * 判重在归一化词形上做，回显给用户的却必须是他实际敲进去的那个样子——
 * 否则用户看到的是「「ｏｋｒ」冲突」，而他明明输入的是「ＯＫＲ」，只会更困惑。
 * 同理 {@link #ownerCanonicalTerm} 也取库里存的原文。
 *
 * <p><b>为什么带上「两种原始写法」这件事很重要：</b>全角「ＯＫＲ」与半角「OKR」
 * 归一化后是同一个词，但用户眼里是两个长得不一样的字符串。只有把双方原文都摆出来，
 * 「为什么这俩会冲突」才解释得通——这正是 NFKC（U4）这个决策的配套交代。
 *
 * @param term               本次提交中发生冲突的词条<b>原文</b>
 * @param ownerGroupId       该词当前所属的术语组 ID
 * @param ownerCanonicalTerm 该术语组的规范词<b>原文</b>
 */
public record SynonymConflictDetail(
        String term,
        Long ownerGroupId,
        String ownerCanonicalTerm) {
}

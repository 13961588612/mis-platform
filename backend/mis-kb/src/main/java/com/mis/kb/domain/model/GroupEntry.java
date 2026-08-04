package com.mis.kb.domain.model;

import java.util.List;

/**
 * 内存词典中的一个术语组条目（Wave D）。
 *
 * <p>由 {@code SynonymDictLoader} 在全量加载时构造，构造后<b>不可变</b>
 * （{@code orderedTerms} 在紧凑构造里 {@code List.copyOf} 冻结）。
 *
 * @param groupId       术语组 ID
 * @param canonicalTerm 规范词（展示用原文）
 * @param orderedTerms  组内全部词条原文，按 {@code sort_no} 升序，<b>规范词恒在首位</b>。
 *                      预算「每组最多并入 M 个别名」即取本列表前 {@code M + 1} 项
 */
public record GroupEntry(
        Long groupId,
        String canonicalTerm,
        List<String> orderedTerms) {

    /** 紧凑构造：冻结列表，null 收敛为空列表。 */
    public GroupEntry {
        orderedTerms = orderedTerms == null ? List.of() : List.copyOf(orderedTerms);
    }
}

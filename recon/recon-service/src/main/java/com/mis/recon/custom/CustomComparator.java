package com.mis.recon.custom;

import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.MatchPair;

import java.util.Map;

/**
 * 规则级自定义比较器（compare_mode=custom，方案设计 §13 / custom-需求规格 §3.5）。
 * <p>Tab C 规则行 compare_mode=custom 时，该行比较交给自定义类：入参匹配对（leftSingle/rightSingle）
 * 与行级参数（comparator_params 原样传入，规则行配置），出参 {@link CompareResult}（一致/差异），
 * 与内置 equal 行可混用。</p>
 */
public interface CustomComparator {

    /**
     * 比较匹配对。
     *
     * @param pair   匹配对（leftSingle/rightSingle 参与比较）
     * @param params 行级比较器参数（comparator_params 原样传入；可为 null/空，由实现类自解析）
     * @return 一致（CompareResult.ok）或差异（CompareResult.fail）
     */
    CompareResult compare(MatchPair pair, Map<String, Object> params);
}

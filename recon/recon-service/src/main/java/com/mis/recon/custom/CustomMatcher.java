package com.mis.recon.custom;

import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchResult;

import java.util.List;
import java.util.Map;

/**
 * 自定义匹配器（strategy=custom，方案设计 §13 / custom-需求规格 §3.1）。
 * <p>匹配逻辑整体交给自定义类：入参多数据集（ds_code → 行集合，已合流增量∪池∪索引）与参数
 * （config_json 除 class 外键值原样），出参 {@link MatchResult}（pairs/unmatched/anomalies），
 * 复用既有两两匹配差异判定链路（VerdictService.apply）。可选在 MatchResult 附带 diagnosisContext
 * 合并进 diff_diagnosis_json；不提供则默认空诊断（功能降级可用，§13.2）。</p>
 */
public interface CustomMatcher {

    /**
     * 执行自定义匹配。
     *
     * @param dataset ds_code → 行集合（第 1=left，第 2=right，与配置 datasets_json 顺序一致）
     * @param params  config_json 除 class 外键值原样（由实现类自解析）
     * @return 匹配结果（null 视为全空结果，引擎兜底为无差异）
     */
    MatchResult match(Map<String, List<LedgerRow>> dataset, Map<String, Object> params);
}

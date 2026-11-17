package com.mis.recon.custom;

import com.mis.recon.domain.runtime.LedgerRow;
import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 整检查上下文（strategy=custom_check 入参）。
 * <p>多数据集按配置 datasets_json 顺序传入；参数 = config_json 除 class 外键值原样。</p>
 */
@Data
@Builder
public class CustomCheckContext {

    private String scenarioCode;
    private String checkName;

    /** ds_code → 行集合（已合流增量∪池∪索引；顺序与配置 datasets_json 一致） */
    private Map<String, List<LedgerRow>> dataset;

    /** config_json 除 class 外键值原样（由实现类自解析） */
    private Map<String, Object> params;
}

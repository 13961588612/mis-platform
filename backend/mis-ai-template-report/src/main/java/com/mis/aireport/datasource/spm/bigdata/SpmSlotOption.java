package com.mis.aireport.datasource.spm.bigdata;

import java.util.Map;

/** 槽位下拉选项（大数据源归一后）。 */
public record SpmSlotOption(String value, String label, Map<String, Object> extra) {

    public SpmSlotOption(String value, String label) {
        this(value, label, Map.of());
    }
}

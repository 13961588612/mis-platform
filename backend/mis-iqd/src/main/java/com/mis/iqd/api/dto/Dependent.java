package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 直接引用方（v1.11 系统设计 §5 {@code Dependent}；snake_case wire）。
 *
 * <p>用途：删除/改结构前的**引用阻断**证据（42200 响应体 {@code data.dependents}），
 * 以及右栏「依赖方提示区」渲染。
 */
public class Dependent {

    /** 引用方节点稳定键（§8.6 {@code mdl:model:orders} / {@code mdl:cube:revenue} 等）。 */
    private String itemKey;

    /** 引用方种类：model|column|relationship|cube|measure|dimension|view|sql_pair|knowledge。 */
    private String kind;

    public Dependent() {
    }

    public Dependent(String itemKey, String kind) {
        this.itemKey = itemKey;
        this.kind = kind;
    }

    @JsonProperty("item_key")
    public String getItemKey() {
        return itemKey;
    }

    public void setItemKey(String itemKey) {
        this.itemKey = itemKey;
    }

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind;
    }
}

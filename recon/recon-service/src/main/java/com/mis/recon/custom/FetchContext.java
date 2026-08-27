package com.mis.recon.custom;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 自定义取数上下文（取数层需求规格 §4.2 接口入参）。
 * <p>窗口（windowStart / windowEnd）+ config_json 参数（除 class 外键值原样）+ 连接信息
 * （api/custom 不经过连接层，connInfo 通常为 null，预留给实现类需要时扩展）。</p>
 */
@Data
@Builder
public class FetchContext {

    /** 拉取窗口起点（含），实现类按窗口圈定取数范围。 */
    private LocalDateTime windowStart;

    /** 拉取窗口终点（不含）。 */
    private LocalDateTime windowEnd;

    /** config_json 参数 Map（fetch_config_json.config_json 原样透传，不含 class 键）。 */
    private Map<String, Object> params;

    /** 连接信息（可空；api/custom 数据源 conn_code 置空，通常为 null）。 */
    private Object connInfo;
}

package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 会话列表查询条件（§4.3 #27，对应前端 {@code types.ts:SessionQuery}）。
 *
 * <h2>这是全批次里少数「BFF 真的要加工」的结构</h2>
 * 纯透传端点走 {@code JsonNode}（策略 A），但这里不行 —— 分页参数需要<b>归一与兜底</b>：
 * <ul>
 *   <li>{@code page} 缺省或 &lt; 1 时必须落到 1。放任 {@code page=0} 传下去，
 *       FastAPI 侧多半按 offset 计算成负数，行为取决于具体实现，属于不可预期区间；</li>
 *   <li>{@code pageSize} 必须<b>封顶</b>。会话表是全量历史，不设上限时一个
 *       {@code page_size=1000000} 就能把下游内存打满 —— 这不需要恶意，
 *       前端一个「导出全部」的实现失误就够了。</li>
 * </ul>
 * 这类兜底放在 BFF 是合适的：它是所有运营台流量的必经之路，
 * 而下游还要服务其它调用方，不该为运营台的分页习惯做特殊约束。
 *
 * @param agentId 按 Agent 过滤
 * @param channel 按渠道过滤
 * @param keyword 关键词（标题 / 内容）
 * @param from    起始时间（ISO-8601）
 * @param to      截止时间（ISO-8601）
 * @param page    页码，从 1 开始
 * @param pageSize 每页条数
 */
public record SessionQuery(
        @JsonProperty("agent_id") String agentId,
        @JsonProperty("channel") String channel,
        @JsonProperty("keyword") String keyword,
        @JsonProperty("from") String from,
        @JsonProperty("to") String to,
        @JsonProperty("page") Integer page,
        @JsonProperty("page_size") Integer pageSize) {

    /** 缺省页码。 */
    public static final int DEFAULT_PAGE = 1;

    /** 缺省每页条数。 */
    public static final int DEFAULT_PAGE_SIZE = 20;

    /**
     * 每页条数上限。
     *
     * <p>200 不是拍脑袋：运营台列表一屏最多几十行，200 已覆盖「一次多翻几页」的诉求；
     * 再大就只可能是导出类需求，那应当走专门的导出接口（带流式与限速），
     * 而不是把分页接口当导出用。
     */
    public static final int MAX_PAGE_SIZE = 200;

    /** @return 归一后的页码，恒 ≥ 1 */
    public int normalizedPage() {
        return (page == null || page < DEFAULT_PAGE) ? DEFAULT_PAGE : page;
    }

    /** @return 归一后的每页条数，恒落在 [1, {@value #MAX_PAGE_SIZE}] */
    public int normalizedPageSize() {
        if (pageSize == null || pageSize < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(pageSize, MAX_PAGE_SIZE);
    }
}

package com.mis.kb.domain.model;

/**
 * {@code kb_library.engine_sync_status} 码值（引擎删除策略 P0 / T01）。
 *
 * <p>刻意做成常量类而不是枚举：该列是 {@code SMALLINT}，JPA 侧直接用 {@code Integer} 存，
 * 引入枚举会牵出 {@code @Convert} 与既有 {@code LibraryStatus}（同样是裸 Integer）的口径分裂。
 * 这里只提供码值常量 + 一个描述方法，够用且不制造第二套约定。
 *
 * <table border="1">
 *   <caption>码值</caption>
 *   <tr><th>值</th><th>含义</th><th>写入方</th></tr>
 *   <tr><td>0</td><td>未知（未对过账）</td><td>建库默认值</td></tr>
 *   <tr><td>1</td><td>一致</td><td>对账服务</td></tr>
 *   <tr><td>2</td><td>引擎缺失（MIS 有 / 引擎无）</td><td>对账服务</td></tr>
 *   <tr><td>3</td><td>名称漂移 / 引擎同步失败</td><td>对账服务、{@code update()}、归档改名失败</td></tr>
 * </table>
 *
 * <p>「引擎有 / MIS 无」这类差异<b>不落 kb_library</b>（无行可落），写
 * {@code kb_engine_orphan} 表。
 */
public final class EngineSyncStatus {

    /** 未知：从未与引擎对过账（建库默认值）。 */
    public static final int UNKNOWN = 0;

    /** 一致：引擎侧存在且名称与期望名相符。 */
    public static final int CONSISTENT = 1;

    /** 引擎缺失：MIS 有 {@code engine_library_ref}，但引擎侧查不到该 dataset。 */
    public static final int MISSING_IN_ENGINE = 2;

    /** 名称漂移或同步失败：引擎侧名称与期望名不符，或最近一次同步调用抛异常。 */
    public static final int DRIFT_OR_FAILED = 3;

    private EngineSyncStatus() {
        throw new AssertionError("常量类不允许实例化");
    }

    /**
     * 码值的中文描述（日志与回执 message 用，前端另有自己的文案表）。
     *
     * @param status 码值，允许 {@code null}
     * @return 描述文本，未知码值返回「未知」
     */
    public static String describe(Integer status) {
        if (status == null) {
            return "未知";
        }
        return switch (status) {
            case CONSISTENT -> "一致";
            case MISSING_IN_ENGINE -> "引擎缺失";
            case DRIFT_OR_FAILED -> "名称漂移或同步失败";
            default -> "未知";
        };
    }
}

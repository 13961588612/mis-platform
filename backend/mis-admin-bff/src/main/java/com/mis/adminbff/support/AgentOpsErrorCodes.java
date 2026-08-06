package com.mis.adminbff.support;

/**
 * 智能体运营控制台专属业务码。
 *
 * <p><b>为什么不加进 {@code ResultCode} 枚举</b>：{@code ResultCode} 位于
 * {@code mis-common-core}，被全部 8 个后端模块引用。为一个功能域的三个码去动公共枚举，
 * 会让本次交付的影响面从「1 个模块」扩散到「全仓」，且与
 * {@code ResultCode} 文件头「模块专属码可新增 {@code XxxResultCode}，code 勿与上表冲突」
 * 的既有约定相悖。故按该约定就地新增。
 *
 * <p><b>码段选取</b>：{@code ResultCode} 已占用 {@code 50000}（INTERNAL_ERROR）。
 * 本类取 {@code 501xx} / {@code 503xx} 段，语义与 HTTP 5xx 家族对齐，且与
 * {@code 401xx / 403xx / 400xx / 409xx / 50000} 均不冲突（已逐条核对）。
 */
public final class AgentOpsErrorCodes {

    private AgentOpsErrorCodes() {
    }

    /**
     * 下游能力尚未实现（对应 HTTP 501）。
     *
     * <p><b>这个码存在的唯一理由是「让未完工与真故障可区分」。</b>
     * T02 交付时，§4.3 的 58 条端点里有 19 条的下游（agent 技能绑定 / 配置文件 /
     * coordination / 会话列表与批量删除 / Worker Catalog / 调度追踪 / 企微 Bot / 审批）
     * 尚在 T04 排期中，请求打过去 FastAPI 会回 404 或 405。
     * 若沿用 {@code 50000}，前端和联调同学看到的就是「系统错误」——
     * 与「ai-platform 挂了」「BFF 代码有 bug」完全无法区分，
     * 每一条都要有人去翻日志才能确认「哦，这个本来就还没做」。
     *
     * @see DownstreamNotImplementedException
     */
    public static final int NOT_IMPLEMENTED = 50100;

    /**
     * 下游服务不可达（连接被拒 / DNS 失败 / 读超时）。
     *
     * <p>与 {@link #NOT_IMPLEMENTED} 的分工：<b>连得上但没这个路由</b> ⇒ 未实现；
     * <b>压根连不上</b> ⇒ 不可达。前者等 T04，后者要去看进程和网络，
     * 处置动作完全不同，混成一个码等于把排查成本转嫁给下一个人。
     */
    public static final int DOWNSTREAM_UNAVAILABLE = 50301;

    /**
     * 技能执行码（{@code ai:skill:{id}:run}）缺失且无法自动补建。
     *
     * <p>用于 {@code SkillPermissionCodeService.ensureCode()} 兜底：懒注册失败时必须
     * 显式报错而不是静默跳过 —— 静默跳过会让授权页「保存成功」但实际没授到任何码，
     * 是典型的 fail-open。
     */
    public static final int SKILL_CODE_UNAVAILABLE = 40917;

    /**
     * 无权执行指定技能（对应 HTTP 403）。
     *
     * <p>用于 E6 权限闸门 {@code SkillPermissionChecker}：当前用户未持有
     * {@code ai:skill:{skillId}:run} 权限码时拒绝。fail-closed 语义——无任何权限源命中
     * （缓存为空集、用户不存在、缺权限码）一律落到本码，不静默放行。
     */
    public static final int SKILL_FORBIDDEN = 40301;

    /**
     * 权限源不可用（对应 HTTP 403，fail-closed）。
     *
     * <p>当 mis-iam 回源超时 / 连接被拒 / 非 2xx / 无响应时抛出，拒绝而非放行。
     * 与 {@link #SKILL_FORBIDDEN} 的分工：<b>源挂了</b> ⇒ 本码（先别放行，等源恢复）；
     * <b>源活着但用户就是没这权限</b> ⇒ {@link #SKILL_FORBIDDEN}。
     */
    public static final int ACL_UNAVAILABLE = 40303;
}

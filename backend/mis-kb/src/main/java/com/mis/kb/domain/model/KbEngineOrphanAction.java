package com.mis.kb.domain.model;

/**
 * 游离 dataset 的处置动作（P1-T3）。
 *
 * <p>与 {@code kb_engine_orphan.resolved_action} 列的取值一一对应。注意它和
 * {@code resolved}（0/1）是两个维度：{@code resolved} 只说「处理了没」，
 * {@code resolved_action} 说「怎么处理的」——「已认领」和「已忽略」后果完全不同。
 */
public enum KbEngineOrphanAction {

    /** 认领到已存在的 MIS 库：把该库的 {@code engine_library_ref} 指向游离 dataset。 */
    BIND_EXISTING("bind_existing"),
    /** 新建一个 MIS 库并认领该游离 dataset（库已存在，跳过引擎 create）。 */
    ADOPT_NEW("adopt_new"),
    /** 标记已处理（不绑定、不删引擎数据），由管理员在 RAGFLOW 后台手工删。 */
    IGNORE("ignore");

    private final String code;

    KbEngineOrphanAction(String code) {
        this.code = code;
    }

    /** 线上码值（与迁移/前端约定的字符串一致）。 */
    public String code() {
        return code;
    }

    /**
     * 由码值反查枚举。
     *
     * @param code 码值（如 {@code "bind_existing"}）
     * @return 匹配的枚举；未知码返回 {@code null}
     */
    public static KbEngineOrphanAction of(String code) {
        if (code == null) {
            return null;
        }
        for (KbEngineOrphanAction action : values()) {
            if (action.code.equals(code)) {
                return action;
            }
        }
        return null;
    }
}

package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * ACL 授权主体类型。
 *
 * <p>{@code user} 用户（subject_id 复用 mis-iam 用户 id）；{@code role} 角色
 * （subject_id 复用 mis-iam 角色 id）；{@code dept} 部门（subject_id 复用 mis-org 部门 id，
 * I-03 增量新增，与 PRD「用户/角色/部门」三类主体对齐）。存于 {@code kb_acl.subject_type}，
 * 码值约束见 {@code V15__kb_incremental.sql} 的 {@code chk_kb_acl_subject}。
 */
public enum SubjectType {

    USER("user"),
    ROLE("role"),
    DEPT("dept");

    private final String code;

    SubjectType(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static boolean isValid(String code) {
        return code != null && Arrays.stream(values()).anyMatch(v -> v.code.equals(code));
    }

    /**
     * 由码值解析枚举。
     *
     * @param code 码值
     * @return 匹配的枚举；无匹配返回 {@code null}（由调用方决定报错口径）
     */
    public static SubjectType fromCode(String code) {
        if (code == null) {
            return null;
        }
        return Arrays.stream(values())
                .filter(v -> v.code.equals(code))
                .findFirst()
                .orElse(null);
    }
}

package com.mis.adminbff.dto.internal;

import java.util.Map;

/**
 * {@code GET /internal/identity/ask-context} 响应体。
 *
 * <p>{@code headers} 键名必须与问数 Worker {@code AskIdentity.from_headers} 对齐：
 * {@code X-Mis-Roles} / {@code X-Mis-Depts} / {@code X-Mis-Orgs} /
 * {@code X-Mis-Dept-Scope} / {@code X-Mis-Stores} / {@code X-Mis-Data-Scope}。
 * 值为已序列化的 JSON 字符串（与 BFF 注入 HTTP 头同构）。
 *
 * @param userId  查询主体
 * @param headers 非空身份头（可为空 Map，表示无角色/范围）
 */
public record InternalAskIdentityVO(Long userId, Map<String, String> headers) {
}

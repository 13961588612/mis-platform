package com.mis.adminbff.dto.internal;

import java.util.List;

/**
 * {@code GET /internal/permissions} 的响应体（外层再由 {@code Result} 包一层）。
 *
 * <p>字段名 {@code codes} 是<b>契约的一部分</b>，别改名：ai-platform 侧
 * {@code MisPermissionResolver._parse_codes} 按 {@code data.codes} /
 * {@code data.permissionCodes} 解析，认不出结构就会抛 {@code PermissionUnavailable}
 * 并 fail-closed 拒绝所有技能执行——正是本次修复的那个故障现象。
 *
 * <p>{@code codes} 用 {@link List} 而非 {@code Set}：JSON 数组是有序的，
 * 排序后输出可让响应可复现、便于 diff 与缓存比对。
 *
 * @param userId 查询主体的 MIS userId，原样回显供调用方核对
 * @param codes  该用户持有的权限码（已排序，原样保留大小写与点号）
 */
public record InternalPermissionsVO(Long userId, List<String> codes) {
}

package com.mis.taskflow.support;

import org.springframework.util.StringUtils;

import java.util.Locale;

/**
 * APP 归属（{@code app_code}）相关的 scope 常量与归一化工具（静态）。
 *
 * <p><b>背景</b>（见 docs/design/biz-category-unification-design.md §2.3）：
 * P0 的 {@code AppScopeResolver}（{@code @Service}，含绑定表兜底推导）已作废删除；
 * 不再「由业务类型推导 APP」。此处仅保留查询侧需要的 scope 常量与归一化逻辑
 * （{@code ALL}/{@code APP}/{@code PLATFORM}），改为无状态静态工具。
 *
 * <p><b>语义</b>：{@code app_code IS NULL} = 平台级；禁止用 {@code ''} / {@code '0'} / 数字 id 代替。
 * {@code scope} 过滤一律落在 {@code app_code} 列上（拆 3 条查询，避免 native null 参数类型推断缺陷）。
 */
public final class AppScope {

    /** scope：全量（默认，不加 app_code 条件）。 */
    public static final String SCOPE_ALL = "ALL";
    /** scope：应用级（{@code app_code = :appCode}）。 */
    public static final String SCOPE_APP = "APP";
    /** scope：平台级（{@code app_code IS NULL}）。 */
    public static final String SCOPE_PLATFORM = "PLATFORM";

    private AppScope() {
    }

    /**
     * scope 归一化：仅识别 {@code APP} / {@code PLATFORM}（大小写不敏感），
     * 其余（含 {@code null}/空白/{@code ALL}/非法值）一律归为 {@code ALL}（零回归）。
     */
    public static String normalizeScope(String scope) {
        String s = trimToNull(scope);
        if (s == null) {
            return SCOPE_ALL;
        }
        String upper = s.toUpperCase(Locale.ROOT);
        if (SCOPE_APP.equals(upper) || SCOPE_PLATFORM.equals(upper)) {
            return upper;
        }
        return SCOPE_ALL;
    }

    /** 空白归一为 {@code null}（{@code null} = 平台级）。 */
    public static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}

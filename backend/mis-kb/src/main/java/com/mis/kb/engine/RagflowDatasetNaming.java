package com.mis.kb.engine;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.regex.Pattern;

/**
 * RAGFlow dataset 命名规范（引擎删除策略 P0 / T02）。
 *
 * <p><b>为什么要有这套规范：</b>MIS 侧知识库名只在「同分类下」唯一，不同分类可以重名；
 * 而引擎侧 dataset 是平坦的一张列表。运维在 RAGFlow 控制台上看到三个都叫「制度」的
 * dataset，根本没法判断哪个对应哪个 MIS 库——对账、排障、误删全卡在这。故新建时按
 * 「一级分类 + 库名 + MIS 库 ID 后 6 位」拼名，让引擎侧名字自带可追溯信息。
 *
 * <pre>
 * 新建 dataset 名 = {一级分类名}-{库名}-{MIS库ID后6位}
 * 归档改名        = [已归档-yyyyMMdd]-{原dataset名}
 * </pre>
 *
 * <p><b>加工只在 adapter 层做，业务层不感知</b>：{@code KbLibraryService} 传的始终是
 * MIS 库名，拼接、清洗、截断全在这里闭环。MIS 侧 {@code kb_library.name}
 * <b>永远不会被这里的加工结果污染</b>。
 *
 * <p>纯静态工具，零依赖、零状态，便于单测。
 */
public final class RagflowDatasetNaming {

    /**
     * dataset 名长度上限。
     *
     * <p><b>取值依据（待联调回填）：</b>RAGFlow 官方文档未明确 dataset name 的硬上限，
     * 当前无可用联调环境实测。取 128 是因为 MIS 侧 {@code kb_library.name} 就是
     * {@code VARCHAR(128)}，用同一个数量级不会凭空制造「MIS 存得下、引擎存不下」的断层。
     * 联调环境可用后，请用 200 字符名试一次，以实测为准回填本常量。
     */
    public static final int MAX_DATASET_NAME = 128;

    /** 一级分类查不到时的占位名。 */
    public static final String UNCATEGORIZED = "未分类";

    /** 归档前缀模板的固定部分。 */
    private static final String ARCHIVE_PREFIX_HEAD = "[已归档-";
    private static final String ARCHIVE_PREFIX_TAIL = "]-";

    /** 归档日期格式：服务器本地日期（运维看引擎控制台时更直觉，与 UTC 口径的取舍已裁定）。 */
    private static final DateTimeFormatter ARCHIVE_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");

    /** 文件系统 / 引擎侧常见的非法字符，统一替换为 {@code -}。 */
    private static final Pattern ILLEGAL_CHARS = Pattern.compile("[/\\\\:*?\"<>|]");

    /** 已归档前缀识别式（用于幂等判定：对已归档名再归档不产生双前缀）。 */
    private static final Pattern ARCHIVED_PREFIX = Pattern.compile("^\\[已归档-\\d{8}]-");

    /** ID 后缀取多少位。 */
    private static final int ID_SUFFIX_LEN = 6;

    private RagflowDatasetNaming() {
        throw new AssertionError("工具类不允许实例化");
    }

    /**
     * 新建 dataset 名：{@code {一级分类名}-{库名}-{MIS库ID后6位}}。
     *
     * <p>超长时<b>只截库名段</b>——一级分类前缀与 ID 后 6 位是可追溯性的全部来源，
     * 截掉哪个都会让运维重新陷入「三个都叫制度」的困境。
     *
     * @param topCategoryName 一级分类名；{@code null}/空白回落 {@link #UNCATEGORIZED}
     * @param libraryName     MIS 知识库名；{@code null}/空白回落 {@code 未命名}
     * @param libraryId       MIS 知识库 ID（雪花 ID，取后 6 位）
     * @return 已清洗且不超过 {@link #MAX_DATASET_NAME} 的 dataset 名
     */
    public static String forCreate(String topCategoryName, String libraryName, long libraryId) {
        String category = sanitize(topCategoryName);
        if (category.isEmpty()) {
            category = UNCATEGORIZED;
        }
        String library = sanitize(libraryName);
        if (library.isEmpty()) {
            library = "未命名";
        }
        String idSuffix = idSuffix(libraryId);

        // 固定部分 = 分类名 + "-" + "-" + ID 后缀
        int fixedLen = category.length() + 1 + 1 + idSuffix.length();
        int libraryBudget = MAX_DATASET_NAME - fixedLen;
        if (libraryBudget < 1) {
            // 极端情况：分类名本身就把预算吃光了。此时退让一步——分类名也得截，
            // 但 ID 后缀必须保住（它是唯一能反查回 MIS 的锚点）。
            int categoryBudget = MAX_DATASET_NAME - (1 + 1 + idSuffix.length() + 1);
            if (categoryBudget < 1) {
                return idSuffix;
            }
            category = category.substring(0, Math.min(category.length(), categoryBudget));
            libraryBudget = 1;
        }
        if (library.length() > libraryBudget) {
            library = library.substring(0, libraryBudget);
        }
        return category + "-" + library + "-" + idSuffix;
    }

    /**
     * 归档改名：{@code [已归档-yyyyMMdd]-{原dataset名}}。
     *
     * <p><b>幂等</b>：{@code currentName} 已带归档前缀时原样返回，不叠加第二层前缀。
     * 归档是可能被重试的（第一次引擎超时、对账后人工重跑），双前缀会让名字越滚越长
     * 直到撞上长度上限。
     *
     * <p>超长时<b>只截原名段</b>，归档前缀不可截（截了就认不出这是归档库）。
     *
     * @param currentName 引擎侧当前 dataset 名
     * @param date        归档日期（服务器本地日期）；{@code null} 取今天
     * @return 带归档前缀且不超过 {@link #MAX_DATASET_NAME} 的名字
     */
    public static String forArchive(String currentName, LocalDate date) {
        String base = sanitize(currentName);
        if (base.isEmpty()) {
            base = "未命名";
        }
        if (ARCHIVED_PREFIX.matcher(base).find()) {
            // 已归档过，保持原名（幂等），但仍要保证不超长
            return truncate(base, MAX_DATASET_NAME);
        }
        LocalDate effective = date == null ? LocalDate.now() : date;
        String prefix = ARCHIVE_PREFIX_HEAD + effective.format(ARCHIVE_DATE) + ARCHIVE_PREFIX_TAIL;
        int budget = MAX_DATASET_NAME - prefix.length();
        if (budget < 1) {
            return truncate(prefix, MAX_DATASET_NAME);
        }
        return prefix + truncate(base, budget);
    }

    /**
     * 是否已是归档名（对账时用来判定「期望名 = 归档名」，避免把归档库误判成名称漂移）。
     *
     * @param name 引擎侧 dataset 名，允许 {@code null}
     * @return 带 {@code [已归档-yyyyMMdd]-} 前缀返回 {@code true}
     */
    public static boolean isArchivedName(String name) {
        return name != null && ARCHIVED_PREFIX.matcher(name.trim()).find();
    }

    /**
     * 字符清洗：非法字符替换为 {@code -}，压掉首尾空白与控制字符。
     *
     * @param raw 原始字符串，允许 {@code null}
     * @return 清洗后的字符串，恒非 {@code null}（{@code null} 入参返回空串）
     */
    public static String sanitize(String raw) {
        if (raw == null) {
            return "";
        }
        String cleaned = ILLEGAL_CHARS.matcher(raw).replaceAll("-");
        // 控制字符（含换行/制表）同样替换，避免引擎侧名字里出现不可见字符
        cleaned = cleaned.replaceAll("[\\p{Cntrl}]", "-");
        return cleaned.trim();
    }

    /**
     * MIS 库 ID 的后 6 位（不足 6 位左补 0，保证长度稳定便于肉眼比对）。
     *
     * @param libraryId MIS 知识库 ID
     * @return 定长 6 位字符串
     */
    public static String idSuffix(long libraryId) {
        String digits = Long.toString(Math.abs(libraryId));
        if (digits.length() <= ID_SUFFIX_LEN) {
            return String.format("%0" + ID_SUFFIX_LEN + "d", Math.abs(libraryId));
        }
        return digits.substring(digits.length() - ID_SUFFIX_LEN);
    }

    /**
     * 安全截断（按 char 计，不做 code point 拆分保护——RAGFlow 侧按字符计长）。
     *
     * @param value 待截断字符串
     * @param max   上限
     * @return 长度不超过 {@code max} 的字符串
     */
    private static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        if (max <= 0) {
            return "";
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}

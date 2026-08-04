package com.mis.kb.domain.service;

import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.SynonymImportPlan;
import com.mis.kb.domain.model.SynonymImportPlanRow;
import com.mis.kb.domain.model.SynonymParsedGroup;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 同义词词表 JSON 编解码（Wave D · T08，WD-04 / WD-14）。
 *
 * <p><b>与 {@link SynonymCsvCodec} 是一对孪生实现</b>：两者都必须产出
 * {@link SynonymParsedGroup}，格式差异<b>到解析出口为止</b>。AC-09 要求
 * 「同一术语组分别用 CSV 与 JSON 导入干净环境，{@code kb_synonym_term} 内容完全一致」，
 * 唯一能保证这一点的办法就是让两条路径在这里合流、之后一行代码都不分叉。
 *
 * <p><b>三条格式硬规定（PRD §4.4.3）：</b>
 * <ol>
 *   <li><b>顶层必须是对象 {@code {version, groups}}，不接受裸数组。</b>
 *       这不是洁癖：裸数组一旦被接受，将来要加 {@code version} 之外的任何顶层元信息
 *       （比如导出时间、来源租户）都会变成破坏性变更。现在拒绝一次，比将来兼容两种
 *       顶层结构便宜得多。报错文案必须<b>明说</b>该怎么改，否则用户只会看到「格式非法」
 *       四个字然后来提工单；</li>
 *   <li>{@code version} <b>缺失视为 1</b>——手写的小文件不该因为少一个字段就被拒；</li>
 *   <li>{@code status} 取 {@code enabled} / {@code disabled} 文本，缺省 {@code enabled}，
 *       口径与 CSV 完全一致（复用 {@link SynonymParsedGroup#parseStatus}）。</li>
 * </ol>
 *
 * <p><b>为什么解析用 {@code readTree} 而不是直接绑定 POJO：</b>需要区分
 * 「{@code groups} 不存在」「{@code groups} 是 null」「{@code groups} 不是数组」三种情况
 * 并给出各自的提示文案。POJO 绑定会把这三种情况都变成一个 {@code null} 字段，
 * 剩下的只能报一句无信息量的通用错误。
 */
@Component
public class SynonymJsonCodec {

    /** 顶层版本字段。 */
    static final String FIELD_VERSION = "version";
    /** 顶层术语组数组字段。 */
    static final String FIELD_GROUPS = "groups";
    /** 组内规范词字段（驼峰）。 */
    static final String FIELD_CANONICAL_TERM = "canonicalTerm";
    /** 组内规范词字段（下划线，容错 CSV 列名直接复制过来的情形）。 */
    static final String FIELD_CANONICAL_TERM_SNAKE = "canonical_term";
    /** 组内别名数组字段。 */
    static final String FIELD_TERMS = "terms";
    /** 组内别名数组字段的别称（容错）。 */
    static final String FIELD_ALIASES = "aliases";
    /** 组内备注字段。 */
    static final String FIELD_REMARK = "remark";
    /** 组内状态字段。 */
    static final String FIELD_STATUS = "status";
    /** 回吐未导入行时追加的跳过原因字段。 */
    static final String FIELD_SKIP_REASON = "skipReason";

    /** 别名列内分隔符（容错：{@code terms} 被写成一个竖线分隔的字符串时）。 */
    private static final String ALIAS_SEPARATOR_REGEX = "\\|";

    /**
     * 解析/写出共用的 mapper。
     *
     * <p>不共用 {@code KbJson}：那份 mapper 的既定行为是<b>吞掉所有异常返回 null</b>
     * （给可降级的配置 JSON 用的），而导入文件的语法错误<b>必须</b>抛到用户面前
     * ——静默吞掉等于「上传了一个错文件，系统告诉你导入了 0 组」。
     */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 固定缩进的美化输出器。
     *
     * <p>用显式 {@code "\n"} 而不是 {@link DefaultIndenter#SYSTEM_LINEFEED_INSTANCE}：
     * 后者取系统换行符，会让同一份词表在 Windows 与 Linux 上导出成不同字节，
     * 单测里的逐字断言随之在 CI 上失败。
     */
    private static final DefaultPrettyPrinter PRETTY_PRINTER = createPrettyPrinter();

    // ------------------------------------------------------------------ 解析

    /**
     * 解析 JSON 字节为术语组列表。
     *
     * <p>行号取 {@code groups} 数组下标 + 1（与 CSV 的物理行号语义对齐：
     * 「第 N 个术语组」）。JSON 没有稳定的物理行概念——同一份内容压成一行与展开成
     * 多行是等价的，用物理行号反而会让报告里的数字随格式化方式漂移。
     *
     * @param bytes 文件字节
     * @return 解析出的术语组，顺序与文件一致；恒非 {@code null}
     * @throws KbBusinessException 编码不可识别 / 语法错误 / 顶层非对象 / 缺 groups 时抛 40928
     */
    public List<SynonymParsedGroup> parse(byte[] bytes) {
        String text = SynonymCsvCodec.decodeUtf8(bytes);
        if (text.isBlank()) {
            throw formatError("文件格式不合法：JSON 文件为空。请下载模板对照修改后重新上传。");
        }

        JsonNode root;
        try {
            root = MAPPER.readTree(text);
        } catch (Exception e) {
            throw formatError("文件格式不合法：JSON 语法错误，无法解析。请用编辑器校验后重新上传。");
        }
        if (root == null || root.isNull()) {
            throw formatError("文件格式不合法：JSON 内容为空。请下载模板对照修改后重新上传。");
        }
        if (root.isArray()) {
            throw formatError("文件格式不合法：顶层必须是对象 {\"version\":1,\"groups\":[…]}，"
                    + "不接受裸数组。请把现有数组包一层 groups 后重新上传。");
        }
        if (!root.isObject()) {
            throw formatError("文件格式不合法：顶层必须是对象 {\"version\":1,\"groups\":[…]}。"
                    + "请下载模板对照修改后重新上传。");
        }

        JsonNode groupsNode = root.get(FIELD_GROUPS);
        if (groupsNode == null || groupsNode.isNull()) {
            throw formatError("文件格式不合法：缺少 groups 数组。请下载模板对照修改后重新上传。");
        }
        if (!groupsNode.isArray()) {
            throw formatError("文件格式不合法：groups 必须是数组。请下载模板对照修改后重新上传。");
        }

        List<SynonymParsedGroup> groups = new ArrayList<>(groupsNode.size());
        for (int i = 0; i < groupsNode.size(); i++) {
            JsonNode item = groupsNode.get(i);
            int lineNo = i + 1;
            if (item == null || item.isNull()) {
                // 数组里的 null 元素等价于「没写」，跳过即可，不必为此拒绝整批。
                continue;
            }
            if (!item.isObject()) {
                // 元素不是对象属于结构性错误：无从判断它想表达什么，逐行跳过会掩盖问题。
                throw formatError("文件格式不合法：groups 第 " + lineNo
                        + " 个元素不是对象。请下载模板对照修改后重新上传。");
            }
            groups.add(toParsedGroup(item, lineNo));
        }
        return groups;
    }

    // ------------------------------------------------------------------ 写出

    /**
     * 写出词表（导出，WD-14）。
     *
     * @param groups 术语组
     * @return JSON 全文（缩进 2 空格，LF 换行，<b>不带 BOM</b>）
     */
    public String writeGroups(List<SynonymParsedGroup> groups) {
        ArrayNode array = MAPPER.createArrayNode();
        if (groups != null) {
            for (SynonymParsedGroup group : groups) {
                array.add(toNode(
                        group.canonicalTerm(), group.aliases(), group.remark(), group.status(), null));
            }
        }
        return writeRoot(array);
    }

    /**
     * 写出未导入行（阶段三，PRD §4.4.4 第 3 条前置条件）。
     *
     * <p>在标准字段后<b>追加 {@code skipReason}</b>。多出来的字段会被 {@link #parse}
     * 当作未知字段忽略，因此管理员改完这个小文件可以直接再传一次形成闭环。
     *
     * @param rows 计划中的跳过行
     * @return JSON 全文
     */
    public String writeRejected(List<SynonymImportPlanRow> rows) {
        ArrayNode array = MAPPER.createArrayNode();
        if (rows != null) {
            for (SynonymImportPlanRow row : rows) {
                array.add(toNode(
                        row.canonicalTerm(), row.aliases(), row.remark(), row.status(), row.skipReason()));
            }
        }
        return writeRoot(array);
    }

    // ------------------------------------------------------------------ 内部

    /**
     * 把 {@code groups} 数组套上顶层对象并序列化。
     *
     * @param groups 组数组
     * @return JSON 全文
     */
    private String writeRoot(ArrayNode groups) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put(FIELD_VERSION, SynonymImportPlan.CURRENT_VERSION);
        root.set(FIELD_GROUPS, groups);
        try {
            return MAPPER.writer(PRETTY_PRINTER).writeValueAsString(root);
        } catch (Exception e) {
            // ObjectNode 全是标量与数组，序列化不可能失败；真失败了说明 Jackson 环境异常，
            // 直接抛业务错比返回半截文件安全。
            throw formatError("导出失败：JSON 序列化异常。");
        }
    }

    /**
     * 构造一个术语组节点。
     *
     * <p>{@code remark} / {@code skipReason} 为空时<b>整个字段不输出</b>，
     * 而不是输出 {@code null}：导出文件同时充当导入模板，一份满屏 {@code "remark": null}
     * 的模板会让管理员以为这个字段是必填的。
     *
     * @param canonicalTerm 规范词
     * @param aliases       别名
     * @param remark        备注
     * @param status        状态码
     * @param skipReason    跳过原因；{@code null} 表示不输出该字段
     * @return 节点
     */
    private ObjectNode toNode(
            String canonicalTerm, List<String> aliases, String remark, Integer status, String skipReason) {
        ObjectNode node = MAPPER.createObjectNode();
        node.put(FIELD_CANONICAL_TERM, canonicalTerm == null ? "" : canonicalTerm);
        ArrayNode terms = node.putArray(FIELD_TERMS);
        if (aliases != null) {
            for (String alias : aliases) {
                if (alias != null && !alias.isBlank()) {
                    terms.add(alias);
                }
            }
        }
        if (remark != null && !remark.isBlank()) {
            node.put(FIELD_REMARK, remark);
        }
        node.put(FIELD_STATUS, SynonymParsedGroup.statusText(status));
        if (skipReason != null && !skipReason.isBlank()) {
            node.put(FIELD_SKIP_REASON, skipReason);
        }
        return node;
    }

    /**
     * 单个组节点 → 解析产物。
     *
     * @param node   组节点（已确认是对象）
     * @param lineNo 行号（数组下标 + 1）
     * @return 解析产物
     */
    private SynonymParsedGroup toParsedGroup(JsonNode node, int lineNo) {
        String canonical = readText(node, FIELD_CANONICAL_TERM, FIELD_CANONICAL_TERM_SNAKE);
        String remark = readText(node, FIELD_REMARK, null);
        String statusText = readText(node, FIELD_STATUS, null);
        List<String> aliases = readAliases(node);
        return new SynonymParsedGroup(
                lineNo, canonical, aliases, remark, SynonymParsedGroup.parseStatus(statusText));
    }

    /**
     * 读一个文本字段，支持一个备用字段名。
     *
     * @param node      组节点
     * @param field     主字段名
     * @param fallback  备用字段名；无则传 {@code null}
     * @return 已 trim 的文本；缺失/空白返回 {@code null}
     */
    private static String readText(JsonNode node, String field, String fallback) {
        JsonNode value = node.get(field);
        if ((value == null || value.isNull()) && fallback != null) {
            value = node.get(fallback);
        }
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.isValueNode() ? value.asText() : value.toString();
        String trimmed = text.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * 读别名列表。
     *
     * <p>三种形态都认：标准的字符串数组、竖线分隔的单字符串（从 CSV 复制过来的常见形态）、
     * 字段缺失。<b>刻意不为「形态不对」报格式错</b>——别名是选填项，
     * 为一个选填字段的写法把整批 2000 组拒掉不成比例；真丢了别名，
     * 预检报告里那行的别名数为 0，管理员看得见。
     *
     * @param node 组节点
     * @return 别名列表（已去空白、去空项）
     */
    private static List<String> readAliases(JsonNode node) {
        JsonNode value = node.get(FIELD_TERMS);
        if (value == null || value.isNull()) {
            value = node.get(FIELD_ALIASES);
        }
        if (value == null || value.isNull()) {
            return List.of();
        }
        List<String> aliases = new ArrayList<>();
        if (value.isArray()) {
            for (JsonNode item : value) {
                if (item == null || item.isNull() || !item.isValueNode()) {
                    continue;
                }
                addAlias(aliases, item.asText());
            }
            return aliases;
        }
        if (value.isValueNode()) {
            for (String part : value.asText().split(ALIAS_SEPARATOR_REGEX, -1)) {
                addAlias(aliases, part);
            }
        }
        return aliases;
    }

    /**
     * 追加一个别名（去空白、丢空项）。
     *
     * @param target 目标列表
     * @param raw    别名原文
     */
    private static void addAlias(List<String> target, String raw) {
        if (raw == null) {
            return;
        }
        String trimmed = raw.trim();
        if (!trimmed.isEmpty()) {
            target.add(trimmed);
        }
    }

    /**
     * 构造格式级错误。
     *
     * @param message 面向管理员的提示（必须说清怎么改）
     * @return 业务异常（40928）
     */
    private static KbBusinessException formatError(String message) {
        return new KbBusinessException(KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID, message);
    }

    /**
     * 创建换行符固定为 LF 的美化输出器。
     *
     * @return 输出器
     */
    private static DefaultPrettyPrinter createPrettyPrinter() {
        DefaultIndenter indenter = new DefaultIndenter("  ", "\n");
        DefaultPrettyPrinter printer = new DefaultPrettyPrinter();
        printer.indentObjectsWith(indenter);
        printer.indentArraysWith(indenter);
        return printer;
    }
}

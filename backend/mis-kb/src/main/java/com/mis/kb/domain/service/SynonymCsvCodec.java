package com.mis.kb.domain.service;

import com.mis.kb.domain.model.SynonymImportPlanRow;
import com.mis.kb.domain.model.SynonymParsedGroup;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.support.KbBusinessException;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 同义词词表 CSV 编解码（Wave D · T08，WD-04 / WD-14）。
 *
 * <p><b>为什么手写而不引 commons-csv / opencsv：</b>与 {@code KbExportService} 同一个判断——
 * RFC 4180 是一份能在一页纸内写完的规范，为它引一个三方库（连带版本管理与 CVE 面）不划算。
 * 手写的全部风险集中在两个函数（{@link #parseRecords} 与 {@link #escape}），且都有单测钉死。
 *
 * <p><b>四个「别人踩过的坑」在这里都处理了：</b>
 * <ol>
 *   <li><b>BOM</b>：读取时<b>兼容有无</b>（Excel 另存为 CSV 会带，文本编辑器一般不带），
 *       写出时<b>一律带</b>——不带 BOM 的 UTF-8 中文在 Excel 里默认按 GBK 解析，全是乱码；</li>
 *   <li><b>别名分隔符是半角竖线 {@code |} 而不是逗号</b>（PRD §4.4.2）：CSV 的字段分隔符本身
 *       就是逗号，别名再用逗号就必须整列加引号，而管理员是从 Excel 另存为的，
 *       Excel 不会替他做这件事，结果是一整列别名被撕成一堆空列；</li>
 *   <li><b>公式注入</b>：以 {@code = + - @} 开头的单元格前置单引号
 *       （口径逐字照抄 {@code KbExportService}）。为保证 AC-09 的「导出→导入往返内容不变」，
 *       {@link #stripFormulaGuard} 在解析时做了对称的还原；</li>
 *   <li><b>表头</b>：列名大小写不敏感、顺序不限、下划线可省
 *       （{@code canonical_term} 与 {@code canonicalTerm} 都认）。理由是 JSON 侧用的是驼峰，
 *       管理员在两种模板间来回复制列名是必然会发生的事，为此报一个「缺少必需列」太苛刻。</li>
 * </ol>
 */
@Component
public class SynonymCsvCodec {

    /** UTF-8 BOM，解决 Excel 打开中文乱码。 */
    static final String UTF8_BOM = "\uFEFF";

    /** 规范词列（必需）。 */
    static final String COL_CANONICAL_TERM = "canonicalterm";
    /** 别名列（可选）。 */
    static final String COL_TERMS = "terms";
    /** 备注列（可选）。 */
    static final String COL_REMARK = "remark";
    /** 状态列（可选）。 */
    static final String COL_STATUS = "status";
    /** 跳过原因列（仅回吐未导入行时输出）。 */
    static final String COL_SKIP_REASON = "skipreason";

    /** 导出/回吐时的表头原文（下划线形式，与 PRD §4.4.2 模板一致）。 */
    private static final String[] EXPORT_HEADERS = {"canonical_term", "terms", "remark", "status"};

    /** 别名列内部的分隔符。 */
    private static final char ALIAS_SEPARATOR = '|';

    /** 行分隔符：CRLF，Excel 与记事本都认。 */
    private static final String LINE_BREAK = "\r\n";

    // ------------------------------------------------------------------ 解析

    /**
     * 解析 CSV 字节为术语组列表。
     *
     * @param bytes 文件字节（可带可不带 BOM）
     * @return 解析出的术语组，顺序与文件一致；恒非 {@code null}
     * @throws KbBusinessException 编码不可识别、无表头、缺 {@code canonical_term} 列时抛 40928
     */
    public List<SynonymParsedGroup> parse(byte[] bytes) {
        String text = decodeUtf8(bytes);
        List<CsvRecord> records = parseRecords(text);
        if (records.isEmpty()) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID,
                    "文件格式不合法：CSV 文件为空，首行必须是表头。请下载模板对照修改后重新上传。");
        }

        Map<String, Integer> header = parseHeader(records.get(0));
        Integer canonicalIdx = header.get(COL_CANONICAL_TERM);
        if (canonicalIdx == null) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID,
                    "文件格式不合法：缺少必需列 canonical_term。请下载模板对照修改后重新上传。");
        }
        Integer termsIdx = header.get(COL_TERMS);
        Integer remarkIdx = header.get(COL_REMARK);
        Integer statusIdx = header.get(COL_STATUS);

        List<SynonymParsedGroup> groups = new ArrayList<>(records.size());
        for (int i = 1; i < records.size(); i++) {
            CsvRecord record = records.get(i);
            if (record.isBlank()) {
                // 尾部空行、Excel 另存为习惯性多出的一行：静默忽略，不占行号预算，
                // 更不能当成「canonical_term 为空」的错误行报给管理员。
                continue;
            }
            String canonical = stripFormulaGuard(record.cell(canonicalIdx));
            String remark = stripFormulaGuard(record.cell(remarkIdx));
            int status = SynonymParsedGroup.parseStatus(record.cell(statusIdx));
            List<String> aliases = splitAliases(record.cell(termsIdx));
            groups.add(new SynonymParsedGroup(record.lineNo(), canonical, aliases, remark, status));
        }
        return groups;
    }

    // ------------------------------------------------------------------ 写出

    /**
     * 写出词表（导出，WD-14）。
     *
     * @param groups 术语组
     * @return CSV 全文（带 BOM，CRLF 换行）
     */
    public String writeGroups(List<SynonymParsedGroup> groups) {
        StringBuilder sb = new StringBuilder(UTF8_BOM);
        appendRow(sb, EXPORT_HEADERS);
        if (groups != null) {
            for (SynonymParsedGroup group : groups) {
                appendRow(sb, new String[]{
                        group.canonicalTerm(),
                        String.join(String.valueOf(ALIAS_SEPARATOR), group.aliases()),
                        group.remark(),
                        SynonymParsedGroup.statusText(group.status())
                });
            }
        }
        return sb.toString();
    }

    /**
     * 写出未导入行（阶段三，PRD §4.4.4 第 3 条前置条件）。
     *
     * <p>在标准四列后<b>追加一列 {@code skip_reason}</b>。管理员改完这个小文件可以
     * 直接再传一次形成闭环——多出来的 {@code skip_reason} 列会被 {@link #parse} 当作
     * 未知列忽略，不会因此报「格式不合法」。这一点是「跳过而非整批回滚」这个产品决策
     * 能够成立的关键，改动 {@link #parseHeader} 的忽略策略前请先回来读这段。
     *
     * @param rows 计划中的跳过行
     * @return CSV 全文（带 BOM）
     */
    public String writeRejected(List<SynonymImportPlanRow> rows) {
        StringBuilder sb = new StringBuilder(UTF8_BOM);
        appendRow(sb, new String[]{
                EXPORT_HEADERS[0], EXPORT_HEADERS[1], EXPORT_HEADERS[2], EXPORT_HEADERS[3], "skip_reason"});
        if (rows != null) {
            for (SynonymImportPlanRow row : rows) {
                appendRow(sb, new String[]{
                        row.canonicalTerm(),
                        String.join(String.valueOf(ALIAS_SEPARATOR), row.aliases()),
                        row.remark(),
                        SynonymParsedGroup.statusText(row.status()),
                        row.skipReason()
                });
            }
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------ 内部：解码

    /**
     * 严格 UTF-8 解码并去掉 BOM。
     *
     * <p>用 {@link CodingErrorAction#REPORT} 而不是默认的 REPLACE：默认策略会把非法字节
     * 换成「�」并<b>照常返回</b>，于是一个 GBK 文件能一路解析到底，最后往库里写进一堆
     * 乱码术语——那才是真正的灾难。宁可在这里明确拒绝，让管理员另存为 UTF-8。
     *
     * @param bytes 文件字节
     * @return 文本
     * @throws KbBusinessException 非法 UTF-8 序列时抛 40928
     */
    static String decodeUtf8(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        String text;
        try {
            CharBuffer decoded = decoder.decode(ByteBuffer.wrap(bytes));
            text = decoded.toString();
        } catch (CharacterCodingException e) {
            throw new KbBusinessException(
                    KbResultCode.KB_SYNONYM_IMPORT_FORMAT_INVALID,
                    "文件格式不合法：编码无法识别，请另存为 UTF-8 后重新上传。");
        }
        return text.startsWith(UTF8_BOM) ? text.substring(1) : text;
    }

    // ------------------------------------------------------------------ 内部：CSV 语法

    /**
     * RFC 4180 记录切分。
     *
     * <p>支持：双引号包裹、引号内含逗号/换行、双写引号转义、CRLF 与 LF 混用。
     * 行号取<b>记录起始的物理行</b>——引号内的换行会推进物理行号，但不新起一条记录，
     * 这样「第 27 行」指的就是管理员在 Excel 里看到的那一行。
     *
     * @param text 已去 BOM 的全文
     * @return 记录列表
     */
    static List<CsvRecord> parseRecords(String text) {
        List<CsvRecord> records = new ArrayList<>();
        List<String> fields = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean inQuotes = false;
        int physicalLine = 1;
        int recordStartLine = 1;

        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    if (c == '\n') {
                        physicalLine++;
                    }
                    cell.append(c);
                }
                continue;
            }
            switch (c) {
                case '"' -> inQuotes = true;
                case ',' -> {
                    fields.add(cell.toString());
                    cell.setLength(0);
                }
                case '\r' -> {
                    // CRLF 的 CR 由后续 LF 统一处理；孤立 CR 视作普通空白丢弃
                }
                case '\n' -> {
                    fields.add(cell.toString());
                    cell.setLength(0);
                    records.add(new CsvRecord(recordStartLine, List.copyOf(fields)));
                    fields.clear();
                    physicalLine++;
                    recordStartLine = physicalLine;
                }
                default -> cell.append(c);
            }
        }
        if (!cell.isEmpty() || !fields.isEmpty()) {
            fields.add(cell.toString());
            records.add(new CsvRecord(recordStartLine, List.copyOf(fields)));
        }
        return records;
    }

    /**
     * 解析表头为「归一化列名 → 列下标」。
     *
     * <p>归一化 = 去空白 + 去下划线/连字符 + 转小写，因此 {@code canonical_term}、
     * {@code Canonical Term}、{@code canonicalTerm} 都能对上。
     * <b>未知列一律忽略</b>（见 {@link #writeRejected} 的说明，这是导入闭环的必要条件）。
     *
     * @param header 表头记录
     * @return 列名映射
     */
    private static Map<String, Integer> parseHeader(CsvRecord header) {
        Map<String, Integer> index = new HashMap<>();
        List<String> cells = header.cells();
        for (int i = 0; i < cells.size(); i++) {
            String name = normalizeHeader(cells.get(i));
            if (!name.isEmpty()) {
                index.putIfAbsent(name, i);
            }
        }
        return index;
    }

    /**
     * 列名归一化。
     *
     * @param raw 原始列名
     * @return 归一化列名
     */
    private static String normalizeHeader(String raw) {
        if (raw == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == '_' || c == '-' || Character.isWhitespace(c) || c == '\uFEFF') {
                continue;
            }
            sb.append(Character.toLowerCase(c));
        }
        return sb.toString().toLowerCase(Locale.ROOT);
    }

    /**
     * 拆分别名列。
     *
     * @param raw {@code terms} 单元格原文
     * @return 别名列表（已 trim、已去空项、已还原公式防护前缀）
     */
    private static List<String> splitAliases(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        List<String> aliases = new ArrayList<>();
        for (String part : raw.split("\\|", -1)) {
            String alias = stripFormulaGuard(part);
            if (alias != null && !alias.isBlank()) {
                aliases.add(alias.trim());
            }
        }
        return aliases;
    }

    /**
     * 还原写出时加的公式注入防护前缀。
     *
     * <p>只在「单引号后紧跟 {@code = + - @}」时剥离，这是 {@link #escape} 的精确逆运算。
     * 不做无条件剥离——用户术语里第一个字符本来就是单引号的情况虽罕见，但一旦发生，
     * 无条件剥离会静默改掉他的数据。
     *
     * @param raw 单元格原文
     * @return 还原后的文本；{@code null} 原样返回
     */
    static String stripFormulaGuard(String raw) {
        if (raw == null) {
            return null;
        }
        String text = raw.trim();
        if (text.length() >= 2 && text.charAt(0) == '\'' && isFormulaLead(text.charAt(1))) {
            return text.substring(1);
        }
        return text;
    }

    /**
     * 是否为会被 Excel 当作公式起始的字符。
     *
     * @param c 字符
     * @return 命中 {@code = + - @} 返回 {@code true}
     */
    private static boolean isFormulaLead(char c) {
        return c == '=' || c == '+' || c == '-' || c == '@';
    }

    // ------------------------------------------------------------------ 内部：写出

    /**
     * 追加一行。
     *
     * @param sb    目标缓冲
     * @param cells 单元格内容
     */
    private static void appendRow(StringBuilder sb, String[] cells) {
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(escape(cells[i]));
        }
        sb.append(LINE_BREAK);
    }

    /**
     * 单元格转义（RFC 4180）+ 公式注入防护。
     *
     * <p>与 {@code KbExportService.escape} 的差别只有一处：这里<b>按需加引号</b>而不是
     * 无条件加。理由是导出文件同时充当「导入模板」，一份满屏引号的模板会让管理员
     * 误以为引号是必须的，进而在自己整理的文件里到处加引号、加错位置。
     *
     * @param raw 原始文本
     * @return 可直接拼进 CSV 的文本
     */
    static String escape(String raw) {
        if (raw == null || raw.isEmpty()) {
            return "";
        }
        String text = raw;
        if (isFormulaLead(text.charAt(0))) {
            text = "'" + text;
        }
        boolean needQuote = text.indexOf(',') >= 0
                || text.indexOf('"') >= 0
                || text.indexOf('\n') >= 0
                || text.indexOf('\r') >= 0;
        if (!needQuote) {
            return text;
        }
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }

    // ------------------------------------------------------------------ 内部类型

    /**
     * 一条 CSV 记录。
     *
     * @param lineNo 记录起始的物理行号（1 起）
     * @param cells  单元格内容
     */
    record CsvRecord(int lineNo, List<String> cells) {

        /**
         * 取指定下标的单元格。
         *
         * @param index 列下标；{@code null} 或越界返回 {@code null}
         * @return 单元格原文
         */
        String cell(Integer index) {
            if (index == null || index < 0 || index >= cells.size()) {
                return null;
            }
            return cells.get(index);
        }

        /**
         * 整条记录是否全为空白。
         *
         * @return 全空返回 {@code true}
         */
        boolean isBlank() {
            for (String cell : cells) {
                if (cell != null && !cell.isBlank()) {
                    return false;
                }
            }
            return true;
        }
    }
}

package com.mis.adminbff.service;

import com.mis.adminbff.dto.kb.KbQaExportRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

/**
 * 运营记录 CSV 导出（A-02e）。
 *
 * <p><b>为什么手拼 CSV 而不引 POI：</b>需求只要「运营记录 CSV 导出」，
 * 为一个纯文本格式引入 poi/poi-ooxml（连带 ~15MB 依赖与一堆 CVE 面）不划算。
 * 手写的代价只是一个转义函数，而这个函数是有明确规范（RFC 4180）的，不存在自研风险。
 *
 * <p><b>两个容易踩的坑，这里都处理了：</b>
 * <ol>
 *   <li><b>Excel 中文乱码</b>：输出带 UTF-8 BOM，否则 Excel 默认按 GBK 解析，中文全花；</li>
 *   <li><b>CSV 公式注入</b>：以 {@code = + - @} 开头的单元格前置单引号，
 *       否则运营打开导出文件时，一条精心构造的提问就能在他机器上执行公式。</li>
 * </ol>
 *
 * <p><b>脱敏口径：</b>{@code userId} 默认输出 SHA-256 前 12 位十六进制，
 * 同一用户在同一批导出中哈希一致（可做同人聚合），但无法反查真实 id。
 */
@Service
public class KbExportService {

    private static final Logger log = LoggerFactory.getLogger(KbExportService.class);

    /** UTF-8 BOM，解决 Excel 打开中文乱码。 */
    private static final String UTF8_BOM = "\uFEFF";

    /** 脱敏哈希保留的十六进制位数。 */
    private static final int HASH_HEX_LEN = 12;

    /** 表头。 */
    private static final String[] HEADERS = {
            "会话ID", "用户", "时间", "提问", "回答摘要",
            "命中知识库", "引用数", "准确性", "有用性", "工单状态", "备注"
    };

    /**
     * 生成 CSV 文本。
     *
     * @param rows         导出行
     * @param desensitize  是否脱敏 userId；{@code true} 输出哈希，{@code false} 输出明文
     * @return CSV 全文（含 BOM 与表头）
     */
    public String toCsv(List<KbQaExportRow> rows, boolean desensitize) {
        StringBuilder sb = new StringBuilder(UTF8_BOM);
        for (int i = 0; i < HEADERS.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(escape(HEADERS[i]));
        }
        sb.append("\r\n");

        if (rows == null || rows.isEmpty()) {
            return sb.toString();
        }
        for (KbQaExportRow row : rows) {
            Object[] cells = {
                    row.sessionId(),
                    desensitize ? hash(row.userId()) : str(row.userId()),
                    row.createdAt(),
                    row.question(),
                    row.answerBrief(),
                    row.libraryIds(),
                    row.citeCount(),
                    row.accuracy(),
                    row.helpful(),
                    row.ticketStatus(),
                    row.note()
            };
            for (int i = 0; i < cells.length; i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(escape(str(cells[i])));
            }
            sb.append("\r\n");
        }
        log.info("生成运营导出 CSV rows={} desensitize={}", rows.size(), desensitize);
        return sb.toString();
    }

    /**
     * 生成下载文件名。
     *
     * @param prefix 文件名前缀
     * @return 形如 {@code kb-qa-export-1785542400000.csv}
     */
    public String buildFilename(String prefix) {
        String safe = prefix == null || prefix.isBlank() ? "kb-qa-export" : prefix.trim();
        return safe + "-" + System.currentTimeMillis() + ".csv";
    }

    // ---------------------------------------------------------------- 内部

    private static String str(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    /**
     * CSV 单元格转义（RFC 4180）+ 公式注入防护。
     *
     * @param raw 原始文本
     * @return 已转义、可直接拼进 CSV 的文本
     */
    private static String escape(String raw) {
        if (raw == null || raw.isEmpty()) {
            return "";
        }
        String text = raw.replace("\r\n", " ").replace('\n', ' ').replace('\r', ' ');
        char head = text.charAt(0);
        if (head == '=' || head == '+' || head == '-' || head == '@') {
            // 前置单引号让 Excel 按文本处理，阻断公式注入
            text = "'" + text;
        }
        if (text.indexOf('"') >= 0) {
            text = text.replace("\"", "\"\"");
        }
        return "\"" + text + "\"";
    }

    /**
     * userId 脱敏哈希。
     *
     * @param userId 用户 id；{@code null} 返回空串
     * @return SHA-256 前 {@value #HASH_HEX_LEN} 位十六进制
     */
    private static String hash(Long userId) {
        if (userId == null) {
            return "";
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(String.valueOf(userId).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) {
                hex.append(String.format("%02x", b));
                if (hex.length() >= HASH_HEX_LEN) {
                    break;
                }
            }
            return "u_" + hex.substring(0, HASH_HEX_LEN);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 是 JDK 必备算法，走到这里说明运行环境被裁剪过；宁可不导出也不泄露明文
            log.error("SHA-256 不可用，userId 以占位符输出", e);
            return "u_unavailable";
        }
    }
}

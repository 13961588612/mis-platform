package com.mis.recon.custom.example;

import com.mis.recon.custom.CustomFetcher;
import com.mis.recon.custom.FetchContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 内置示例：目录 CSV 账单文件拉取（strategy 取数层 fetch_type=custom，CustomFetcher 参考实现）。
 *
 * <h3>适用场景</h3>
 * 对账源是「按日落地的 CSV 账单文件」（如银行/支付渠道每日导出到共享目录或 SFTP 挂载点），
 * 无法用 db（无连接）或 api（非 HTTP 通道）拉取。本示例演示最简落地形态：
 * 扫描目录、按<b>文件名内嵌日期</b>圈定窗口、解析 CSV 输出行集。
 * 真实业务可在此基础上扩展：换成 SFTP/JSch、S3、加密文件（PGP）、表头映射等
 * （实现类可注入 DataSource / RestTemplate 等 Spring 依赖）。
 *
 * <h3>参数（fetch_config_json.config_json 键值原样传入，取数层需求规格 §4.4）</h3>
 * <ul>
 *   <li>{@code dir}（必填，String）：账单文件所在目录（本地路径；SFTP 场景换成远程通道）</li>
 *   <li>{@code file_prefix}（可选，String）：文件名前缀，默认 {@code "bill_"}；空串表示不限定前缀</li>
 *   <li>{@code file_suffix}（可选，String）：文件名后缀，默认 {@code ".csv"}</li>
 *   <li>{@code window_format}（可选，String）：文件名内嵌日期格式（{@link DateTimeFormatter}），
 *       默认 {@code "yyyyMMdd"}（例：bill_20260826.csv）</li>
 *   <li>{@code time_field}（可选，String）：行内业务日期字段名，默认 {@code "biz_date"}；
 *       该字段会从窗口格式文本解析为 {@link java.sql.Timestamp}（当天 00:00），与 db 拉取口径一致</li>
 *   <li>{@code charset}（可选，String）：文件编码，默认 {@code "utf-8"}</li>
 *   <li>{@code delimiter}（可选，String）：CSV 分隔符，默认 {@code ","}</li>
 * </ul>
 *
 * <h3>示例配置（fetch_config_json）</h3>
 * <pre>{@code
 * {
 *   "class": "com.mis.recon.custom.example.CsvDirFetcher",
 *   "config_json": {
 *     "dir": "/data/inbound/bills",
 *     "file_prefix": "bill_",
 *     "file_suffix": ".csv",
 *     "window_format": "yyyyMMdd",
 *     "time_field": "biz_date"
 *   }
 * }
 * }</pre>
 *
 * <h3>运行语义</h3>
 * <ul>
 *   <li>输入：{@link FetchContext}（windowStart / windowEnd，窗口终点<b>不含</b>；config_json 参数 Map）</li>
 *   <li>窗口圈定：扫描 {@code dir}，文件名 {@code prefix + 日期 + suffix}，日期落在
 *       {@code [windowStart 日, windowEnd 日)} 内的文件参与解析（取数层需求规格 §4.2：实现类必须按窗口圈定）</li>
 *   <li>解析：首行作为源字段名（与 fields_json 声明的 source 字段一致），后续每行一行一 Map，
 *       值为文本；{@code time_field} 列解析为 Timestamp</li>
 *   <li>输出：{@code List<Map<String,Object>>}；窗口内无匹配文件 → 空列表（正常空窗口，不报错）</li>
 * </ul>
 *
 * <h3>注意事项</h3>
 * <ul>
 *   <li>{@code dir} 必填且必须存在可读，否则抛 {@link IllegalStateException}（配置错误需在 pull_run 可见）</li>
 *   <li>行字段值默认 String（CSV 文本）；金额等数值字段由 fields_json 字段映射处理
 *       （引擎金额比较按 BigDecimal 解析，String 可转）；time_field 已转 Timestamp 保证窗口键集口径一致</li>
 *   <li>CSV 解析为最小实现（按 delimiter 切分 + 表头映射），不处理跨行引号；复杂 CSV 可换 Apache Commons CSV</li>
 *   <li>位于 example 子包，配置须写<b>全限定类名</b>（简名补全仅对契约包生效）</li>
 *   <li>注册为 Spring 组件：优先从容器获取（可注入依赖），容器无则反射无参构造兜底</li>
 *   <li>fetch_one（单条重拉）默认不支持（CustomFetcherAdapter 抛错，走 backfill）——本示例按窗口全量，
 *       不做单条</li>
 * </ul>
 */
@Slf4j
@Component
public class CsvDirFetcher implements CustomFetcher {

    @Override
    public List<Map<String, Object>> fetch(FetchContext ctx) {
        Map<String, Object> p = ctx.getParams() == null ? Map.of() : ctx.getParams();
        String dir = str(p, "dir");
        String prefix = str(p, "file_prefix", "bill_");
        String suffix = str(p, "file_suffix", ".csv");
        String charset = str(p, "charset", "utf-8");
        String timeField = str(p, "time_field", "biz_date");
        String winFmt = str(p, "window_format", "yyyyMMdd");
        String delimiter = str(p, "delimiter", ",");
        if (dir == null || dir.isBlank()) {
            throw new IllegalStateException("CsvDirFetcher 参数 dir 必填（账单文件所在目录）");
        }
        DateTimeFormatter df = DateTimeFormatter.ofPattern(winFmt);
        Path root = Paths.get(dir);
        if (!Files.isDirectory(root)) {
            throw new IllegalStateException("账单目录不存在或不可读: " + dir);
        }

        List<Path> files = matchFiles(root, prefix, suffix, ctx.getWindowStart(), ctx.getWindowEnd(), df);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Path f : files) {
            rows.addAll(parseCsv(f, Charset.forName(charset), delimiter, timeField, df));
        }
        log.info("custom fetch {}: files={} rows={} window=[{}, {})",
                dir, files.size(), rows.size(), ctx.getWindowStart(), ctx.getWindowEnd());
        return rows;
    }

    /** 窗口圈定：文件名 prefix + 日期 + suffix，日期 ∈ [start 日, end 日)（窗口终点不含）。 */
    private List<Path> matchFiles(Path root, String prefix, String suffix,
                                  LocalDateTime start, LocalDateTime end, DateTimeFormatter df) {
        List<Path> out = new ArrayList<>();
        LocalDate startDate = start.toLocalDate();
        LocalDate endDate = end.toLocalDate();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(root)) {
            for (Path f : ds) {
                if (!Files.isRegularFile(f)) {
                    continue;
                }
                String name = f.getFileName().toString();
                if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
                    continue;
                }
                String mid = name.substring(prefix.length(), name.length() - suffix.length());
                LocalDate d;
                try {
                    d = LocalDate.parse(mid, df);
                } catch (RuntimeException e) {
                    continue;   // 非账单文件（日期段解析失败），跳过
                }
                if (!d.isBefore(startDate) && d.isBefore(endDate)) {
                    out.add(f);
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("读取账单目录失败: " + root + "（" + e.getMessage() + "）");
        }
        out.sort(Path::compareTo);
        return out;
    }

    /** 最小 CSV 解析：首行表头 → 每行一 Map（值 trim）；time_field 列转 Timestamp（当天 00:00）。 */
    private List<Map<String, Object>> parseCsv(Path file, Charset charset, String delimiter,
                                               String timeField, DateTimeFormatter df) {
        List<Map<String, Object>> rows = new ArrayList<>();
        try {
            List<String> lines = Files.readAllLines(file, charset);
            if (lines.isEmpty()) {
                return rows;
            }
            String[] header = split(lines.get(0), delimiter);
            for (int i = 1; i < lines.size(); i++) {
                String line = lines.get(i);
                if (line.isBlank()) {
                    continue;
                }
                String[] cells = split(line, delimiter);
                Map<String, Object> row = new HashMap<>();
                for (int c = 0; c < header.length && c < cells.length; c++) {
                    String h = header[c].trim();
                    if (h.isEmpty()) {
                        continue;
                    }
                    String v = cells[c].trim();
                    if (timeField.equals(h) && !v.isEmpty()) {
                        try {
                            row.put(h, Timestamp.valueOf(LocalDate.parse(v, df).atStartOfDay()));
                        } catch (RuntimeException e) {
                            row.put(h, v);  // 日期解析失败保持原样，交给字段映射/差异展示
                        }
                    } else {
                        row.put(h, v);
                    }
                }
                if (!row.isEmpty()) {
                    rows.add(row);
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("读取账单文件失败: " + file + "（" + e.getMessage() + "）");
        }
        return rows;
    }

    private static String[] split(String line, String delimiter) {
        return line.split(delimiter, -1);
    }

    private static String str(Map<String, Object> p, String key) {
        return p.get(key) == null ? null : String.valueOf(p.get(key));
    }

    private static String str(Map<String, Object> p, String key, String def) {
        String v = str(p, key);
        return v == null || v.isBlank() ? def : v;
    }
}

package com.mis.recon.custom.example;

import com.mis.recon.custom.FetchContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * CsvDirFetcher 单测（取数层 P 组 custom 单测：窗口圈定 / 行集解析 / time_field 转换 / 目录缺失报错）。
 */
class CsvDirFetcherTest {

    @TempDir
    Path temp;

    private void writeCsv(String name, String content) throws Exception {
        Files.writeString(temp.resolve(name), content);
    }

    @Test
    void windowFiltersFilesAndParsesRows() throws Exception {
        // 窗口 [08-26, 08-28)：08-26、08-27 参与；08-25、08-28 排除
        writeCsv("bill_20260825.csv", "order_no,pay_amount,biz_date\nD0,10,20260825\n");
        writeCsv("bill_20260826.csv", "order_no,pay_amount,biz_date\nA1,100,20260826\nA2,200,20260826\n");
        writeCsv("bill_20260827.csv", "order_no,pay_amount,biz_date\nB1,50,20260827\n");
        writeCsv("bill_20260828.csv", "order_no,pay_amount,biz_date\nC1,90,20260828\n");
        writeCsv("readme.txt", "not a bill\n");

        CsvDirFetcher f = new CsvDirFetcher();
        FetchContext ctx = FetchContext.builder()
                .windowStart(LocalDateTime.of(2026, 8, 26, 0, 0))
                .windowEnd(LocalDateTime.of(2026, 8, 28, 0, 0))
                .params(Map.of("dir", temp.toString()))
                .build();

        List<Map<String, Object>> rows = f.fetch(ctx);

        assertEquals(3, rows.size(), "窗口内 08-26/08-27 共 3 行，08-25/08-28/readme 排除");
        Map<String, Object> a1 = rows.stream()
                .filter(r -> "A1".equals(r.get("order_no")))
                .findFirst().orElseThrow();
        assertEquals("100", a1.get("pay_amount"));
        assertInstanceOf(Timestamp.class, a1.get("biz_date"), "time_field 解析为 Timestamp");
        assertEquals(LocalDateTime.of(2026, 8, 26, 0, 0),
                ((Timestamp) a1.get("biz_date")).toLocalDateTime());
    }

    @Test
    void emptyWindowReturnsEmptyList() throws Exception {
        writeCsv("bill_20260826.csv", "order_no,pay_amount,biz_date\nA1,100,20260826\n");

        CsvDirFetcher f = new CsvDirFetcher();
        FetchContext ctx = FetchContext.builder()
                .windowStart(LocalDateTime.of(2026, 9, 1, 0, 0))
                .windowEnd(LocalDateTime.of(2026, 9, 2, 0, 0))
                .params(Map.of("dir", temp.toString()))
                .build();

        assertTrue(f.fetch(ctx).isEmpty(), "窗口无匹配文件 → 空列表（正常空窗口）");
    }

    @Test
    void missingDirThrows() {
        CsvDirFetcher f = new CsvDirFetcher();
        FetchContext ctx = FetchContext.builder()
                .windowStart(LocalDateTime.of(2026, 8, 26, 0, 0))
                .windowEnd(LocalDateTime.of(2026, 8, 27, 0, 0))
                .params(Map.of("dir", temp.resolve("nope").toString()))
                .build();

        assertThrows(IllegalStateException.class, () -> f.fetch(ctx), "目录缺失 → 配置错误须在 pull_run 可见");
    }

    @Test
    void dirParamMissingThrows() {
        CsvDirFetcher f = new CsvDirFetcher();
        FetchContext ctx = FetchContext.builder()
                .windowStart(LocalDateTime.of(2026, 8, 26, 0, 0))
                .windowEnd(LocalDateTime.of(2026, 8, 27, 0, 0))
                .params(Map.of())
                .build();

        assertThrows(IllegalStateException.class, () -> f.fetch(ctx), "dir 必填");
    }
}

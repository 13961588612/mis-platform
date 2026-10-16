package com.mis.adminbff.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ReconProxy 通用透传的 query 编码防回归测试。
 *
 * <p>入站 query 是前端已编码字符串（中文 checkName 如 {@code %E5%82%A8...}）。
 * 修复前用 {@code uriBuilder.replaceQuery(query)} + 默认 DefaultUriBuilderFactory
 * （TEMPLATE_AND_VALUES）会把 {@code %} 二次编码成 {@code %25}，中文参数到下游变乱码，
 * 表现为差异处理「检查选全部能查出、选中中文检查名查不出」（scenarioCode 等英文参数
 * 无编码差异所以不受影响）。修复后改 {@code build(true)}（视输入为已编码），query 原样透传。</p>
 */
class ReconProxyEncodingTest {

    private static final String BASE_URL = "http://localhost:8110";
    private static final String UPSTREAM = "/internal/v1/recon/diffs";

    @Test
    @DisplayName("中文 query 透传不被二次编码：%E5 保持原样，不出现 %25")
    void encodedChineseQueryPassesThroughUnchanged() {
        String query = "page=1&size=20&scenarioCode=zhg_order_integral"
                + "&checkName=%E5%82%A8%E5%80%BC%E5%8D%A1%E9%87%91%E9%A2%9D%E6%A0%B8%E5%AF%B9";
        URI uri = UriComponentsBuilder.fromHttpUrl(BASE_URL)
                .path(UPSTREAM)
                .replaceQuery(query)
                .build(true)
                .toUri();

        String rawQuery = uri.getRawQuery();
        assertFalse(rawQuery.contains("%25"), "已编码 query 被二次编码：" + rawQuery);
        assertTrue(rawQuery.contains("%E5%82%A8%E5%80%BC"), "中文编码段丢失：" + rawQuery);
        assertEquals("储值卡金额核对", queryOf(uri, "checkName"),
                "解码后应为原始中文参数");
    }

    @Test
    @DisplayName("旧实现（默认编码）会二次编码：作为对照确认 build(true) 是必要修复")
    void legacyReplaceQueryDoublesEncoding() {
        String query = "checkName=%E5%82%A8%E5%80%BC%E5%8D%A1";
        URI doubled = UriComponentsBuilder.fromHttpUrl(BASE_URL)
                .path(UPSTREAM)
                .replaceQuery(query)
                .build() // 默认（非 encoded）：二次编码
                .toUri();
        assertTrue(doubled.getRawQuery().contains("%25"), "对照：旧实现应出现 %25");
    }

    @Test
    @DisplayName("无 query 时正常透传，不携带多余 ?")
    void noQueryKeepsCleanPath() {
        URI uri = UriComponentsBuilder.fromHttpUrl(BASE_URL)
                .path(UPSTREAM)
                .replaceQuery(null)
                .build(true)
                .toUri();
        assertEquals(BASE_URL + UPSTREAM, uri.toString());
    }

    private static String queryOf(URI uri, String name) {
        for (String pair : uri.getRawQuery().split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length == 2 && kv[0].equals(name)) {
                return java.net.URLDecoder.decode(kv[1], java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        return null;
    }
}

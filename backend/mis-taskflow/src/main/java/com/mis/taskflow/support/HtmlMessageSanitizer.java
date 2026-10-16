package com.mis.taskflow.support;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Safelist;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 后台消息正文：只保留白名单标签，图片地址仅允许本系统文件路径。
 */
public final class HtmlMessageSanitizer {

    public static final String FILE_PATH_PREFIX = "/api/v1/messages/files/";
    private static final Pattern FILE_ID = Pattern.compile("/api/v1/messages/files/(\\d+)");
    private static final int SUMMARY_MAX = 120;

    private static final Safelist SAFELIST = Safelist.none()
            .addTags("p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "h2", "h3", "blockquote", "img", "span")
            .addAttributes("a", "href", "rel")
            .addAttributes("img", "src", "alt")
            .addProtocols("a", "href", "http", "https");

    private HtmlMessageSanitizer() {
    }

    /** 清洗后的 HTML 片段（不含 envelope）。 */
    public static String cleanBody(String html) {
        String raw = html == null ? "" : html;
        String cleaned = Jsoup.clean(raw, "", SAFELIST, new Document.OutputSettings().prettyPrint(false));
        Document doc = Jsoup.parseBodyFragment(cleaned);
        for (Element img : doc.select("img")) {
            String src = img.attr("src");
            if (!src.matches("/api/v1/messages/files/\\d+")) {
                img.remove();
            }
        }
        for (Element a : new ArrayList<>(doc.select("a"))) {
            String href = a.attr("href");
            if (!href.startsWith("http://") && !href.startsWith("https://")) {
                a.unwrap();
            } else {
                a.attr("rel", "noopener noreferrer");
            }
        }
        return doc.body().html();
    }

    public static String toPlainSummary(String html) {
        String text = Jsoup.parse(cleanBody(html)).text().replaceAll("\\s+", " ").trim();
        if (text.length() <= SUMMARY_MAX) {
            return text;
        }
        return text.substring(0, SUMMARY_MAX);
    }

    public static List<Long> fileIds(String html) {
        Set<Long> ids = new LinkedHashSet<>();
        Matcher matcher = FILE_ID.matcher(html == null ? "" : html);
        while (matcher.find()) {
            ids.add(Long.parseLong(matcher.group(1)));
        }
        return List.copyOf(ids);
    }
}

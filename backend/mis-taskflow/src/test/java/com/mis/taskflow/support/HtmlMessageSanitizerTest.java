package com.mis.taskflow.support;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HtmlMessageSanitizerTest {

    @Test
    void stripsScriptAndKeepsText() {
        String body = HtmlMessageSanitizer.cleanBody("<p>你好</p><script>alert(1)</script>");
        assertTrue(body.contains("你好"));
        assertFalse(body.toLowerCase().contains("script"));
    }

    @Test
    void dropsExternalImagesAndKeepsOwnFiles() {
        String body = HtmlMessageSanitizer.cleanBody(
                "<p><img src=\"https://evil.example/a.png\"><img src=\"/api/v1/messages/files/42\"></p>");
        assertFalse(body.contains("evil.example"));
        assertTrue(body.contains("/api/v1/messages/files/42"));
        assertEquals(java.util.List.of(42L), HtmlMessageSanitizer.fileIds(body));
    }

    @Test
    void keepsTextAlignAndDropsOtherStyles() {
        String body = HtmlMessageSanitizer.cleanBody(
                "<p style=\"text-align: center; color: red\">居中</p><h2 style=\"font-size: 40px\">标题</h2>");
        assertTrue(body.contains("text-align: center"));
        assertFalse(body.contains("color"));
        assertFalse(body.contains("font-size"));
    }

    @Test
    void summaryTruncatesPlainText() {
        String summary = HtmlMessageSanitizer.toPlainSummary("<p><b>加粗</b> 通知</p>");
        assertEquals("加粗 通知", summary);
    }
}

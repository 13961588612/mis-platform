package com.mis.auth.service;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertTrue;

class CaptchaServiceSvgTest {

    @Test
    void toSvgBase64_containsAntiOcrElements() {
        String dataUrl = CaptchaService.toSvgBase64("A7KX");
        assertTrue(dataUrl.startsWith("data:image/svg+xml;base64,"));
        String svg = new String(
                Base64.getDecoder().decode(dataUrl.substring("data:image/svg+xml;base64,".length())),
                StandardCharsets.UTF_8);
        assertTrue(svg.contains("<circle"));
        assertTrue(svg.contains("<path"));
        assertTrue(svg.contains("rotate("));
        assertTrue(svg.contains(">A</text>") || svg.contains(">A<"));
    }
}

package com.mis.adminbff.controller;

import com.mis.adminbff.client.BankReceiptClient;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;

/**
 * POS 对账 BFF 反代入口。
 *
 * <p>路径前缀 {@code /api/v1/finance/bank-account/pos-account/**} →
 * {@code bip-bank-receipt /api/account-decide/**}。
 * 透传响应体与状态码，不二次包 {@code Result}（下游自有 code/message）。
 */
@RestController
@RequestMapping("/api/v1/finance/bank-account/pos-account")
public class PosAccountProxyController {

    private static final List<String> HOP_BY_HOP = List.of(
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailers", "transfer-encoding", "upgrade", "content-length", "host");

    private final BankReceiptClient bankReceiptClient;

    public PosAccountProxyController(BankReceiptClient bankReceiptClient) {
        this.bankReceiptClient = bankReceiptClient;
    }

    @RequestMapping("/**")
    public ResponseEntity<byte[]> proxy(HttpServletRequest request) throws IOException {
        HttpMethod method = HttpMethod.valueOf(request.getMethod());
        String path = request.getRequestURI();
        // 去掉 context-path（若有）
        String context = request.getContextPath();
        if (context != null && !context.isEmpty() && path.startsWith(context)) {
            path = path.substring(context.length());
        }
        byte[] body = StreamUtils.copyToByteArray(request.getInputStream());
        MediaType contentType = null;
        if (request.getContentType() != null) {
            contentType = MediaType.parseMediaType(request.getContentType());
        }

        ResponseEntity<byte[]> downstream = bankReceiptClient.forward(
                method, path, request.getQueryString(), body, contentType, true);

        HttpHeaders outHeaders = new HttpHeaders();
        downstream.getHeaders().forEach((name, values) -> {
            if (name != null && !HOP_BY_HOP.contains(name.toLowerCase())) {
                outHeaders.put(name, values);
            }
        });
        // 避免把下游 CORS 头带回（浏览器只对 MIS 域）
        outHeaders.remove(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN);
        outHeaders.remove(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS);
        outHeaders.remove(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS);
        outHeaders.remove(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS);

        return new ResponseEntity<>(downstream.getBody(), outHeaders, downstream.getStatusCode());
    }
}

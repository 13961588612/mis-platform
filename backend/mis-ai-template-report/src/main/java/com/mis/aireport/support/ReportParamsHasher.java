package com.mis.aireport.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;

/** 规范化参数 → 稳定 SHA-256（键排序）。 */
@Component
public class ReportParamsHasher {

    private final ObjectMapper sortedMapper;

    public ReportParamsHasher(ObjectMapper objectMapper) {
        this.sortedMapper = objectMapper.copy()
                .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
    }

    public String hash(Map<String, Object> params) {
        try {
            Map<String, Object> sorted = new TreeMap<>();
            if (params != null) {
                for (Map.Entry<String, Object> e : params.entrySet()) {
                    if (e.getKey() == null || e.getValue() == null) {
                        continue;
                    }
                    sorted.put(e.getKey(), String.valueOf(e.getValue()));
                }
            }
            byte[] json = sortedMapper.writeValueAsBytes(sorted);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(json));
        } catch (Exception e) {
            throw new IllegalStateException("计算 params_hash 失败", e);
        }
    }
}

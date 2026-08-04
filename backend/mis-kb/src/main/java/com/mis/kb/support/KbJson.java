package com.mis.kb.support;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.kb.api.dto.KbTicketTimelineEntry;
import com.mis.kb.domain.model.RagSettings;

import java.util.List;

/**
 * 知识库 JSON 序列化/反序列化工具。
 *
 * <p>承载两处 TEXT 列的结构化内容：
 * <ul>
 *   <li>{@code kb_library.rag_settings_json} → {@link RagSettings}</li>
 *   <li>{@code kb_qa_ticket.time_line} → {@code List<KbTicketTimelineEntry>}</li>
 * </ul>
 *
 * <p><b>为什么关闭 FAIL_ON_UNKNOWN_PROPERTIES：</b>RagSettings 是随版本增删字段的配置结构，
 * 老版本进程读到新版本写入的 JSON（含未知字段）时必须能正常降级解析，
 * 否则一次灰度发布就会让全部知识库的设置读取失败。
 */
public final class KbJson {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final TypeReference<List<KbTicketTimelineEntry>> TIMELINE_TYPE =
            new TypeReference<>() {};

    private KbJson() {
    }

    // ---------------------------------------------------------------- RAG 设置

    public static String writeSettings(RagSettings settings) {
        if (settings == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(settings);
        } catch (Exception e) {
            return null;
        }
    }

    public static RagSettings readSettings(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readValue(json, RagSettings.class);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- 工单时间线

    /**
     * 序列化工单时间线。
     *
     * @param timeline 时间线条目；{@code null}/空返回 {@code null}（列保持 NULL 而非 "[]"）
     * @return JSON 数组文本
     */
    public static String writeTimeline(List<KbTicketTimelineEntry> timeline) {
        if (timeline == null || timeline.isEmpty()) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(timeline);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 反序列化工单时间线。
     *
     * <p>解析失败一律返回空列表而非抛异常：时间线只是审计展示信息，
     * 不该因为一条脏 JSON 就让整个工单详情打不开。
     *
     * @param json JSON 数组文本
     * @return 时间线条目列表，永不为 {@code null}
     */
    public static List<KbTicketTimelineEntry> readTimeline(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<KbTicketTimelineEntry> parsed = MAPPER.readValue(json, TIMELINE_TYPE);
            return parsed == null ? List.of() : parsed;
        } catch (Exception e) {
            return List.of();
        }
    }
}

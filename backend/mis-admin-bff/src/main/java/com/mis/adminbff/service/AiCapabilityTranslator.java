package com.mis.adminbff.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.dto.ai.AiChatRequest;
import com.mis.adminbff.dto.ai.AiChatResponse;
import com.mis.adminbff.dto.ai.AiExtractRequest;
import com.mis.adminbff.dto.ai.AiExtractResponse;
import com.mis.adminbff.dto.ai.AiPlatformChatData;
import com.mis.adminbff.dto.ai.AiRagCitation;
import com.mis.adminbff.dto.ai.AiRagRequest;
import com.mis.adminbff.dto.ai.AiRagResponse;
import com.mis.adminbff.dto.ai.AiSummaryRequest;
import com.mis.adminbff.dto.ai.AiSummaryResponse;
import com.mis.adminbff.dto.ai.SummaryCitation;
import com.mis.adminbff.dto.ai.SummaryPoint;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * BFF 入参 → 平台请求体 的翻译与整形（设计 §2.3）。
 *
 * <p>职责：
 * <ol>
 *   <li>capability → 平台 agent_id 映射（summary→mis-summary 等）</li>
 *   <li>拼装平台 chat 请求体（content + role + metadata）</li>
 *   <li>解析平台返回的结构化 JSON（summary / extract / rag）为对应响应 DTO</li>
 * </ol>
 */
@Component
public class AiCapabilityTranslator {

    private static final Logger log = LoggerFactory.getLogger(AiCapabilityTranslator.class);

    private static final String SOURCE = "mis-bff";

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** capability → 平台 agent_id 约定映射。 */
    public static String agentIdFor(String capability) {
        return switch (capability) {
            case "summary" -> "mis-summary";
            case "extract" -> "mis-extract";
            case "rag" -> "mis-rag";
            case "chat" -> "mis-copilot";
            default -> "mis-" + capability;
        };
    }

    // ===== 平台请求体拼装 =====

    /** 组装平台 chat 请求体（content / role / metadata）。 */
    public Map<String, Object> buildBody(
            String content,
            String capability,
            Map<String, Object> pageContext,
            Long employeeId) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("source", SOURCE);
        metadata.put("capability", capability);
        metadata.put("page_context", pageContext == null ? Map.of() : pageContext);
        if (employeeId != null) {
            metadata.put("employee_id", employeeId);
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("content", content);
        body.put("role", "user");
        body.put("metadata", metadata);
        return body;
    }

    public String buildSummaryContent(AiSummaryRequest req) {
        StringBuilder sb = new StringBuilder();
        sb.append("请基于以下业务记录生成结构化摘要（仅输出 JSON）：\n");
        sb.append("业务记录：").append(toJson(req.getRecords())).append("\n");
        if (req.getContext() != null && !req.getContext().isEmpty()) {
            sb.append("页面上下文：").append(toJson(req.getContext())).append("\n");
        }
        if (req.getOptions() != null && !req.getOptions().isEmpty()) {
            sb.append("生成选项：").append(toJson(req.getOptions())).append("\n");
        }
        return sb.toString();
    }

    public String buildExtractContent(AiExtractRequest req) {
        StringBuilder sb = new StringBuilder();
        sb.append("请从以下文本中按 schema 抽取字段（仅输出 JSON）：\n");
        sb.append("抽取 schema：").append(toJson(req.getSchema())).append("\n");
        sb.append("待抽取文本：").append(req.getText() == null ? "" : req.getText()).append("\n");
        if (req.getContext() != null && !req.getContext().isEmpty()) {
            sb.append("页面上下文：").append(toJson(req.getContext())).append("\n");
        }
        return sb.toString();
    }

    public String buildRagContent(AiRagRequest req) {
        StringBuilder sb = new StringBuilder();
        sb.append("请基于知识库回答以下问题（仅输出 JSON）：\n");
        sb.append("知识库：").append(req.getKb() == null ? "" : req.getKb()).append("\n");
        if (req.getTopK() != null) {
            sb.append("召回条数：").append(req.getTopK()).append("\n");
        }
        sb.append("问题：").append(req.getQuestion() == null ? "" : req.getQuestion()).append("\n");
        if (req.getContext() != null && !req.getContext().isEmpty()) {
            sb.append("页面上下文：").append(toJson(req.getContext())).append("\n");
        }
        return sb.toString();
    }

    public String buildChatContent(AiChatRequest req) {
        // 取末条用户消息作为平台 content；selectedRows 等由 metadata 携带
        if (req.getMessages() == null || req.getMessages().isEmpty()) {
            return "";
        }
        return req.getMessages().get(req.getMessages().size() - 1).getContent();
    }

    // ===== 平台响应整形 =====

    public AiSummaryResponse parseSummary(AiPlatformChatData data) {
        AiSummaryResponse resp = new AiSummaryResponse();
        resp.setSessionId(data.getSessionId());
        try {
            JsonNode node = objectMapper.readTree(data.getResponse() == null ? "{}" : data.getResponse());
            if (node.has("summary") && !node.get("summary").isNull()) {
                resp.setSummary(node.get("summary").asText());
            }
            // points：结构化 List<SummaryPoint>，兼容旧 List<String>（→ text 兜底）
            if (node.has("points") && node.get("points").isArray()) {
                List<SummaryPoint> points = new ArrayList<>();
                for (JsonNode p : node.get("points")) {
                    if (p.isObject()) {
                        SummaryPoint sp = new SummaryPoint();
                        sp.setLabel(p.path("label").asText(""));
                        sp.setValue(p.path("value").asText(""));
                        sp.setRisk(p.path("risk").asText(""));
                        sp.setText(p.path("text").asText(""));
                        if (sp.getText().isEmpty()
                                && (!sp.getLabel().isEmpty() || !sp.getValue().isEmpty())) {
                            sp.setText(sp.getLabel() + (sp.getValue().isEmpty() ? "" : ": " + sp.getValue()));
                        }
                        points.add(sp);
                    } else {
                        SummaryPoint sp = new SummaryPoint();
                        sp.setText(p.asText());
                        points.add(sp);
                    }
                }
                resp.setPoints(points);
            }
            // citations：结构化 List<SummaryCitation>，兼容旧 List<String>（→ source 兜底）
            if (node.has("citations") && node.get("citations").isArray()) {
                List<SummaryCitation> citations = new ArrayList<>();
                for (JsonNode c : node.get("citations")) {
                    if (c.isObject()) {
                        SummaryCitation sc = new SummaryCitation();
                        sc.setField(c.path("field").asText(""));
                        sc.setValue(c.path("value").asText(""));
                        sc.setSource(c.path("source").asText(""));
                        citations.add(sc);
                    } else {
                        SummaryCitation sc = new SummaryCitation();
                        sc.setSource(c.asText());
                        citations.add(sc);
                    }
                }
                resp.setCitations(citations);
            }
        } catch (Exception ex) {
            log.warn("Failed to parse summary JSON, raw={}", data.getResponse(), ex);
        }
        return resp;
    }

    public AiExtractResponse parseExtract(AiPlatformChatData data) {
        AiExtractResponse resp = new AiExtractResponse();
        resp.setSessionId(data.getSessionId());
        try {
            JsonNode node = objectMapper.readTree(data.getResponse() == null ? "{}" : data.getResponse());
            if (node.has("fields") && node.get("fields").isObject()) {
                Map<String, Object> fields = new LinkedHashMap<>();
                node.get("fields").fields().forEachRemaining(e ->
                        fields.put(e.getKey(), toJavaValue(e.getValue())));
                resp.setFields(fields);
            }
            // T-ext：对象式逐字段 confidence（键 = 前端 AdminField.key）
            if (node.has("confidence") && !node.get("confidence").isNull()) {
                JsonNode c = node.get("confidence");
                if (c.isObject()) {
                    Map<String, Double> confidence = new LinkedHashMap<>();
                    c.fields().forEachRemaining(e -> {
                        double v = e.getValue().isNumber() ? e.getValue().asDouble() : 0.0;
                        confidence.put(e.getKey(), v);
                    });
                    resp.setConfidence(confidence);
                } else {
                    // 旧标量窗口：BFF 先上、平台仍返标量 → 置 null，
                    // 前端退化为「全部字段共用默认阈值」（设计 §7 Q3 / §8 共享知识 7）。
                    resp.setConfidence(null);
                }
            }
            // T-ext：unmapped 数组（{raw, hint?}）；容忍 List<String> 形态（→ raw）
            if (node.has("unmapped") && node.get("unmapped").isArray()) {
                List<Map<String, Object>> unmapped = new ArrayList<>();
                for (JsonNode u : node.get("unmapped")) {
                    if (u.isObject()) {
                        Map<String, Object> m = new LinkedHashMap<>();
                        u.fields().forEachRemaining(en -> m.put(en.getKey(), toJavaValue(en.getValue())));
                        unmapped.add(m);
                    } else {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("raw", u.asText());
                        unmapped.add(m);
                    }
                }
                resp.setUnmapped(unmapped);
            }
        } catch (Exception ex) {
            log.warn("Failed to parse extract JSON, raw={}", data.getResponse(), ex);
        }
        return resp;
    }

    public AiRagResponse parseRag(AiPlatformChatData data) {
        AiRagResponse resp = new AiRagResponse();
        resp.setSessionId(data.getSessionId());
        try {
            JsonNode node = objectMapper.readTree(data.getResponse() == null ? "{}" : data.getResponse());
            resp.setAnswer(node.path("answer").asText(""));
            if (node.has("citations") && node.get("citations").isArray()) {
                List<AiRagCitation> citations = new ArrayList<>();
                for (JsonNode c : node.get("citations")) {
                    AiRagCitation cit = new AiRagCitation();
                    cit.setSource(c.path("source").asText(""));
                    cit.setChunk(c.path("chunk").asText(""));
                    if (c.has("score") && !c.get("score").isNull()) {
                        cit.setScore(c.get("score").asDouble());
                    }
                    citations.add(cit);
                }
                resp.setCitations(citations);
            }
        } catch (Exception ex) {
            log.warn("Failed to parse rag JSON, raw={}", data.getResponse(), ex);
        }
        return resp;
    }

    public AiChatResponse parseChat(AiPlatformChatData data) {
        AiChatResponse resp = new AiChatResponse();
        resp.setContent(data.getResponse());
        resp.setSessionId(data.getSessionId());
        resp.setFinishReason("stop");
        return resp;
    }

    // ===== 内部工具 =====

    private List<String> readStringList(JsonNode node, String field) {
        List<String> out = new ArrayList<>();
        if (node.has(field) && node.get(field).isArray()) {
            for (JsonNode n : node.get(field)) {
                out.add(n.asText());
            }
        }
        return out;
    }

    private Object toJavaValue(JsonNode n) {
        if (n.isNumber()) {
            return n.numberValue();
        }
        if (n.isBoolean()) {
            return n.booleanValue();
        }
        if (n.isNull()) {
            return null;
        }
        return n.asText();
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception ex) {
            return String.valueOf(obj);
        }
    }
}

package com.mis.recon.service.engine;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.domain.runtime.DiagnosisContext;
import com.mis.recon.domain.runtime.Mismatch;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * 差异诊断构建器（F97，T05-spec §10 / §18.5）：diff_diagnosis_json 三阶段快照，≤32KB 截断。
 * <p>与 recon_detail upsert 同事务整体重写——描述"当前这条差异最新一次被判定时的现场"。</p>
 */
@Component
public class DiagnosisBuilder {

    private static final int MAX_JSON_BYTES = 32 * 1024;
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final ObjectMapper objectMapper;

    public DiagnosisBuilder(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String build(DiagnosisContext ctx) {
        ObjectNode root = objectMapper.createObjectNode();

        // 匹配阶段
        ObjectNode match = root.putObject("match_phase");
        match.put("matcher_type", "key_fields");
        match.put("raw_key", ctx.getMatchKeyDisplay() == null ? "" : ctx.getMatchKeyDisplay());
        match.put("normalized_key", ctx.getMatchKeyDisplay() == null ? "" : ctx.getMatchKeyDisplay());
        match.putArray("transform_chain");                       // MVP：归一规则未逐字段留痕（T05-spec 变更记录）
        match.putArray("left_rows");
        match.putArray("right_rows");
        if (ctx.getUnmatchedSide() != null) {
            match.put("unmatched_side", ctx.getUnmatchedSide());
        } else {
            match.put("unmatched_side", "null");
        }
        if (ctx.getMultiRowGroupSize() != null) {
            match.put("multi_row_group_size", ctx.getMultiRowGroupSize());
        }
        match.put("matched_index_hit", ctx.getMatchedIndexHit() != null && ctx.getMatchedIndexHit());

        // 比较阶段
        ObjectNode compare = root.putObject("compare_phase");
        compare.put("compared_fields", ctx.getComparedFields());
        ArrayNode mismatches = compare.putArray("mismatches");
        List<Mismatch> ms = ctx.getMismatches();
        if (ms != null) {
            for (Mismatch m : ms) {
                ObjectNode n = mismatches.addObject();
                n.put("field", m.getField() == null ? "" : m.getField());
                n.put("left", m.getLeftValue() == null ? "" : m.getLeftValue());
                n.put("right", m.getRightValue() == null ? "" : m.getRightValue());
                n.put("tolerance", m.getTolerance() == null ? "" : m.getTolerance());
                n.put("eq_rule", m.getEqRule() == null ? "" : m.getEqRule());
            }
        }
        compare.putNull("aggregate_summary");

        // 判定阶段
        ObjectNode verdict = root.putObject("verdict_phase");
        verdict.put("diff_type_decided", ctx.getDiffTypeDecided() == null ? "" : ctx.getDiffTypeDecided());
        verdict.put("reason", ctx.getReason() == null ? "" : ctx.getReason());
        if (ctx.getPendingPeerPullRunId() != null) {
            verdict.put("pending_peer_pull_run_id", ctx.getPendingPeerPullRunId());
        } else {
            verdict.putNull("pending_peer_pull_run_id");
        }
        verdict.put("upgrade_condition", ctx.getUpgradeCondition() == null ? "none" : ctx.getUpgradeCondition());
        verdict.put("resume_reason", ctx.getResumeReason() == null ? "" : ctx.getResumeReason());
        verdict.put("generated_at", LocalDateTime.now().format(FMT));

        // 自定义实现诊断上下文（strategy=custom 附带，§13.2；不提供则无此节点，默认空诊断降级可用）
        if (ctx.getCustomContext() != null && !ctx.getCustomContext().isEmpty()) {
            root.set("custom_context", objectMapper.valueToTree(ctx.getCustomContext()));
        }

        String json;
        try {
            json = objectMapper.writeValueAsString(root);
        } catch (JsonProcessingException e) {
            return "{}";
        }
        if (json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_JSON_BYTES) {
            // 截断到 32KB 边界（UTF-8 安全：按字节截断后丢弃不完整尾部）
            byte[] bytes = json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            int cut = MAX_JSON_BYTES;
            while (cut > 0 && (bytes[cut - 1] & 0xC0) == 0x80) {
                cut--;
            }
            return new String(bytes, 0, cut, java.nio.charset.StandardCharsets.UTF_8);
        }
        return json;
    }
}

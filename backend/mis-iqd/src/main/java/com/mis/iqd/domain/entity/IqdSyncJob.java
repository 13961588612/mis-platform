package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 问数增强同步作业（iqd_sync_job）。
 *
 * <p>按连接记录一次「整库 rebuild（context build）+ memory index + 回填」作业的生命周期。
 * 一期每连接仅保留最新一条（覆盖写），由 ai-platform 经 {@code IqdConfigClient} 回调写回：
 * <ul>
 *   <li>{@code build_status}：pending | running | success | failed（context build 阶段）</li>
 *   <li>{@code index_status}：pending | running | success | failed（memory index 阶段）</li>
 *   <li>{@code build_mdl_hash}：context build 返回的 mdl_hash（解析失败回退 {@code wqd-*}）</li>
 * </ul>
 */
@Entity
@Table(name = "iqd_sync_job")
public class IqdSyncJob {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(name = "build_status", nullable = false)
    private String buildStatus = "pending";

    @Column(name = "build_mdl_hash")
    private String buildMdlHash;

    @Column(name = "index_status", nullable = false)
    private String indexStatus = "pending";

    @Column(name = "build_at")
    private Instant buildAt;

    @Column(name = "index_at")
    private Instant indexAt;

    @Column(name = "synced_sql_pair_count", nullable = false)
    private Integer syncedSqlPairCount = 0;

    @Column(name = "synced_knowledge_count", nullable = false)
    private Integer syncedKnowledgeCount = 0;

    @Column(name = "build_error", columnDefinition = "text")
    private String buildError;

    @Column(name = "index_error", columnDefinition = "text")
    private String indexError;

    /** 本次 build 对应连接 revision（G7：model 写回回填用）。 */
    @Column(name = "edit_revision")
    private Long editRevision;

    /** 本次同步来源：materials（一期物料）/ model（二期模型写回）。 */
    @Column(name = "edit_source")
    private String editSource;

    /**
     * 本次派生 MDL 时「已编辑但未落入 MDL」的节点数（T03e；0=全部生效）。
     *
     * <p>前端据此提示「N 项编辑未生效」——此前该信息只写日志，用户保存成功后会误以为生效。
     */
    @Column(name = "unmatched_edit_count", nullable = false)
    private Integer unmatchedEditCount = 0;

    /** 未落入 MDL 的节点清单（JSON 数组文本；为 null 表示无）。 */
    @Column(name = "unmatched_edits", columnDefinition = "text")
    private String unmatchedEdits;

    /**
     * 发布后引擎侧自检告警（2026-09-28）：JSON 字符串数组。
     *
     * <p>发布成功后读回 {@code wren context show} 与派生 MDL 对账，差异落本列 —— 覆盖
     * 「build 成功但引擎侧没有 cube/关系（只写了 target/mdl.json）」这类静默失败。
     */
    @Column(name = "publish_warnings", columnDefinition = "text")
    private String publishWarnings;

    /** 本次同步动作：force_rebuild（自愈强制重建）/ reindex（自愈重新索引）/ validate（自愈模型校验）/ materials / model。可为 null（兼容历史作业）。 */
    @Column(name = "action")
    private String action;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getBuildStatus() {
        return buildStatus;
    }

    public void setBuildStatus(String buildStatus) {
        this.buildStatus = buildStatus;
    }

    public String getBuildMdlHash() {
        return buildMdlHash;
    }

    public void setBuildMdlHash(String buildMdlHash) {
        this.buildMdlHash = buildMdlHash;
    }

    public String getIndexStatus() {
        return indexStatus;
    }

    public void setIndexStatus(String indexStatus) {
        this.indexStatus = indexStatus;
    }

    public Instant getBuildAt() {
        return buildAt;
    }

    public void setBuildAt(Instant buildAt) {
        this.buildAt = buildAt;
    }

    public Instant getIndexAt() {
        return indexAt;
    }

    public void setIndexAt(Instant indexAt) {
        this.indexAt = indexAt;
    }

    public Integer getSyncedSqlPairCount() {
        return syncedSqlPairCount;
    }

    public void setSyncedSqlPairCount(Integer syncedSqlPairCount) {
        this.syncedSqlPairCount = syncedSqlPairCount;
    }

    public Integer getSyncedKnowledgeCount() {
        return syncedKnowledgeCount;
    }

    public void setSyncedKnowledgeCount(Integer syncedKnowledgeCount) {
        this.syncedKnowledgeCount = syncedKnowledgeCount;
    }

    public String getBuildError() {
        return buildError;
    }

    public void setBuildError(String buildError) {
        this.buildError = buildError;
    }

    public String getIndexError() {
        return indexError;
    }

    public void setIndexError(String indexError) {
        this.indexError = indexError;
    }

    public Long getEditRevision() {
        return editRevision;
    }

    public void setEditRevision(Long editRevision) {
        this.editRevision = editRevision;
    }

    public String getEditSource() {
        return editSource;
    }

    public void setEditSource(String editSource) {
        this.editSource = editSource;
    }

    public Integer getUnmatchedEditCount() {
        return unmatchedEditCount;
    }

    public void setUnmatchedEditCount(Integer unmatchedEditCount) {
        this.unmatchedEditCount = unmatchedEditCount;
    }

    public String getUnmatchedEdits() {
        return unmatchedEdits;
    }

    public void setUnmatchedEdits(String unmatchedEdits) {
        this.unmatchedEdits = unmatchedEdits;
    }

    public String getPublishWarnings() {
        return publishWarnings;
    }

    public void setPublishWarnings(String publishWarnings) {
        this.publishWarnings = publishWarnings;
    }


    public String getAction() {
        return action;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}

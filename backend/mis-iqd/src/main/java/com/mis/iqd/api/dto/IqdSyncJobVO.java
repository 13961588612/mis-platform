package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * 增强同步作业响应 VO（GET /api/v1/iqd/enhance/sync-status；snake_case wire）。
 *
 * <p>供前端 SyncStatusBar 渲染 build/index 进度与回填计数。
 */
public class IqdSyncJobVO {

    private Long id;
    private Long connectionId;
    private String buildStatus;
    private String buildMdlHash;
    private String indexStatus;
    private Instant buildAt;
    private Instant indexAt;
    private Integer syncedSqlPairCount;
    private Integer syncedKnowledgeCount;
    private String buildError;
    private String indexError;
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    @JsonProperty("connection_id")
    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    @JsonProperty("build_status")
    public String getBuildStatus() {
        return buildStatus;
    }

    public void setBuildStatus(String buildStatus) {
        this.buildStatus = buildStatus;
    }

    @JsonProperty("build_mdl_hash")
    public String getBuildMdlHash() {
        return buildMdlHash;
    }

    public void setBuildMdlHash(String buildMdlHash) {
        this.buildMdlHash = buildMdlHash;
    }

    @JsonProperty("index_status")
    public String getIndexStatus() {
        return indexStatus;
    }

    public void setIndexStatus(String indexStatus) {
        this.indexStatus = indexStatus;
    }

    @JsonProperty("build_at")
    public Instant getBuildAt() {
        return buildAt;
    }

    public void setBuildAt(Instant buildAt) {
        this.buildAt = buildAt;
    }

    @JsonProperty("index_at")
    public Instant getIndexAt() {
        return indexAt;
    }

    public void setIndexAt(Instant indexAt) {
        this.indexAt = indexAt;
    }

    @JsonProperty("synced_sql_pair_count")
    public Integer getSyncedSqlPairCount() {
        return syncedSqlPairCount;
    }

    public void setSyncedSqlPairCount(Integer syncedSqlPairCount) {
        this.syncedSqlPairCount = syncedSqlPairCount;
    }

    @JsonProperty("synced_knowledge_count")
    public Integer getSyncedKnowledgeCount() {
        return syncedKnowledgeCount;
    }

    public void setSyncedKnowledgeCount(Integer syncedKnowledgeCount) {
        this.syncedKnowledgeCount = syncedKnowledgeCount;
    }

    @JsonProperty("build_error")
    public String getBuildError() {
        return buildError;
    }

    public void setBuildError(String buildError) {
        this.buildError = buildError;
    }

    @JsonProperty("index_error")
    public String getIndexError() {
        return indexError;
    }

    public void setIndexError(String indexError) {
        this.indexError = indexError;
    }

    @JsonProperty("updated_at")
    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}

package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 存量引擎 dataset 批量重命名流水（P1-T4 审计与回滚依据）。
 *
 * <p>一次 dry-run 或执行 = 一个 {@code batchId}（UUID），组内每个被处理的库一行。
 * 每行记录改名前/后的引擎侧实际名、动作类型与执行状态，供：
 * <ul>
 *   <li>运维审计（谁、什么时候、把哪个 dataset 从什么名改成什么名）；</li>
 *   <li>按 {@code batchId} 反向回滚（只读 {@code status=1} 的成功行，new→old）。</li>
 * </ul>
 *
 * <p>{@code action}：RENAME=实际改名成功；SKIP=期望名已等于实际名无需改（幂等）；
 * FAILED=引擎调用失败（{@code status=2}，{@code error} 记原因）。
 * {@code status}：0=未执行（dry-run 计划行）1=成功 2=失败。
 *
 * <p>{@code operatorId} 取 BFF 透传的 {@code X-User-Id} 头，满足高危操作可追责。
 */
@Entity
@Table(name = "kb_engine_rename_log")
public class KbEngineRenameLog {

    @Id
    private Long id;

    /** 批次号 UUID；一次 dry-run 或执行各自独立批次。 */
    @Column(name = "batch_id", nullable = false, length = 40)
    private String batchId;

    /** 关联的 MIS 知识库 id。 */
    @Column(name = "library_id", nullable = false)
    private Long libraryId;

    /** 引擎类型（当前仅 ragflow）。 */
    @Column(name = "engine_type", nullable = false, length = 32)
    private String engineType;

    /** 引擎原生 dataset id。 */
    @Column(name = "native_id", nullable = false, length = 64)
    private String nativeId;

    /** 改名前引擎侧实际名。 */
    @Column(name = "old_name", nullable = false, length = 255)
    private String oldName;

    /** 期望的规范名（= KbLibraryService.expectedEngineName(lib)）。 */
    @Column(name = "new_name", nullable = false, length = 255)
    private String newName;

    /** RENAME / SKIP / FAILED。 */
    @Column(name = "action", nullable = false, length = 16)
    private String action;

    /** 0=未执行 1=成功 2=失败。 */
    @Column(name = "status", nullable = false)
    private Integer status = 0;

    /** 失败原因（status=2 时）。 */
    @Column(name = "error", length = 512)
    private String error;

    /** 操作人用户 id（X-User-Id 透传头）。 */
    @Column(name = "operator_id")
    private Long operatorId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getBatchId() {
        return batchId;
    }

    public void setBatchId(String batchId) {
        this.batchId = batchId;
    }

    public Long getLibraryId() {
        return libraryId;
    }

    public void setLibraryId(Long libraryId) {
        this.libraryId = libraryId;
    }

    public String getEngineType() {
        return engineType;
    }

    public void setEngineType(String engineType) {
        this.engineType = engineType;
    }

    public String getNativeId() {
        return nativeId;
    }

    public void setNativeId(String nativeId) {
        this.nativeId = nativeId;
    }

    public String getOldName() {
        return oldName;
    }

    public void setOldName(String oldName) {
        this.oldName = oldName;
    }

    public String getNewName() {
        return newName;
    }

    public void setNewName(String newName) {
        this.newName = newName;
    }

    public String getAction() {
        return action;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public Long getOperatorId() {
        return operatorId;
    }

    public void setOperatorId(Long operatorId) {
        this.operatorId = operatorId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}

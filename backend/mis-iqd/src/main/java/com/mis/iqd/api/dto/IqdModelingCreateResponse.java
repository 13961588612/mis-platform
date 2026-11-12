package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 建模台新建节点统一出参（v1.11 系统设计 §5；snake_case wire）。
 *
 * <p>由 {@code IqdCatalogNodeService} 的 5 个 {@code createXxx} 方法返回：
 * 幂等命中时返回**首次**结果（不二次 bump {@code edit_revision}）。
 */
public class IqdModelingCreateResponse {

    /** 本次落库后的连接编辑版本（幂等命中则为首次版本）。 */
    private Long editRevision;

    /** 派生编辑态：EDITED_UNSYNCED | SYNCING | SYNCED | SYNC_FAILED | STALE_DRIFT。 */
    private String editStatus;

    /** 该节点被编入的 MDL 标识（异步 build 完成后回填；未同步为 null）。 */
    private String wrenRefId;

    public IqdModelingCreateResponse() {
    }

    public IqdModelingCreateResponse(Long editRevision, String editStatus, String wrenRefId) {
        this.editRevision = editRevision;
        this.editStatus = editStatus;
        this.wrenRefId = wrenRefId;
    }

    @JsonProperty("edit_revision")
    public Long getEditRevision() {
        return editRevision;
    }

    public void setEditRevision(Long editRevision) {
        this.editRevision = editRevision;
    }

    @JsonProperty("edit_status")
    public String getEditStatus() {
        return editStatus;
    }

    public void setEditStatus(String editStatus) {
        this.editStatus = editStatus;
    }

    @JsonProperty("wren_ref_id")
    public String getWrenRefId() {
        return wrenRefId;
    }

    public void setWrenRefId(String wrenRefId) {
        this.wrenRefId = wrenRefId;
    }
}

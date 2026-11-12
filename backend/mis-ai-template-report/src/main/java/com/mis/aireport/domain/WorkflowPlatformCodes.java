package com.mis.aireport.domain;

/** 工作流平台编码（与 ai_workflow_platform.platform_code 对齐）。 */
public final class WorkflowPlatformCodes {

    public static final String ALIYUN_BAILIAN = "aliyun-bailian";

    private WorkflowPlatformCodes() {
    }

    public static boolean isAliyunBailian(String platformCode) {
        return ALIYUN_BAILIAN.equals(platformCode == null ? null : platformCode.trim());
    }
}

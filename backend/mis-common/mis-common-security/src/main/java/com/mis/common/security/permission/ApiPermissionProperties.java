package com.mis.common.security.permission;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mis.api-permission")
public class ApiPermissionProperties {

    /** 是否启用 BFF API 鉴权 */
    private boolean enabled = true;

    /** 未映射到 Registry 的路径是否拒绝（生产建议 true） */
    private boolean denyUnmapped = false;

    /** Registry 定时刷新间隔（秒）；0 表示仅启动加载 */
    private long refreshIntervalSeconds = 300;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isDenyUnmapped() {
        return denyUnmapped;
    }

    public void setDenyUnmapped(boolean denyUnmapped) {
        this.denyUnmapped = denyUnmapped;
    }

    public long getRefreshIntervalSeconds() {
        return refreshIntervalSeconds;
    }

    public void setRefreshIntervalSeconds(long refreshIntervalSeconds) {
        this.refreshIntervalSeconds = refreshIntervalSeconds;
    }
}

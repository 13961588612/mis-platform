package com.mis.common.security.permission;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mis.api-permission")
public class ApiPermissionProperties {

    /** 是否启用 BFF API 鉴权 */
    private boolean enabled = true;

    /**
     * 未映射到 Registry 的路径是否拒绝（fail-closed 安全默认值）。
     * <p>SEC-01（技术债 11.3 销账）：默认值 false → true。prod 已显式
     * {@code deny-unmapped: true}（commit 6db58b0），test/integration/本地均显式配置，
     * 故默认值改动对已知环境零行为变化，只影响未来未显式配置的环境（安全网收紧）。
     * 未登记路径拒绝响应 = HTTP 403 + {@code Result{code:40300, message:"接口未授权映射"}}。</p>
     */
    private boolean denyUnmapped = true;

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

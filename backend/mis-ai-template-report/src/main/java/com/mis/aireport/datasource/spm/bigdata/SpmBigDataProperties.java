package com.mis.aireport.datasource.spm.bigdata;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 超市大数据源 {@code spm-big-data}：JDBC 直连（StarRocks / Doris MySQL 协议），槽位用 SQL 取数。
 *
 * <p>各槽位 {@code *.enabled} 默认 false，对接完 SQL 后再逐个打开。
 */
@ConfigurationProperties(prefix = "mis.ai-report.datasources.spm-big-data")
public class SpmBigDataProperties {

    private boolean enabled = false;

    /** 例：jdbc:mysql://10.x.x.x:9030/adhoc?useSSL=false */
    private String jdbcUrl = "";

    private String username = "";

    private String password = "";

    private String driverClassName = "com.mysql.cj.jdbc.Driver";

    private int maximumPoolSize = 3;

    private SlotToggle authorizedStores = new SlotToggle(false);
    private SlotToggle bizDates = new SlotToggle(false);
    private SlotToggle ordWeeks = new SlotToggle(false);
    private SlotToggle ordMonths = new SlotToggle(false);

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getJdbcUrl() {
        return jdbcUrl;
    }

    public void setJdbcUrl(String jdbcUrl) {
        this.jdbcUrl = jdbcUrl;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getDriverClassName() {
        return driverClassName;
    }

    public void setDriverClassName(String driverClassName) {
        this.driverClassName = driverClassName;
    }

    public int getMaximumPoolSize() {
        return maximumPoolSize;
    }

    public void setMaximumPoolSize(int maximumPoolSize) {
        this.maximumPoolSize = maximumPoolSize;
    }

    public SlotToggle getAuthorizedStores() {
        return authorizedStores;
    }

    public void setAuthorizedStores(SlotToggle authorizedStores) {
        this.authorizedStores = authorizedStores;
    }

    public SlotToggle getBizDates() {
        return bizDates;
    }

    public void setBizDates(SlotToggle bizDates) {
        this.bizDates = bizDates;
    }

    public SlotToggle getOrdWeeks() {
        return ordWeeks;
    }

    public void setOrdWeeks(SlotToggle ordWeeks) {
        this.ordWeeks = ordWeeks;
    }

    public SlotToggle getOrdMonths() {
        return ordMonths;
    }

    public void setOrdMonths(SlotToggle ordMonths) {
        this.ordMonths = ordMonths;
    }

    public static class SlotToggle {
        private boolean enabled;

        public SlotToggle() {
        }

        public SlotToggle(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }
    }
}

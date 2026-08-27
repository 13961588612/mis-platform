package com.mis.recon.service.report;

import java.util.ArrayList;
import java.util.List;

/**
 * 渲染后的报告内容（T07-spec §3.2）：单 check 一份。
 */
public class ReportContent {

    private final String scenarioCode;
    private final String checkName;
    private final String title;
    private final String body;
    private final String severity;
    /** 渠道参数（ReporterConfig.config_json，可能为 null） */
    private String configJson;
    private final List<Long> detailIds = new ArrayList<>();

    public ReportContent(String scenarioCode, String checkName, String title, String body, String severity) {
        this.scenarioCode = scenarioCode;
        this.checkName = checkName;
        this.title = title;
        this.body = body;
        this.severity = severity;
    }

    public ReportContent withConfig(String configJson) {
        this.configJson = configJson;
        return this;
    }

    public String getScenarioCode() {
        return scenarioCode;
    }

    public String getCheckName() {
        return checkName;
    }

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }

    public String getSeverity() {
        return severity;
    }

    public List<Long> getDetailIds() {
        return detailIds;
    }

    public String getConfigJson() {
        return configJson;
    }

    public ReportContent withDetailIds(List<Long> ids) {
        detailIds.addAll(ids);
        return this;
    }
}
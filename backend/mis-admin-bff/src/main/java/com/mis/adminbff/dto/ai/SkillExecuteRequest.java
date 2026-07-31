package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * 前端发起的 Skill 执行请求 DTO。
 * 携带用户自然语言输入、表单上下文及可选的 HITL 回填信息。
 */
public class SkillExecuteRequest {

    /** Skill 唯一标识，如 "user-fill"。 */
    private String skillId = "";

    /** 用户自然语言输入，如 "把张三调到财务部"。 */
    private String userInput = "";

    /** 表单已填值上下文，如 {"orgId": 3}。 */
    private Map<String, Object> pageContext = Map.of();

    /** HITL 回填空填时携带的 resume token（可选）。 */
    private String resumeToken;

    /** HITL 场景下用户选择的具体候选结果（可选）。 */
    private String selectedCandidate;

    public String getSkillId() {
        return skillId;
    }

    public void setSkillId(String skillId) {
        this.skillId = skillId;
    }

    public String getUserInput() {
        return userInput;
    }

    public void setUserInput(String userInput) {
        this.userInput = userInput;
    }

    public Map<String, Object> getPageContext() {
        return pageContext;
    }

    public void setPageContext(Map<String, Object> pageContext) {
        this.pageContext = pageContext;
    }

    public String getResumeToken() {
        return resumeToken;
    }

    public void setResumeToken(String resumeToken) {
        this.resumeToken = resumeToken;
    }

    public String getSelectedCandidate() {
        return selectedCandidate;
    }

    public void setSelectedCandidate(String selectedCandidate) {
        this.selectedCandidate = selectedCandidate;
    }
}

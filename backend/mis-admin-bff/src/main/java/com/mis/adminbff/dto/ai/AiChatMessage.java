package com.mis.adminbff.dto.ai;

/**
 * 对话消息（{@code role} / {@code content}）。
 */
public class AiChatMessage {

    private String role = "user";

    private String content;

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }
}

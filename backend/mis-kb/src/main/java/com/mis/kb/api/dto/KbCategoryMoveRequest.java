package com.mis.kb.api.dto;

/**
 * 移动分类节点入参。
 *
 * @param newParentId 目标父节点 id；{@code null} 表示移为根分类
 */
public record KbCategoryMoveRequest(Long newParentId) {
}

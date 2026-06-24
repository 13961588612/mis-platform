package com.mis.common.jpa.datascope;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 根据角色 {@code data_scope} 构建 JPA {@link Specification}（ADR-015）。
 * <p>
 * 预设范围（2/3/6）以员工<strong>全部在任任职</strong>（{@code sys_employee_post → sys_post.dept_id}）
 * 为锚点，自动并集多部门、多组织，<strong>不做任职上下文切换</strong>。
 * <ul>
 *   <li>{@link #SCOPE_DEPT}：全部任职部门</li>
 *   <li>{@link #SCOPE_DEPT_AND_CHILD}：各任职部门子树并集</li>
 *   <li>{@link #SCOPE_ORG}：任职涉及的全部组织</li>
 *   <li>{@link #SCOPE_CUSTOM}：角色配置的 {@code perm_type='org'|'dept'}</li>
 * </ul>
 */
public final class DataScopeSpecification {

    public static final int SCOPE_ALL = 1;
    public static final int SCOPE_DEPT = 2;
    public static final int SCOPE_DEPT_AND_CHILD = 3;
    public static final int SCOPE_SELF = 4;
    public static final int SCOPE_CUSTOM = 5;
    /** 任职涉及的全部组织（非单组织） */
    public static final int SCOPE_ORG = 6;

    private DataScopeSpecification() {
    }

    public static <T> Specification<T> of(DataScopeContext context, String deptField, String userField) {
        return of(context, deptField, "", userField);
    }

    public static <T> Specification<T> of(
            DataScopeContext context, String deptField, String orgField, String userField) {
        return (root, query, cb) -> buildPredicate(root, cb, context, deptField, orgField, userField);
    }

    private static <T> Predicate buildPredicate(
            Root<T> root,
            CriteriaBuilder cb,
            DataScopeContext context,
            String deptField,
            String orgField,
            String userField) {

        if (context == null || context.dataScope() == SCOPE_ALL) {
            return cb.conjunction();
        }

        return switch (context.dataScope()) {
            case SCOPE_DEPT -> buildDeptIn(root, cb, deptField, context.assignedDeptIds());
            case SCOPE_DEPT_AND_CHILD -> buildDeptIn(root, cb, deptField, context.assignedDeptSubtreeIds());
            case SCOPE_SELF -> cb.equal(root.get(userField), context.userId());
            case SCOPE_ORG -> buildOrgScope(root, cb, deptField, orgField, context);
            case SCOPE_CUSTOM -> buildCustomScope(root, cb, deptField, orgField, context);
            default -> cb.conjunction();
        };
    }

    private static <T> Predicate buildOrgScope(
            Root<T> root,
            CriteriaBuilder cb,
            String deptField,
            String orgField,
            DataScopeContext context) {
        if (StringUtils.hasText(orgField) && isNotEmpty(context.assignedOrgIds())) {
            return root.get(orgField).in(context.assignedOrgIds());
        }
        Collection<Long> deptIds = context.deptIdsInAssignedOrgs();
        if (!isNotEmpty(deptIds)) {
            return cb.disjunction();
        }
        return buildDeptIn(root, cb, deptField, deptIds);
    }

    private static <T> Predicate buildCustomScope(
            Root<T> root,
            CriteriaBuilder cb,
            String deptField,
            String orgField,
            DataScopeContext context) {
        List<Predicate> orParts = new ArrayList<>();

        if (StringUtils.hasText(orgField) && isNotEmpty(context.customOrgIds())) {
            orParts.add(root.get(orgField).in(context.customOrgIds()));
        }
        if (StringUtils.hasText(deptField)) {
            Set<Long> deptIds = new HashSet<>();
            if (isNotEmpty(context.customDeptIds())) {
                deptIds.addAll(context.customDeptIds());
            }
            if (isNotEmpty(context.deptIdsForCustomOrgs())) {
                deptIds.addAll(context.deptIdsForCustomOrgs());
            }
            if (!deptIds.isEmpty()) {
                orParts.add(root.get(deptField).in(deptIds));
            }
        }

        if (orParts.isEmpty()) {
            return cb.disjunction();
        }
        return cb.or(orParts.toArray(Predicate[]::new));
    }

    private static <T> Predicate buildDeptIn(
            Root<T> root, CriteriaBuilder cb, String deptField, Collection<Long> deptIds) {
        if (!StringUtils.hasText(deptField) || !isNotEmpty(deptIds)) {
            return cb.disjunction();
        }
        return root.get(deptField).in(deptIds);
    }

    private static boolean isNotEmpty(Collection<?> collection) {
        return collection != null && !collection.isEmpty();
    }

    public static <T> Specification<T> and(Specification<T> base, Specification<T> dataScope) {
        List<Specification<T>> specs = new ArrayList<>();
        if (base != null) {
            specs.add(base);
        }
        if (dataScope != null) {
            specs.add(dataScope);
        }
        if (specs.isEmpty()) {
            return (root, query, cb) -> cb.conjunction();
        }
        Specification<T> combined = specs.get(0);
        for (int i = 1; i < specs.size(); i++) {
            combined = combined.and(specs.get(i));
        }
        return combined;
    }

    /**
     * 数据权限上下文（由 mis-rbac / 领域服务根据角色 + 员工任职计算后填入）。
     *
     * @param assignedDeptIds         在任任职的全部部门（{@code sys_employee_post → post.dept_id}）
     * @param assignedOrgIds          上述部门所属组织 ID 去重
     * @param assignedDeptSubtreeIds  {@link #SCOPE_DEPT_AND_CHILD}：各任职部门子树 ID 并集
     * @param deptIdsInAssignedOrgs   {@link #SCOPE_ORG}：assigned 组织下全部部门（实体无 org 列时用）
     * @param customOrgIds            {@link #SCOPE_CUSTOM}：{@code perm_type='org'}
     * @param deptIdsForCustomOrgs    {@link #SCOPE_CUSTOM}：customOrgIds 下全部部门
     */
    public record DataScopeContext(
            Long userId,
            int dataScope,
            Collection<Long> assignedDeptIds,
            Collection<Long> assignedOrgIds,
            Collection<Long> assignedDeptSubtreeIds,
            Collection<Long> deptIdsInAssignedOrgs,
            Collection<Long> customDeptIds,
            Collection<Long> customOrgIds,
            Collection<Long> deptIdsForCustomOrgs
    ) {
    }
}

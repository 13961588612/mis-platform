package com.mis.common.jpa.datascope;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import org.springframework.data.jpa.domain.Specification;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * 根据角色 {@code data_scope} 构建 JPA {@link Specification}（ADR-015）。
 * <p>
 * 调用方在领域服务中传入当前用户上下文与 scope 计算结果。
 */
public final class DataScopeSpecification {

    public static final int SCOPE_ALL = 1;
    public static final int SCOPE_DEPT = 2;
    public static final int SCOPE_DEPT_AND_CHILD = 3;
    public static final int SCOPE_SELF = 4;
    public static final int SCOPE_CUSTOM = 5;

    private DataScopeSpecification() {
    }

    public static <T> Specification<T> of(DataScopeContext context, String deptField, String userField) {
        return (root, query, cb) -> buildPredicate(root, cb, context, deptField, userField);
    }

    private static <T> Predicate buildPredicate(
            Root<T> root,
            CriteriaBuilder cb,
            DataScopeContext context,
            String deptField,
            String userField) {

        if (context == null || context.dataScope() == SCOPE_ALL) {
            return cb.conjunction();
        }

        return switch (context.dataScope()) {
            case SCOPE_DEPT -> cb.equal(root.get(deptField), context.userDeptId());
            case SCOPE_DEPT_AND_CHILD -> root.get(deptField).in(context.deptIdsInScope());
            case SCOPE_SELF -> cb.equal(root.get(userField), context.userId());
            case SCOPE_CUSTOM -> root.get(deptField).in(context.customDeptIds());
            default -> cb.conjunction();
        };
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
     * 数据权限上下文（由 mis-rbac / 领域服务根据角色计算后填入）。
     */
    public record DataScopeContext(
            Long userId,
            Long userDeptId,
            int dataScope,
            Collection<Long> deptIdsInScope,
            Collection<Long> customDeptIds
    ) {
    }
}

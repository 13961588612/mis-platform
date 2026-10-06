package com.mis.iqd.domain.service;

import com.mis.iqd.api.dto.IqdDimensionResolveVO;
import com.mis.iqd.domain.entity.IqdDimensionValueMap;
import com.mis.iqd.domain.repository.IqdDimensionValueMapRepository;
import com.mis.iqd.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * ????????? MIS ????? id / ?? id???????????????????
 *
 * <p>????????????
 * <ul>
 *   <li><b>store</b>?{@code mis_value} ??? ? ????????????? ? empty?fail-closed??</li>
 *   <li><b>dept</b>?????????????????????????????????????
 *       ??????? ? ?????????????????????????? ? ?? dropped?</li>
 * </ul>
 *
 * <p>????? MIS ??????????????
 */
@Service
public class IqdDimensionValueResolveService {

    /** ??????????????????dept?? */
    private static final String DIM_DEPT = "dept";

    private final IqdDimensionValueMapRepository mapRepository;
    private final IqdDeptSubtreeLookup deptSubtreeLookup;

    public IqdDimensionValueResolveService(
            IqdDimensionValueMapRepository mapRepository,
            IqdDeptSubtreeLookup deptSubtreeLookup) {
        this.mapRepository = mapRepository;
        this.deptSubtreeLookup = deptSubtreeLookup;
    }

    /**
     * ???? MIS ? ? ???????
     *
     * @param connectionId ????????????
     * @param dimensionCode ????dept / store / ...?
     * @param misValues     MIS ?????header ???? id?
     */
    @Transactional(readOnly = true)
    public IqdDimensionResolveVO resolve(Long connectionId, String dimensionCode, List<String> misValues) {
        List<String> values = (misValues == null ? List.<String>of() : misValues).stream()
                .map(v -> v == null ? "" : v.trim())
                .filter(v -> !v.isEmpty())
                .distinct()
                .toList();

        Set<String> resolved = new LinkedHashSet<>();
        List<String> dropped = new ArrayList<>();

        if (values.isEmpty()) {
            return new IqdDimensionResolveVO(connectionId, dimensionCode, List.of(), List.of(), true);
        }

        boolean dept = DIM_DEPT.equalsIgnoreCase(dimensionCode);
        for (String misValue : values) {
            if (dept) {
                resolveDeptAnchor(connectionId, misValue, resolved, dropped);
            } else {
                resolveFlatValue(connectionId, dimensionCode, misValue, resolved, dropped);
            }
        }

        List<String> out = new ArrayList<>(resolved);
        return new IqdDimensionResolveVO(connectionId, dimensionCode, out, dropped, out.isEmpty());
    }

    /**
     * dept???????????????????
     *
     * <p>????? {@code dept_path} ?????? ? ????????????????
     * ??????????? MIS ???????????????????
     */
    private void resolveDeptAnchor(
            Long connectionId, String anchorDeptId,
            Set<String> resolved, List<String> dropped) {
        List<IqdDeptSubtreeLookup.DeptNode> nodes = deptSubtreeLookup.subtreeNodes(anchorDeptId);
        if (nodes.isEmpty()) {
            dropped.add(anchorDeptId);
            return;
        }
        List<String> ids = nodes.stream().map(IqdDeptSubtreeLookup.DeptNode::id).toList();
        Map<String, List<IqdDimensionValueMap>> byMisValue = mapRepository
                .findByConnectionIdAndDimensionCodeAndMisValueIn(connectionId, DIM_DEPT, ids)
                .stream()
                .filter(m -> m.getEffective() == null || m.getEffective() == 1)
                .filter(m -> m.getExternalValue() != null && !m.getExternalValue().isBlank())
                .collect(Collectors.groupingBy(IqdDimensionValueMap::getMisValue));

        List<String> coveringPaths = new ArrayList<>();
        boolean any = false;
        for (IqdDeptSubtreeLookup.DeptNode node : nodes) {
            if (coveredBySelectedAncestor(node.path(), coveringPaths)) {
                continue;
            }
            List<IqdDimensionValueMap> rows = byMisValue.get(node.id());
            if (rows == null || rows.isEmpty()) {
                continue;
            }
            boolean covers = false;
            for (IqdDimensionValueMap m : rows) {
                resolved.add(m.getExternalValue().trim());
                if (m.getCoversSubtree() == null || m.getCoversSubtree() == 1) {
                    covers = true;
                }
            }
            // ?????????????? MIS ?? ? ??????
            // covers_subtree=0???????????????????????
            if (covers && node.path() != null && !node.path().isBlank()) {
                coveringPaths.add(node.path());
            }
            any = true;
        }
        if (!any) {
            dropped.add(anchorDeptId);
        }
    }

    /** ?????????????????node ????????????????? */
    private static boolean coveredBySelectedAncestor(String nodePath, List<String> coveringPaths) {
        if (nodePath == null || nodePath.isBlank()) {
            return false;
        }
        for (String ancestorPath : coveringPaths) {
            if (ancestorPath != null
                    && nodePath.length() > ancestorPath.length()
                    && nodePath.startsWith(ancestorPath)) {
                return true;
            }
        }
        return false;
    }

    /** store ??????????? mis_value???? ? ?????????? */
    private void resolveFlatValue(
            Long connectionId, String dimensionCode, String misValue,
            Set<String> resolved, List<String> dropped) {
        List<IqdDimensionValueMap> rows = mapRepository
                .findByConnectionIdAndDimensionCodeAndMisValueIn(
                        connectionId, dimensionCode, List.of(misValue))
                .stream()
                .filter(m -> m.getEffective() == null || m.getEffective() == 1)
                .filter(m -> m.getExternalValue() != null && !m.getExternalValue().isBlank())
                .toList();
        if (rows.isEmpty()) {
            dropped.add(misValue);
            return;
        }
        rows.forEach(m -> resolved.add(m.getExternalValue().trim()));
    }

    /** CRUD?????????????????? */
    @Transactional(readOnly = true)
    public List<IqdDimensionValueMap> list(Long connectionId, String dimensionCode) {
        if (dimensionCode != null && !dimensionCode.isBlank()) {
            return mapRepository.findByConnectionIdAndDimensionCodeOrderByMisValueAscIdAsc(
                    connectionId, dimensionCode);
        }
        return mapRepository.findByConnectionIdOrderByDimensionCodeAscMisValueAscIdAsc(connectionId);
    }

    /**
     * CRUD?? (connection, dimension, mis_value, external_value) ?? upsert?
     */
    @Transactional
    public IqdDimensionValueMap save(
            Long connectionId, String dimensionCode, String misValue,
            String externalValue, Boolean effective, Boolean coversSubtree, String remark) {
        if (connectionId == null) {
            throw new IllegalArgumentException("connection_id is required");
        }
        if (dimensionCode == null || dimensionCode.isBlank()) {
            throw new IllegalArgumentException("dimension_code is required");
        }
        if (misValue == null || misValue.isBlank()) {
            throw new IllegalArgumentException("mis_value is required");
        }
        if (externalValue == null || externalValue.isBlank()) {
            throw new IllegalArgumentException("external_value is required");
        }
        String dim = dimensionCode.trim();
        String mv = misValue.trim();
        String ev = externalValue.trim();
        if (ev.matches("(?s).*[\\u0000-\\u001f].*")) {
            throw new IllegalArgumentException("external_value contains control characters");
        }
        IqdDimensionValueMap row = mapRepository
                .findByConnectionIdAndDimensionCodeAndMisValueAndExternalValue(connectionId, dim, mv, ev)
                .orElseGet(IqdDimensionValueMap::new);
        if (row.getId() == null) {
            row.setId(IdGenerator.nextId());
            row.setConnectionId(connectionId);
            row.setDimensionCode(dim);
            row.setMisValue(mv);
            row.setExternalValue(ev);
            row.setCreatedAt(Instant.now());
        }
        row.setEffective(Boolean.FALSE.equals(effective) ? 0 : 1);
        // ??????????? ? 1
        row.setCoversSubtree(Boolean.FALSE.equals(coversSubtree) ? 0 : 1);
        row.setRemark(remark);
        row.setUpdatedAt(Instant.now());
        return mapRepository.save(row);
    }

    /** CRUD???????? */
    @Transactional
    public void delete(Long id) {
        mapRepository.deleteById(id);
    }
}

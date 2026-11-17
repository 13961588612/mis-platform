package com.mis.adminbff.service.agentops;

import com.mis.adminbff.dto.agentops.SkillCategoryVO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 技能分类邻接表 → 树；环检测。 */
final class SkillCategoryTrees {

    static final long ROOT_PARENT_ID = 0L;

    private SkillCategoryTrees() {}

    static List<SkillCategoryVO> build(List<SkillCategoryVO> flat) {
        Map<Long, List<SkillCategoryVO>> byParent = new HashMap<>();
        for (SkillCategoryVO row : flat) {
            Long parent = row.getParentId() == null ? ROOT_PARENT_ID : row.getParentId();
            byParent.computeIfAbsent(parent, k -> new ArrayList<>()).add(row);
        }
        return attach(ROOT_PARENT_ID, byParent);
    }

    private static List<SkillCategoryVO> attach(Long parentId, Map<Long, List<SkillCategoryVO>> byParent) {
        List<SkillCategoryVO> level = byParent.getOrDefault(parentId, List.of());
        for (SkillCategoryVO node : level) {
            node.setChildren(attach(node.getId(), byParent));
        }
        return level;
    }

    /**
     * @param parentById id → parent_id（不含待写入的新 parent）
     * @param movingId   正在改父节点的分类；新建时为 null
     */
    static boolean wouldCycle(Map<Long, Long> parentById, Long movingId, Long newParentId) {
        if (newParentId == null || newParentId.equals(ROOT_PARENT_ID)) {
            return false;
        }
        if (movingId != null && movingId.equals(newParentId)) {
            return true;
        }
        Long cursor = newParentId;
        int guard = 0;
        while (cursor != null && !cursor.equals(ROOT_PARENT_ID) && guard++ < 64) {
            if (movingId != null && movingId.equals(cursor)) {
                return true;
            }
            cursor = parentById.get(cursor);
        }
        return false;
    }
}

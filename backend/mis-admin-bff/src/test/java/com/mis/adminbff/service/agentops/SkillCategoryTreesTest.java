package com.mis.adminbff.service.agentops;

import com.mis.adminbff.dto.agentops.SkillCategoryVO;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SkillCategoryTreesTest {

    @Test
    void buildNestsChildren() {
        SkillCategoryVO root = row(1L, 0L, "超市");
        SkillCategoryVO child = row(2L, 1L, "成文");
        List<SkillCategoryVO> tree = SkillCategoryTrees.build(List.of(root, child));
        assertEquals(1, tree.size());
        assertEquals("超市", tree.get(0).getName());
        assertEquals(1, tree.get(0).getChildren().size());
        assertEquals("成文", tree.get(0).getChildren().get(0).getName());
    }

    @Test
    void cycleWhenMovingUnderOwnChild() {
        Map<Long, Long> parents = Map.of(1L, 0L, 2L, 1L);
        assertTrue(SkillCategoryTrees.wouldCycle(parents, 1L, 2L));
        assertFalse(SkillCategoryTrees.wouldCycle(parents, 2L, 0L));
        assertFalse(SkillCategoryTrees.wouldCycle(parents, null, 1L));
    }

    private static SkillCategoryVO row(Long id, Long parentId, String name) {
        SkillCategoryVO vo = new SkillCategoryVO();
        vo.setId(id);
        vo.setParentId(parentId);
        vo.setName(name);
        vo.setSortOrder(0);
        return vo;
    }
}

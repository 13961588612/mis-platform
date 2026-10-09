package com.mis.taskflow.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link TaskflowStatus} 单测（P1）：状态枚举冻结清单无重复、无空值。
 */
class TaskflowStatusTest {

    @Test
    @DisplayName("P1：各分组状态码唯一且非空")
    void frozenStatusCodes() throws Exception {
        assertUnique(TaskflowStatus.Task.class);
        assertUnique(TaskflowStatus.Instance.class);
        assertUnique(TaskflowStatus.PostProcess.class);
        assertUnique(TaskflowStatus.Execution.class);
        assertUnique(TaskflowStatus.Lock.class);
    }

    @Test
    @DisplayName("P1：代办任务状态与冻结清单一致")
    void taskStatusValues() {
        assertEquals("PENDING", TaskflowStatus.Task.PENDING);
        assertEquals("APPROVING", TaskflowStatus.Task.APPROVING);
        assertEquals("APPROVED", TaskflowStatus.Task.APPROVED);
        assertEquals("REJECTED", TaskflowStatus.Task.REJECTED);
        assertEquals("EXPIRED", TaskflowStatus.Task.EXPIRED);
        assertEquals("CANCELLED", TaskflowStatus.Task.CANCELLED);
    }

    private void assertUnique(Class<?> clazz) throws Exception {
        Set<String> seen = new HashSet<>();
        Field[] fields = clazz.getDeclaredFields();
        for (Field f : fields) {
            if (f.getType() != String.class || !java.lang.reflect.Modifier.isStatic(f.getModifiers())) {
                continue;
            }
            String v = (String) f.get(null);
            assertTrue(v != null && !v.isBlank(), f.getName() + " 不应为空");
            assertTrue(seen.add(v), "状态码重复: " + v);
        }
        assertTrue(!seen.isEmpty(), clazz.getSimpleName() + " 至少应有一个状态码");
    }
}
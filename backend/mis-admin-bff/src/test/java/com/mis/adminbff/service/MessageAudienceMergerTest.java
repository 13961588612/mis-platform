package com.mis.adminbff.service;

import com.mis.common.core.exception.BusinessException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MessageAudienceMergerTest {

    @Test
    void unionsAndDedupes() {
        List<Long> ids = MessageAudienceMerger.merge(true, List.of(1L, 2L), List.of(2L, 3L), List.of(3L, 4L));
        assertEquals(List.of(1L, 2L, 3L, 4L), ids);
    }

    @Test
    void rejectsEmpty() {
        assertThrows(BusinessException.class, () -> MessageAudienceMerger.merge(false, List.of(), List.of(), List.of()));
    }
}

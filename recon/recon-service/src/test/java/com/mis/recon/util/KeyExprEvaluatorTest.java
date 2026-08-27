package com.mis.recon.util;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * record_key 模板求值单测。
 */
class KeyExprEvaluatorTest {

    @Test
    void singleKey() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("order_no", "A1001");
        assertEquals("A1001", KeyExprEvaluator.evaluate("{order_no}", row));
    }

    @Test
    void compositeKeyWithSeparator() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("order_no", "A1001");
        row.put("pay_channel", "wx");
        assertEquals("A1001_wx", KeyExprEvaluator.evaluate("{order_no}_{pay_channel}", row));
    }

    @Test
    void missingFieldReturnsNull() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("order_no", "A1001");
        assertNull(KeyExprEvaluator.evaluate("{order_no}_{pay_channel}", row));
    }

    @Test
    void nullRowOrExprReturnsNull() {
        assertNull(KeyExprEvaluator.evaluate(null, Map.of()));
        assertNull(KeyExprEvaluator.evaluate("{order_no}", null));
    }

    @Test
    void extractFieldsOrder() {
        assertEquals(List.of("order_no", "pay_channel"),
                KeyExprEvaluator.extractFields("{order_no}_{pay_channel}"));
    }
}

package com.mis.kb.engine;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class RagflowParseStatusMapperTest {

    @Test
    void mapsStringRunValues() {
        assertEquals("success", RagflowParseStatusMapper.toParseStatus("DONE", 1.0));
        assertEquals("parsing", RagflowParseStatusMapper.toParseStatus("RUNNING", 0.4));
        assertEquals("pending", RagflowParseStatusMapper.toParseStatus("UNSTART", 0.0));
        assertEquals("failed", RagflowParseStatusMapper.toParseStatus("FAIL", 0.2));
        assertEquals("failed", RagflowParseStatusMapper.toParseStatus("CANCEL", null));
    }

    @Test
    void mapsNumericRunValues() {
        assertEquals("success", RagflowParseStatusMapper.toParseStatus("3", null));
        assertEquals("parsing", RagflowParseStatusMapper.toParseStatus("1", null));
        assertEquals("pending", RagflowParseStatusMapper.toParseStatus("0", null));
        assertEquals("failed", RagflowParseStatusMapper.toParseStatus("4", null));
    }

    @Test
    void fallsBackToProgress() {
        assertEquals("success", RagflowParseStatusMapper.toParseStatus(null, 1.0));
        assertEquals("parsing", RagflowParseStatusMapper.toParseStatus(null, 0.5));
        assertEquals("pending", RagflowParseStatusMapper.toParseStatus(null, 0.0));
        assertNull(RagflowParseStatusMapper.toParseStatus(null, null));
    }
}

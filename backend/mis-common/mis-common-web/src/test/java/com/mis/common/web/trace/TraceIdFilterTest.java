package com.mis.common.web.trace;

import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.constant.TraceConstants;
import com.mis.common.core.util.TraceIdUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = TraceIdFilterTest.TestApplication.class)
@AutoConfigureMockMvc
class TraceIdFilterTest {

  @Autowired
  private MockMvc mockMvc;

  @AfterEach
  void clearMdc() {
    MDC.clear();
  }

  @Test
  void generatesTraceIdWhenHeaderMissing() throws Exception {
    mockMvc.perform(get("/test/trace"))
        .andExpect(status().isOk())
        .andExpect(header().exists(SecurityConstants.HEADER_TRACE_ID))
        .andExpect(jsonPath("$.traceId").isNotEmpty());
  }

  @Test
  void reusesClientTraceId() throws Exception {
    String clientTraceId = "abc123traceid0001";
    mockMvc.perform(get("/test/trace")
            .header(SecurityConstants.HEADER_TRACE_ID, clientTraceId))
        .andExpect(status().isOk())
        .andExpect(header().string(SecurityConstants.HEADER_TRACE_ID, clientTraceId))
        .andExpect(jsonPath("$.traceId").value(clientTraceId));
  }

  @Test
  void traceIdUtilsGenerates32Hex() {
    String id = TraceIdUtils.generate();
    assertThat(id).hasSize(32).matches("[0-9a-f]+");
  }

  @Import({com.mis.common.web.config.MisWebAutoConfiguration.class, TestController.class})
  @org.springframework.boot.autoconfigure.SpringBootApplication
  static class TestApplication {
  }

  @RestController
  static class TestController {

    @GetMapping(value = "/test/trace", produces = MediaType.APPLICATION_JSON_VALUE)
    public com.mis.common.core.result.Result<String> trace() {
      String traceId = TraceContext.currentTraceId();
      com.mis.common.core.result.Result<String> result = com.mis.common.core.result.Result.ok(traceId);
      result.setTraceId(traceId);
      return result;
    }
  }
}

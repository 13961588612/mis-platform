package com.mis.common.web.trace;

import com.mis.common.core.constant.TraceConstants;
import org.slf4j.MDC;

/**
 * 当前请求的 traceId（由 {@link TraceIdFilter} 写入 MDC）。
 */
public final class TraceContext {

  private TraceContext() {
  }

  public static String currentTraceId() {
    return MDC.get(TraceConstants.MDC_TRACE_ID);
  }
}

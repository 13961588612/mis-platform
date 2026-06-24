package com.mis.common.core.constant;

/**
 * 链路追踪相关常量（MDC 键名等）。
 * <p>
 * Filter / 日志配置在 {@code mis-common-web}；本模块仅保留协议常量。
 */
public final class TraceConstants {

  /** SLF4J MDC 中 traceId 的键名，logback 可通过 {@code %X{traceId}} 输出 */
  public static final String MDC_TRACE_ID = "traceId";

  private TraceConstants() {
  }
}

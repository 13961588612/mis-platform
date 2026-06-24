package com.mis.common.core.util;

import java.util.UUID;

/**
 * 生成链路 ID（纯 Java，供 Gateway / Web Filter 调用）。
 */
public final class TraceIdUtils {

  private TraceIdUtils() {
  }

  /** 32 位十六进制，无连字符 */
  public static String generate() {
    return UUID.randomUUID().toString().replace("-", "");
  }
}

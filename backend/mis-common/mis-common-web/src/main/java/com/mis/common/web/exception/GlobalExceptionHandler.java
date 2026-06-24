package com.mis.common.web.exception;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.common.web.trace.TraceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 统一异常转 {@link Result}，并填充 traceId。
 * <p>
 * Phase 1：业务异常 HTTP 200 + body.code；认证/权限类可用 HTTP 状态码。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(BusinessException.class)
  public ResponseEntity<Result<Void>> handleBusinessException(BusinessException ex) {
    return ResponseEntity.ok(withTrace(Result.fail(ex.getCode(), ex.getMessage())));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Result<Void>> handleValidation(MethodArgumentNotValidException ex) {
    String message = ex.getBindingResult().getFieldErrors().stream()
        .findFirst()
        .map(error -> error.getField() + ": " + error.getDefaultMessage())
        .orElse(ResultCode.VALIDATION_ERROR.getMessage());
    return ResponseEntity.ok(withTrace(Result.fail(ResultCode.VALIDATION_ERROR.getCode(), message)));
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<Result<Void>> handleAccessDenied(AccessDeniedException ex) {
    return ResponseEntity
        .status(HttpStatus.FORBIDDEN)
        .body(withTrace(Result.fail(ResultCode.FORBIDDEN)));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Result<Void>> handleException(Exception ex) {
    log.error("Unhandled exception", ex);
    return ResponseEntity
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(withTrace(Result.fail(ResultCode.INTERNAL_ERROR)));
  }

  private static <T> Result<T> withTrace(Result<T> result) {
    result.setTraceId(TraceContext.currentTraceId());
    return result;
  }
}

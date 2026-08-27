/**
 * 结构化错误：携带后端业务码 {@link code}，供字段级红字按码映射（T6）。
 *
 * <p>后端统一返回 {@code Result{code,message,data}}，前端 {@code unwrap} 在 code≠0 时抛出本错误，
 * 调用方（如 onSave）通过 {@code e instanceof ApiError} 与 {@code e.code} 精确挂载错误到对应字段。</p>
 */
export class ApiError extends Error {
  /** 后端业务码（5 位 int，如 40901=用户名冲突 / 40918=手机冲突 / 40001=参数校验） */
  readonly code: number;

  constructor(code: number, message: string) {
    super(message || `请求失败 (code=${code})`);
    this.name = 'ApiError';
    this.code = code;
    // 还原原型链，保证 `instanceof ApiError` 在转译后仍然成立
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

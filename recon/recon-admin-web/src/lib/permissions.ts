/**
 * recon 权限码常量表（阶段 3）。
 * <p>
 * 命名遵循平台约定 {@code 模块:资源:动作}；平台侧 sys_menu 需按此清单配置并授权，
 * 壳子下发的 permissions 才会包含对应码。当前未配置时：独立运行放行、壳内按未授权隐藏。
 */
export const P = {
  CONNECTION: {
    WRITE: 'recon:connection:write',
    DELETE: 'recon:connection:delete',
  },
  DATASOURCE: {
    WRITE: 'recon:datasource:write',
    DELETE: 'recon:datasource:delete',
    PULL: 'recon:datasource:pull',
  },
  SCENARIO: {
    WRITE: 'recon:scenario:write',
    DELETE: 'recon:scenario:delete',
    RUN: 'recon:scenario:run',
  },
  DIFF: {
    CONFIRM: 'recon:diff:confirm',
  },
  REPORT: {
    SEND: 'recon:report:send',
  },
} as const;

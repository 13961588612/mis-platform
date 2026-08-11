/**
 * 门户 / 顶部应用切换器的分组显示名（sys_app.portal_group → 中文名）。
 *
 * <p>portal-page.tsx 与 app-layout.tsx 共用，避免两处各自硬编码导致漂移。
 * 分组 key 与后端 sys_app.portal_group 取值一一对应：
 * governance（管理与治理）/ operations（业务与运营）/ platform（协同与平台）/
 * ai（AI助手，kb + agent 归组，见 V28__portal_ai_group.sql）。
 */
export const APP_GROUP_LABEL: Record<string, string> = {
  governance: '管理与治理',
  operations: '业务与运营',
  platform: '协同与平台',
  ai: 'AI助手',
};

/**
 * SurfacePermissionFilter.ts — A2UI 渲染权限过滤（Gateway 权威安全边界）
 *
 * D5/D6：前端 registry 仅 UX 层，Gateway `SHARED_CATALOG` 为权威源；渲染权限
 * 以用户权限码集合（Redis `mis:acl:skillperm:{userId}` TTL 60s，三端共享）判定，
 * 未命中回退 BFF `GET /internal/permissions` 反查（X-Platform-Token 反向信任），
 * 两级缓存回退（02-task-breakdown.md §5.3 / 03-permission-design.md §2）。
 *
 * 判定流程：
 * 1. 获取用户权限码集合（Redis → BFF 两级回退）
 * 2. 遍历每个 updateComponents operation 的 components 数组：
 *    - 组件声明 requiredPermission：有权限 → 保留；无权限 → 组件级 Text 占位
 *    - 容器根组件（approval-card）无权限 → 整卡占位（聚合缺失权限码列表）
 *    - 未声明 requiredPermission → 默认可见，原样保留
 * 3. 权限源不可用（40303/超时/非 2xx）→ fail-closed：受控组件降级
 *    「权限服务暂时不可用」，不写缓存
 *
 * @module a2ui/SurfacePermissionFilter
 */

import axios, { type AxiosInstance } from 'axios';
import type { Redis } from 'ioredis';
import { getComponentSpec } from './catalog.js';
import {
  type A2UIFrontendMessage,
  type A2UISurfaceMessage,
  A2UIOperation,
  skillPermissionKey,
  SKILL_PERMISSION_TTL_SEC,
  ERROR_ACL_UNAVAILABLE,
  ERROR_FORBIDDEN,
} from './types.js';
import { logger } from '../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/** SurfacePermissionFilter 构造参数 */
export interface SurfacePermissionFilterConfig {
  /** Redis 客户端（权限缓存读/回填） */
  redis: Redis;
  /** BFF 内网基址，如 `http://mis-admin-bff:8080` */
  bffInternalUrl: string;
  /** BFF 反向信任令牌（X-Platform-Token 共享密钥；为空则 BFF 回源视为不可用） */
  platformToken: string;
  /** BFF 请求超时（毫秒），默认 3000 */
  timeoutMs?: number;
}

/** 权限解析结果 */
interface PermissionResolution {
  /** 权限码集合；源不可用时为 null */
  permissions: Set<string> | null;
  /** 源是否可用（false = fail-closed） */
  sourceAvailable: boolean;
}

/** BFF /internal/permissions 统一响应信封 */
interface BffPermissionEnvelope {
  code?: number;
  data?: {
    codes?: unknown;
    permissions?: unknown;
    permissionCodes?: unknown;
  };
}

// ============================================================================
// SurfacePermissionFilter
// ============================================================================

/**
 * A2UI 渲染权限过滤器：下发 A2UI operations 前遍历组件树，无权限组件降级为占位。
 */
export class SurfacePermissionFilter {
  private readonly redis: Redis;
  private readonly http: AxiosInstance;
  private readonly hasPlatformToken: boolean;

  constructor(config: SurfacePermissionFilterConfig) {
    this.redis = config.redis;
    this.hasPlatformToken = config.platformToken.length > 0;
    this.http = axios.create({
      baseURL: config.bffInternalUrl.replace(/\/+$/, ''),
      timeout: config.timeoutMs ?? 3000,
      // 4xx/5xx 不抛异常，由调用方统一按「源不可用」处理
      validateStatus: () => true,
      headers: this.hasPlatformToken
        ? { 'X-Platform-Token': config.platformToken }
        : {},
    });
  }

  /**
   * 过滤 A2UI 前端消息（入口）。
   *
   * - 非 `a2ui_surface` 消息（stream/done/error/custom）原样透传。
   * - `a2ui_surface` 消息：对 operations 逐条过滤组件权限。
   *
   * @param message - A2UIRuntime 转换出的前端消息
   * @param userId - 用户 ID（**来自 JWT 验签结果**，P4）
   * @param sessionId - 会话 ID（仅日志/审计维度）
   * @returns 过滤后的消息；调用方应忽略 null（本实现不返回 null，保留透传）
   */
  async filter(
    message: A2UIFrontendMessage,
    userId: string,
    sessionId: string,
  ): Promise<A2UIFrontendMessage> {
    if (message.type !== 'a2ui_surface') {
      return message;
    }

    const resolution = await this.getPermissionSet(userId);
    if (resolution.permissions == null) {
      logger.warn(
        { userId, sessionId, errorCode: ERROR_ACL_UNAVAILABLE },
        'Permission source unavailable; fail-closed degrade of controlled components',
      );
    }

    const filtered: A2UISurfaceMessage = {
      ...message,
      sessionId,
      operations: message.operations.map((operation) =>
        resolution.permissions != null
          ? this.filterOperation(operation, resolution.permissions)
          : this.degradeOperationUnavailable(operation),
      ),
    };
    return filtered;
  }

  // ============================================================================
  // 权限码获取（两级缓存回退）
  // ============================================================================

  /**
   * 获取用户权限码集合（Redis → BFF 两级回退）。
   *
   * @param userId - 用户 ID
   * @returns 权限解析结果（permissions=null 表示源不可用 → fail-closed）
   */
  private async getPermissionSet(userId: string): Promise<PermissionResolution> {
    const key = skillPermissionKey(userId);

    // 一级：Redis 缓存（命中含空集 → 直接使用，不写缓存）
    try {
      const cached = await this.redis.get(key);
      if (cached != null) {
        return { permissions: parsePermissionValue(cached), sourceAvailable: true };
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), userId },
        'Permission cache read failed; falling back to BFF',
      );
      // Redis 故障视为未命中，回源 BFF（不写缓存）
    }

    // 二级：BFF /internal/permissions 反查
    const bffResult = await this.fetchFromBff(userId);

    // 成功（含空集）→ 回填缓存 60s（空集也写，防穿透）
    if (bffResult.permissions != null) {
      try {
        await this.redis.set(
          key,
          JSON.stringify([...bffResult.permissions]),
          'EX',
          SKILL_PERMISSION_TTL_SEC,
        );
        logger.debug(
          { userId, ttl: SKILL_PERMISSION_TTL_SEC, count: bffResult.permissions.size },
          'Permission cache backfilled from BFF',
        );
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error), userId },
          'Permission cache backfill failed (cache write is best-effort)',
        );
      }
      return bffResult;
    }

    // 源不可用 → fail-closed，不写缓存
    return { permissions: null, sourceAvailable: false };
  }

  /**
   * 从 BFF `GET /internal/permissions?userId={userId}` 反查权限码。
   *
   * 语义（03 §2.2 回退语义表）：
   * - 200 + code=0 + codes（含空集）→ 使用该集合
   * - 200 + code=40301（零权限/用户不存在）→ 合法空集
   * - 200 + code=40303（ACL_UNAVAILABLE）→ 源不可用（null）
   * - 非 200 / 超时 / 不可解析 → 源不可用（null）
   *
   * @param userId - 用户 ID
   * @returns 权限解析结果
   */
  private async fetchFromBff(userId: string): Promise<PermissionResolution> {
    if (!this.hasPlatformToken) {
      logger.warn(
        { userId },
        'BFF platform token not configured; permission reverse lookup unavailable (fail-closed)',
      );
      return { permissions: null, sourceAvailable: false };
    }

    try {
      const response = await this.http.get<BffPermissionEnvelope>('/internal/permissions', {
        params: { userId },
      });

      if (response.status !== 200) {
        logger.warn(
          { userId, status: response.status },
          'BFF permission lookup returned non-200; fail-closed',
        );
        return { permissions: null, sourceAvailable: false };
      }

      const body = response.data;
      if (body?.code === 0) {
        const codes = extractCodes(body);
        if (codes != null) {
          return { permissions: new Set(codes), sourceAvailable: true };
        }
        logger.warn(
          { userId, body },
          'BFF permission response unparseable; fail-closed',
        );
        return { permissions: null, sourceAvailable: false };
      }

      if (body?.code === ERROR_FORBIDDEN) {
        // 40301 = 用户零权限/不存在 → 合法空集（防穿透，写空缓存）
        logger.info(
          { userId, errorCode: ERROR_FORBIDDEN },
          'BFF permission lookup returned zero-permission; caching empty set',
        );
        return { permissions: new Set<string>(), sourceAvailable: true };
      }

      logger.warn(
        { userId, code: body?.code },
        'BFF permission lookup returned non-zero code; fail-closed',
      );
      return { permissions: null, sourceAvailable: false };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), userId },
        'BFF permission lookup failed; fail-closed',
      );
      return { permissions: null, sourceAvailable: false };
    }
  }

  // ============================================================================
  // 组件树过滤
  // ============================================================================

  /**
   * 过滤单个 A2UI operation（envelope `{ version, <one op> }`）。
   *
   * 只处理 updateComponents；createSurface / updateDataModel / deleteSurface 透传。
   *
   * @param operation - A2UI operation
   * @param permissions - 用户权限码集合
   * @returns 过滤后的 operation
   */
  private filterOperation(
    operation: A2UIOperation,
    permissions: Set<string>,
  ): A2UIOperation {
    const updateComponents = operation['updateComponents'];
    if (updateComponents == null || typeof updateComponents !== 'object' || Array.isArray(updateComponents)) {
      return operation;
    }

    const uc = updateComponents as Record<string, unknown>;
    const components = uc['components'];
    if (!Array.isArray(components)) {
      return operation;
    }

    const filteredComponents = components
      .filter(
        (component): component is Record<string, unknown> =>
          component != null && typeof component === 'object' && !Array.isArray(component),
      )
      .map((component) => this.filterComponent(component, permissions));

    return {
      ...operation,
      updateComponents: {
        ...uc,
        components: filteredComponents,
      },
    };
  }

  /**
   * 权限源不可用时的整条 operation 降级（fail-closed）。
   *
   * 受控组件（catalog 中声明 requiredPermission）一律降级为
   * 「权限服务暂时不可用」占位；未声明权限的组件默认可见，保持原样。
   *
   * @param operation - A2UI operation
   * @returns 降级后的 operation
   */
  private degradeOperationUnavailable(operation: A2UIOperation): A2UIOperation {
    const updateComponents = operation['updateComponents'];
    if (updateComponents == null || typeof updateComponents !== 'object' || Array.isArray(updateComponents)) {
      return operation;
    }

    const uc = updateComponents as Record<string, unknown>;
    const components = uc['components'];
    if (!Array.isArray(components)) {
      return operation;
    }

    const degradedComponents = components
      .filter(
        (component): component is Record<string, unknown> =>
          component != null && typeof component === 'object' && !Array.isArray(component),
      )
      .map((component) => {
        const name = String(component['component'] ?? '');
        const spec = getComponentSpec(name);
        if (spec?.requiredPermission == null) {
          // 未声明 requiredPermission → 默认可见，不受源不可用影响
          return component;
        }
        return this.makePlaceholder(component, spec.requiredPermission, spec.isContainerRoot === true, true);
      });

    return {
      ...operation,
      updateComponents: {
        ...uc,
        components: degradedComponents,
      },
    };
  }

  /**
   * 过滤单个组件：无权限 → 占位；未声明权限 → 默认可见。
   *
   * @param component - A2UI 组件（{ id, component, props?, ... }）
   * @param permissions - 用户权限码集合
   * @returns 过滤后的组件
   */
  private filterComponent(
    component: Record<string, unknown>,
    permissions: Set<string>,
  ): Record<string, unknown> {
    const name = String(component['component'] ?? '');
    const spec = getComponentSpec(name);

    // 未知组件（Gateway catalog 之外）：不注入 schema、不下发 → 占位
    if (spec == null) {
      logger.warn(
        { componentName: name },
        'A2UI component not in Gateway catalog; degraded to placeholder',
      );
      return this.makePlaceholder(component, name, false, false, '组件未注册');
    }

    const required = spec.requiredPermission;
    if (required == null) {
      // 缺省语义：未声明 requiredPermission = 默认可见
      return component;
    }

    if (permissions.has(required)) {
      return component;
    }

    // 无权限：容器根组件 → 整卡占位；否则组件级占位
    return this.makePlaceholder(component, required, spec.isContainerRoot === true, false);
  }

  /**
   * 构造占位组件（保留原 id，替换 component 类型为 Text）。
   *
   * 组件级占位（03 §2.3）：
   * ```
   * { id, component: 'Text', text: '无权限访问此内容（缺少权限码：X）', props: { missingPermissions: [X] } }
   * ```
   * 整卡占位：
   * ```
   * { id, component: 'Text', text: '无权限访问此卡片（缺少权限码：X）', props: { missingPermissions: [X], componentIds: [id] } }
   * ```
   *
   * @param component - 原组件
   * @param permissionCode - 缺失权限码
   * @param wholeCard - 是否整卡占位
   * @param sourceUnavailable - 权限源不可用（文案区分）
   * @param customText - 自定义文案（未知组件等）
   * @returns 占位组件
   */
  private makePlaceholder(
    component: Record<string, unknown>,
    permissionCode: string,
    wholeCard: boolean,
    sourceUnavailable: boolean,
    customText?: string,
  ): Record<string, unknown> {
    const id = typeof component['id'] === 'string' ? component['id'] : 'unknown';
    const text =
      customText ??
      (sourceUnavailable
        ? `权限服务暂时不可用（${permissionCode}）`
        : wholeCard
          ? `无权限访问此卡片（缺少权限码：${permissionCode}）`
          : `无权限访问此内容（缺少权限码：${permissionCode}）`);

    const placeholder: Record<string, unknown> = {
      id,
      component: 'Text',
      text,
      props: {
        ...(sourceUnavailable ? {} : { missingPermissions: [permissionCode] }),
        ...(wholeCard ? { componentIds: [id] } : {}),
      },
    };
    return placeholder;
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 BFF 响应中提取权限码数组（兼容 codes / permissions / permissionCodes 字段）。
 *
 * @param body - BFF 统一响应信封
 * @returns 权限码数组；不可解析返回 null
 */
function extractCodes(body: BffPermissionEnvelope): string[] | null {
  const data = body?.data;
  if (data == null) {
    return null;
  }
  const raw = data.codes ?? data.permissions ?? data.permissionCodes;
  if (!Array.isArray(raw)) {
    return null;
  }
  const codes: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.length > 0) {
      codes.push(item);
    }
  }
  return codes;
}

/**
 * 解析 Redis 缓存的权限码值。
 *
 * 兼容两种存储格式（三端共享 key，格式以 Java/Python 写入为准）：
 * - JSON 数组字符串：`["approval:view","approval:decide"]`
 * - 逗号分隔字符串：`approval:view,approval:decide`
 * 不可解析 → 空集（不抛错，安全降级为空权限）。
 *
 * @param cached - Redis 缓存原始值
 * @returns 权限码集合
 */
export function parsePermissionValue(cached: string): Set<string> {
  const value = cached.trim();
  if (value.length === 0) {
    return new Set<string>();
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed.filter((item): item is string => typeof item === 'string' && item.length > 0),
      );
    }
  } catch {
    // 非 JSON → 尝试逗号分隔
  }

  if (value.includes(',')) {
    return new Set(
      value
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code.length > 0),
    );
  }

  return new Set<string>();
}

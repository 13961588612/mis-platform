/**
 * A2UIRuntime.ts — A2UI 编排器（中间件创建 + runAgent 编排 + 用户操作回传）
 *
 * D1：Gateway 集成 `@ag-ui/a2ui-middleware` 完整中间件模式——自动注入 render_a2ui
 * 工具 + 组件 schema + LLM 指南 + 流式拦截 + 生成恢复循环 + 用户操作回传。
 *
 * 职责：
 * 1. 创建 A2UIMiddleware（schema / injectA2UITool / defaultCatalogId / recovery）
 * 2. `runAgent`：RunAgentInput → RedisStreamAgent → middleware.run → 事件流
 *    （EventConverter 转前端消息 → SurfacePermissionFilter 过滤 → H5Adapter 下发）
 * 3. `processUserAction`：前端 `{ type: 'a2ui_action', action }` → 转为
 *    `RunAgentInput.forwardedProps.a2uiAction.userAction` → 新一轮 Agent 执行
 *
 * @module a2ui/A2UIRuntime
 */

import crypto from 'node:crypto';
import { Observable } from 'rxjs';
import type { RunAgentInput, BaseEvent, AGUIEvent } from '@ag-ui/client';
import { A2UIMiddleware, RENDER_A2UI_TOOL_NAME, type A2UIInlineCatalogSchema, type A2UIUserAction } from '@ag-ui/a2ui-middleware';
import type { Redis } from 'ioredis';
import type { H5Adapter } from '../adapters/h5/H5Adapter.js';
import type { MessageRouter } from '../router/MessageRouter.js';
import type { JwtClaims } from '../middleware/auth.js';
import { logger } from '../middleware/logger.js';
import { EventConverter } from './EventConverter.js';
import { RedisStreamAgent } from './RedisStreamAgent.js';
import { SurfacePermissionFilter } from './SurfacePermissionFilter.js';
import { A2UI_CATALOG_ID, type A2uiClientAction } from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/** A2UIRuntime 构造参数 */
export interface A2UIRuntimeParams {
  /** Redis 客户端 */
  redis: Redis;
  /** A2UI 组件 schema（LLM 可见；catalog.ts 的 toMiddlewareSchema 产物） */
  schema: A2UIInlineCatalogSchema;
  /** 渲染权限过滤器（Redis + BFF 两级回退） */
  permissionFilter: SurfacePermissionFilter;
  /** 消息路由器（RedisStreamAgent 入站路由用） */
  messageRouter: MessageRouter;
  /** 事件转换器（可注入以复用 toolCallId 关联；缺省新建） */
  eventConverter?: EventConverter;
}

/** runAgent 运行参数 */
export interface A2UIRunParams {
  /** RunAgentInput（中间件会在 run 内注入 render_a2ui 工具 + Schema） */
  input: RunAgentInput;
  /** 用户身份（**来自 JWT 验签结果**，P4） */
  user: JwtClaims;
  /** H5 适配器（新协议前端消息经 sendRaw 下发） */
  h5Adapter: H5Adapter;
  /** 会话 ID */
  sessionId: string;
}

/** processUserAction 参数 */
export interface A2UIProcessUserActionParams {
  /** 用户身份（**来自 JWT 验签结果**，P4） */
  user: JwtClaims;
  /** 会话 ID */
  sessionId: string;
  /** 前端回传的 A2UI 用户操作 */
  action: A2uiClientAction;
  /** H5 适配器 */
  h5Adapter: H5Adapter;
}

/** runChat 参数（A2UI 启用的对话消息） */
export interface A2UIChatParams {
  /** 用户文本 */
  content: string;
  /** 用户身份（**来自 JWT 验签结果**，P4） */
  user: JwtClaims;
  /** 会话 ID */
  sessionId: string;
  /** H5 适配器 */
  h5Adapter: H5Adapter;
  /** 消息元数据（透传至 RunAgentInput.forwardedProps） */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// A2UIRuntime
// ============================================================================

/**
 * A2UI 编排器：创建并挂载 A2UIMiddleware，提供 runAgent 与 processUserAction。
 */
export class A2UIRuntime {
  private readonly redis: Redis;
  private readonly middleware: A2UIMiddleware;
  private readonly eventConverter: EventConverter;
  private readonly permissionFilter: SurfacePermissionFilter;
  private readonly messageRouter: MessageRouter;

  constructor(params: A2UIRuntimeParams) {
    this.redis = params.redis;
    this.permissionFilter = params.permissionFilter;
    this.messageRouter = params.messageRouter;
    this.eventConverter = params.eventConverter ?? new EventConverter();

    this.middleware = new A2UIMiddleware({
      // 组件 catalog（LLM 可见组件定义）
      schema: params.schema,
      // 自动注入 render_a2ui 工具
      injectA2UITool: true,
      // 拦截的工具名（默认 render_a2ui）
      a2uiToolNames: [RENDER_A2UI_TOOL_NAME],
      // 默认 catalog ID（协议版本锚点；流式 createSurface 需要前置）
      defaultCatalogId: A2UI_CATALOG_ID,
      // 生成恢复循环：≤3 次重试
      recovery: {
        maxAttempts: 3,
        debugExposure: 'collapsed',
        showProgressTokens: true,
      },
    });
  }

  /**
   * 运行 Agent：RedisStreamAgent + A2UIMiddleware 编排，事件经转换/过滤下发前端。
   *
   * 内部不 reject（错误 → 下发 error 前端消息 + 日志），调用方可安全 await。
   *
   * @param params - 运行参数
   * @returns Promise（事件流 complete 时 resolve）
   */
  async runAgent(params: A2UIRunParams): Promise<void> {
    const agent = new RedisStreamAgent({
      redis: this.redis,
      sessionId: params.sessionId,
      userId: params.user.userId,
      messageRouter: this.messageRouter,
      eventConverter: this.eventConverter,
    });

    // middleware.run 声明返回 Observable<BaseEvent>（AG-UI 宽松基类型），
    // 事件经转换器消费前统一断言为 AGUIEvent（精确联合类型）。
    //
    // 注：中间件包为 CJS（无 exports/types 条件），其 '@ag-ui/client' 解析到
    // index.d.ts；本项目为 ESM（NodeNext），解析到 index.d.mts。两者是同一
    // AbstractAgent 声明的两份拷贝（私有 _debug 名义类型不同），故用
    // Parameters<run>[1] 取中间件实际期望的 AbstractAgent 类型做断言（结构
    // 一致，仅名义私有成员差异，运行时安全）。
    type MiddlewareAgent = Parameters<A2UIMiddleware['run']>[1];
    const eventStream: Observable<BaseEvent> = this.middleware.run(
      params.input,
      agent as unknown as MiddlewareAgent,
    );

    return new Promise<void>((resolve) => {
      // 串行化事件处理：保证 a2ui_surface / stream / done 顺序下发
      let chain: Promise<void> = Promise.resolve();

      eventStream.subscribe({
        next: (baseEvent: BaseEvent) => {
          const aguiEvent = baseEvent as unknown as AGUIEvent;
          chain = chain
            .then(async () => {
              const frontendMessage = this.eventConverter.baseEventToFrontendMessage(aguiEvent);
              if (frontendMessage == null) {
                return;
              }
              const filtered = await this.permissionFilter.filter(
                frontendMessage,
                params.user.userId,
                params.sessionId,
              );
              if (filtered != null) {
                await params.h5Adapter.sendRaw(filtered, params.sessionId);
              }
            })
            .catch((error: unknown) => {
              logger.error(
                {
                  error: error instanceof Error ? error.message : String(error),
                  sessionId: params.sessionId,
                  runId: params.input.runId,
                },
                'A2UI event processing failed',
              );
            });
        },
        error: (error: Error) => {
          // 错误也走串行链：先 flush 已入队事件，再下发错误消息并 resolve
          void chain
            .then(async () => {
              await params.h5Adapter.sendRaw(
                {
                  type: 'error',
                  errorCode: 'A2UI_RUNTIME',
                  message: error.message,
                },
                params.sessionId,
              );
            })
            .catch((sendError: unknown) => {
              logger.error(
                {
                  error: sendError instanceof Error ? sendError.message : String(sendError),
                  sessionId: params.sessionId,
                },
                'A2UI error message send failed',
              );
            })
            .finally(() => resolve());
          logger.error(
            { error: error.message, sessionId: params.sessionId, runId: params.input.runId },
            'A2UI run stream error',
          );
        },
        complete: () => {
          void chain.then(() => resolve());
        },
      });
    });
  }

  /**
   * 处理前端回传的 A2UI 用户操作。
   *
   * 前端 `{ type: 'a2ui_action', action: A2uiClientAction }` → 映射为
   * `RunAgentInput.forwardedProps.a2uiAction.userAction` → 中间件 processUserAction
   * 合成 tool call 消息 → 新一轮 Agent 执行（结果经事件流回传前端）。
   *
   * 注：Gateway 只做协议透传，**不做写操作授权**（P5）；写操作权限由 BFF
   * ApiPermissionInterceptor 兜底校验。
   *
   * @param params - 处理参数
   * @returns Promise（新一轮 run complete 时 resolve）
   */
  async processUserAction(params: A2UIProcessUserActionParams): Promise<void> {
    const userAction: A2UIUserAction = {
      name: params.action.action,
      surfaceId: params.action.surfaceId,
      sourceComponentId: params.action.componentId,
      context: params.action.args,
      timestamp: new Date().toISOString(),
    };

    const input: RunAgentInput = {
      // threadId = sessionId：Python 按会话续跑（会话内对话历史在 Python 侧按 sessionId 关联）
      threadId: params.sessionId,
      runId: crypto.randomUUID(),
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {
        a2uiAction: { userAction },
      },
    };

    logger.info(
      {
        sessionId: params.sessionId,
        runId: input.runId,
        action: userAction.name,
        surfaceId: userAction.surfaceId,
        sourceComponentId: userAction.sourceComponentId,
      },
      'A2UI user action processed; starting new agent run',
    );

    return this.runAgent({
      input,
      user: params.user,
      h5Adapter: params.h5Adapter,
      sessionId: params.sessionId,
    });
  }

  /**
   * 运行 A2UI 启用的对话消息（「对话 → A2UI 动态界面」起点）。
   *
   * 将用户文本构造为 RunAgentInput（中间件会在 run 内注入 render_a2ui 工具 +
   * 组件 Schema + LLM 指南），经 RedisStreamAgent 发往 Python；Python 在
   * `aip:outbound:{sessionId}` 回包后，事件流经中间件拦截 → 转换 → 过滤 → 下发。
   *
   * 注意：该路径要求 Python 侧配合消费 `a2ui_run` 入站消息并回包到
   * `aip:outbound:{sessionId}`（见交付摘要「剩余联调依赖」）。
   *
   * @param params - 对话参数
   * @returns Promise（事件流 complete 时 resolve）
   */
  async runChat(params: A2UIChatParams): Promise<void> {
    const input: RunAgentInput = {
      // threadId = sessionId：Python 按会话关联对话历史
      threadId: params.sessionId,
      runId: crypto.randomUUID(),
      state: {},
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: params.content,
        },
      ],
      tools: [],
      context: [],
      forwardedProps: { ...(params.metadata ?? {}) },
    };

    logger.info(
      {
        sessionId: params.sessionId,
        runId: input.runId,
        userId: params.user.userId,
      },
      'A2UI chat run started',
    );

    return this.runAgent({
      input,
      user: params.user,
      h5Adapter: params.h5Adapter,
      sessionId: params.sessionId,
    });
  }
}

/**
 * ws.d.ts — 本地最小类型声明（ws@8.x 无内置 .d.ts，零新增依赖）
 *
 * 只覆盖 Gateway 实际使用面（`src/adapters/wecom/WecomBotClient.ts`）：
 * - 构造 `new WebSocket(url, options)`
 * - `.on()` / `.removeAllListeners()` / `.send()` / `.close()` / `.readyState`
 * - 静态常量 `WebSocket.OPEN`
 * - 类型 `WebSocket.RawData`
 *
 * 红线：impl-plan §9.4「Gateway 新增依赖 0 个」含 devDependency，故**不安装**
 * `@types/ws`；如需完整类型（帧解析 / 压缩 / 子协议等）再考虑引入。
 *
 * @module types/ws
 */

declare module 'ws' {
  /** WebSocket 实例（最小使用面声明）。 */
  class WebSocket {
    /** 连接状态常量（与实例 `readyState` 取值一致）。 */
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    /** 当前连接状态：0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED。 */
    readonly readyState: number;

    constructor(address: string | URL, options?: WebSocket.ClientOptions);

    send(data: string | WebSocket.RawData, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    ping(data?: unknown): void;
    pong(data?: unknown): void;
    terminate(): void;
    removeAllListeners(): this;

    on(event: 'open', listener: () => void): this;
    on(
      event: 'message',
      listener: (data: WebSocket.RawData, isBinary: boolean) => void,
    ): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(
      event: 'unexpected-response',
      listener: (request: unknown, response: { statusCode?: number }) => void,
    ): this;
    on(event: string | symbol, listener: (...args: never[]) => void): this;
  }

  namespace WebSocket {
    /** 收到的原始数据（Buffer / ArrayBuffer / Buffer[]）。 */
    type RawData = Buffer | ArrayBuffer | Buffer[];

    /** 构造选项（仅覆盖使用面；其余透传）。 */
    interface ClientOptions {
      handshakeTimeout?: number;
      [key: string]: unknown;
    }
  }

  export = WebSocket;
}

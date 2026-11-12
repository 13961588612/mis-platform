/**
 * Ticket SSO 兑换（致远等）：同源调用 BFF，不走带 401→/login 的 axios 拦截器。
 */

export interface TicketExchangeResult {
  misJwt: string;
  expiresIn: number;
  mappedUserId: string;
  mappedBy: string;
  permissions: string[];
}

export interface TicketExchangeError {
  code: number;
  message: string;
}

/** 日志用 ticket 指纹（非安全哈希，仅排查；不打印明文）。 */
export function ticketFingerprint(ticket: string): string {
  const t = ticket.trim();
  if (!t) return '';
  let h = 0;
  for (let i = 0; i < t.length; i += 1) {
    h = (h * 31 + t.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `${hex}:${t.length}`;
}

/**
 * POST /api/v1/embed/identity/ticket-exchange
 * @throws TicketExchangeError 形态对象（含 code/message）
 */
export async function exchangeEmbedTicket(input: {
  hostId: string;
  ticket: string;
}): Promise<TicketExchangeResult> {
  const fp = ticketFingerprint(input.ticket);
  const started = Date.now();
  console.info('[EmbedTicket] exchange request', { hostId: input.hostId, ticketFp: fp });

  const res = await fetch('/api/v1/embed/identity/ticket-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ hostId: input.hostId, ticket: input.ticket }),
  });

  let body: { code?: number; message?: string; data?: TicketExchangeResult } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    console.warn('[EmbedTicket] exchange non-json response', {
      hostId: input.hostId,
      ticketFp: fp,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
    });
    throw { code: res.status || 500, message: 'ticket 兑换响应无法解析' } satisfies TicketExchangeError;
  }

  if (!res.ok || body.code !== 0 || !body.data?.misJwt) {
    console.warn('[EmbedTicket] exchange failed', {
      hostId: input.hostId,
      ticketFp: fp,
      httpStatus: res.status,
      code: body.code,
      message: body.message,
      elapsedMs: Date.now() - started,
    });
    throw {
      code: body.code ?? res.status,
      message: body.message || 'ticket 兑换失败',
    } satisfies TicketExchangeError;
  }

  console.info('[EmbedTicket] exchange ok', {
    hostId: input.hostId,
    ticketFp: fp,
    mappedBy: body.data.mappedBy,
    mappedUserId: body.data.mappedUserId,
    expiresIn: body.data.expiresIn,
    elapsedMs: Date.now() - started,
  });

  return {
    misJwt: body.data.misJwt,
    expiresIn: body.data.expiresIn,
    mappedUserId: body.data.mappedUserId,
    mappedBy: body.data.mappedBy,
    permissions: Array.isArray(body.data.permissions) ? body.data.permissions : [],
  };
}

/** 从地址栏移除 ticket（防 Referer / 历史泄漏）。 */
export function stripTicketFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('ticket')) return;
    url.searchParams.delete('ticket');
    const qs = url.searchParams.toString();
    const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
    window.history.replaceState({}, '', next);
    console.info('[EmbedTicket] ticket removed from URL');
  } catch (err) {
    console.warn('[EmbedTicket] strip ticket from URL failed', err);
  }
}

/**
 * embed 鉴权后 hydrate 当前用户（来自 MIS /auth/me，非宿主外身份）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hydrateEmbedUser } from './embed-hydrate-user';
import { useAuthStore } from '@/stores/auth-store';

describe('hydrateEmbedUser', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('空 token → false，不改 store', async () => {
    expect(await hydrateEmbedUser('')).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('/auth/me 成功 → 写入 authStore.user（realName 优先展示）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            id: '1001',
            username: 'zhangsan',
            realName: '张三',
            avatarUrl: null,
            roles: ['store_staff'],
            permVersion: 1,
            permissions: ['agent:chat:use'],
          },
        }),
      })),
    );

    expect(await hydrateEmbedUser('jwt-token')).toBe(true);
    const user = useAuthStore.getState().user;
    expect(user?.id).toBe('1001');
    expect(user?.username).toBe('zhangsan');
    expect(user?.realName).toBe('张三');
    expect(useAuthStore.getState().permissions).toContain('agent:chat:use');

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token',
        }),
      }),
    );
  });

  it('/auth/me 失败 → false，user 仍为 null（不打断对话）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ code: 40100, message: 'Unauthorized' }),
      })),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await hydrateEmbedUser('bad')).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    warn.mockRestore();
  });
});

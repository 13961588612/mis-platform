// 集中式 queryKey 工厂，保证失效(invalidate)精准、无魔法字符串。
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  users: {
    list: (params?: unknown) => ['users', 'list', params] as const,
    detail: (id: string | number) => ['users', 'detail', id] as const,
  },
} as const;

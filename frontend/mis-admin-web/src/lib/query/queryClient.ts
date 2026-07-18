import { QueryClient } from '@tanstack/react-query';

// 全局单例：业务代码中可直接 `import { queryClient }` 调用 invalidateQueries。
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

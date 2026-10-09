/**
 * 详情页「返回原处」（Return Path）。
 *
 * <p>流程详情页原先把面包屑首级写死为「工作台 → /task/pending」，从门户 /顶栏 /
 * 收件箱点进来时点面包屑会跳去一个语义不明的列表页。改为：跳转方通过路由 `state`
 * 带上来源路径与来源标题，详情页优先取state，缺省回落 `/task/pending`。
 *
 * <p>直接输URL 访问时没有 `state`，必须回落且不报错 —— 这是本模块存在的主要理由。
 */
import { useLocation } from 'react-router-dom';

export interface ReturnPathState {
  /** 来源路由，如 '/portal'、'/task/inbox'、'/task/my-sent'。 */
  from: string;
  /** 来源标题，用于面包屑首级文案。 */
  fromLabel: string;
}

/** 缺省来源：工作台待办列表（保持改造前的行为）。 */
export const DEFAULT_RETURN_PATH: ReturnPathState = {
  from: '/task/pending',
  fromLabel: '工作台',
};

/** 跳转方用这个工厂函数造state，避免手写对象时字段拼错。 */
export function returnPath(from: string, fromLabel: string): ReturnPathState {
  return { from, fromLabel };
}

/**
 * 读取当前导航携带的来源信息。
 *
 * <p>对`location.state` 做运行时校验：手输 URL、浏览器前进后退、
 * 外部深链都可能带来 `null` / 非对象 / 字段缺失的 state，一律回落 {@link DEFAULT_RETURN_PATH}。
 */
export function useReturnPath(): ReturnPathState {
  const location = useLocation();
  const state = location.state as { from?: unknown; fromLabel?: unknown } | null | undefined;
  if (state && typeof state === 'object' && typeof state.from === 'string' && state.from.startsWith('/')) {
    return {
      from: state.from,
      fromLabel: typeof state.fromLabel === 'string' && state.fromLabel ? state.fromLabel : DEFAULT_RETURN_PATH.fromLabel,
    };
  }
  return DEFAULT_RETURN_PATH;
}
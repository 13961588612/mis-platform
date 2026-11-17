/**
 * micro-app（@micro-zoe/micro-app）壳子侧 <micro-app> 自定义元素类型声明。
 *
 * <p>元素属性（name/url/baseroute/keep-alive）见 micro-app 官方文档；
 * 生命周期事件（onMounted 等）需导入 polyfill 才在 React 18 生效，本项目不依赖，
 * 令牌经 microApp.setData 下发、子应用 getData/addDataListener 接收。
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'micro-app': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        name: string;
        url: string;
        /** 子应用路由前缀（注入子应用 __MICRO_APP_BASE_ROUTE__） */
        baseroute?: string;
        /** 虚拟路由模式：search（默认，query 参数同步）| native（路径式 URL）| pure（独立渲染） */
        'router-mode'?: string;
        'keep-alive'?: boolean;
        disabled?: boolean;
        inline?: boolean;
        /** vite 子应用需 iframe 沙箱隔离（ESM 无法被 Proxy 沙箱拦截） */
        iframe?: boolean;
        /** 子应用首次挂载完成回调（keep-alive-outlet 用于下发会话令牌） */
        onMounted?: () => void;
      };
    }
  }
}

export {};

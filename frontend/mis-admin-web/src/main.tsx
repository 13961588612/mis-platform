import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import microApp from '@micro-zoe/micro-app';
import { App } from '@/app/App';

// micro-app 基座初始化：remote（runtime='remote'）子应用由此加载。
// shadowDOM=false 保持壳子 CSS 变量可被子应用继承（shadcn 令牌在 :root）。
microApp.start({ shadowDOM: false, disableScopecss: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

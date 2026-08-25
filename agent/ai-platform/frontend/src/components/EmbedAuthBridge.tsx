/**
 * EmbedAuthBridge — 父系统（MIS 管理台）iframe 嵌入鉴权与上下文桥（DEP-7 / M1）。
 *
 * 始终挂载在 App 根部（不依赖 /chat 是否已鉴权），以便：
 * 1. 尽早发出 AUTH_READY，父页推送 MIS JWT
 * 2. 接收 AUTH_TOKEN / PAGE_CONTEXT
 */

import { useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { useEmbedStore } from "../store/embedStore";

function parseParentOrigins(): string[] {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  return (env.VITE_PARENT_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EmbedAuthBridge(): null {
  const acceptEmbeddedToken = useAuthStore((s) => s.acceptEmbeddedToken);
  const setPageContext = useEmbedStore((s) => s.setPageContext);

  useEffect(() => {
    const allowedOrigins = parseParentOrigins();

    const handler = (event: MessageEvent): void => {
      if (allowedOrigins.length === 0) {
        return;
      }
      if (!allowedOrigins.includes(event.origin)) {
        console.warn("[EmbedAuthBridge] 拒绝非白名单父域:", event.origin);
        return;
      }
      const data = event.data as {
        type?: string;
        token?: string;
        context?: { route?: string; module?: string; title?: string };
      } | null;
      if (data == null || typeof data.type !== "string") return;

      if (data.type === "AUTH_TOKEN" && typeof data.token === "string") {
        acceptEmbeddedToken(data.token);
        return;
      }
      if (data.type === "PAGE_CONTEXT" && data.context && typeof data.context === "object") {
        setPageContext({
          route: data.context.route ?? "",
          module: data.context.module ?? "",
          title: data.context.title,
        });
      }
    };

    window.addEventListener("message", handler);
    // 非敏感：告知父页 H5 已就绪，可推令牌
    window.parent?.postMessage({ type: "AUTH_READY" }, "*");
    return () => window.removeEventListener("message", handler);
  }, [acceptEmbeddedToken, setPageContext]);

  return null;
}

export default EmbedAuthBridge;

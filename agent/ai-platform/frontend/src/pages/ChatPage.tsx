/**
 * ChatPage — Main AI chat page.
 *
 * Full-screen chat interface with the ChatPanel component.
 * Auth 由外层 RequireAuth 统一处理（含 iframe 嵌入等待态）。
 */

import { useEffect } from "react";
import { ChatPanel } from "../components/ChatPanel";
import { useAuthStore } from "../store/authStore";

function isEmbedMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("embed") === "1") return true;
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// ===== Component =====

/**
 * ChatPage — the primary AI conversation interface.
 * 嵌入 Sheet 时用 h-full，独立打开用 h-screen。
 */
export function ChatPage(): JSX.Element {
  const initialize = useAuthStore((s) => s.initialize);
  const embed = isEmbedMode();

  useEffect(() => {
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={embed ? "h-full min-h-0 w-full bg-surface-muted" : "h-screen w-full bg-surface-muted"}>
      <ChatPanel />
    </div>
  );
}

export default ChatPage;

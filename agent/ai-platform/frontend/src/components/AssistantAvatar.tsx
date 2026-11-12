/**
 * AssistantAvatar — Copilot 助手头像（Hermes / nous-girl 风格）。
 *
 * <p>从 ``src/assets`` 打包引入，避免仅依赖 ``public/`` 绝对路径在 iframe /
 * 子路径部署时 404 导致「没有头像」。加载失败时回退为字母占位。
 */

import { useState } from "react";
import assistantAvatarUrl from "../assets/assistant-avatar.jpg";

interface AssistantAvatarProps {
  /** Tailwind size classes; default chat bubble size. */
  className?: string;
  /** Accessible label. */
  label?: string;
}

/** Hermes-style character mark used as the agent avatar. */
export function AssistantAvatar({
  className = "h-9 w-9",
  label = "智能助手",
}: AssistantAvatarProps): JSX.Element {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-white shadow-sm ${className}`}
      role="img"
      aria-label={label}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center bg-primary-100 text-xs font-semibold text-primary-700">
          AI
        </div>
      ) : (
        <img
          src={assistantAvatarUrl}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      )}
    </div>
  );
}

export default AssistantAvatar;

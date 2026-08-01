/**
 * AssistantAvatar — Chat bubble avatar inspired by Hermes Agent's nous-girl mark.
 *
 * Asset: `public/assistant-avatar.jpg` (sourced from Nous Research Hermes Agent
 * BrandMark / nous-girl, MIT). Soft white tile + rounded crop for message list.
 */

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
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-white shadow-sm ${className}`}
      role="img"
      aria-label={label}
    >
      <img
        src="/assistant-avatar.jpg"
        alt=""
        draggable={false}
        className="h-full w-full object-cover object-top"
      />
    </div>
  );
}

export default AssistantAvatar;

/**
 * UserAvatar — 用户侧头像（首字母占位；无远端头像 URL 时使用）。
 */

interface UserAvatarProps {
  /** 展示名 / 用户名，取首字符。 */
  name?: string | null;
  className?: string;
}

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "我";
  return trimmed.slice(0, 1).toUpperCase();
}

export function UserAvatar({
  name,
  className = "h-9 w-9",
}: UserAvatarProps): JSX.Element {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-600 text-sm font-semibold text-white shadow-sm ring-2 ring-white ${className}`}
      role="img"
      aria-label={name?.trim() || "用户"}
    >
      {initialOf(name)}
    </div>
  );
}

export default UserAvatar;

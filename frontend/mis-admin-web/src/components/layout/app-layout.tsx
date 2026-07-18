import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Menu, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { logout } from '@/lib/api/auth';

const navItems = [{ label: '仪表盘', path: '/dashboard' }];

export function AppLayout() {
  const { setTheme, resolvedTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const app = useAuthStore((s) => s.app);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  useEffect(() => setMounted(true), []);

  const handleLogout = async () => {
    await logout();
    clearSession();
    navigate('/login', { replace: true });
  };

  const toggleTheme = () => {
    if (!mounted) return;
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          'hidden border-r bg-muted/40 md:flex md:flex-col',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className="flex h-14 items-center border-b px-4 font-medium">
          {collapsed ? 'M' : app?.name ?? 'MIS'}
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )
              }
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md p-2 hover:bg-accent md:hidden"
              onClick={() => setCollapsed((v) => !v)}
              aria-label="切换侧栏"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium">{app?.name ?? 'MIS Platform'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {user?.realName ?? user?.username}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md p-2 hover:bg-accent"
              aria-label="切换主题"
            >
              {mounted && resolvedTheme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
            >
              退出
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

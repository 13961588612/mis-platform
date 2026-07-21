import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { changePassword } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/auth-store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/common/submit-button';

const PWD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const accessToken = useAuthStore((s) => s.accessToken);
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const app = useAuthStore((s) => s.app);
  const forced = Boolean(user?.mustChangePassword);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (!PWD_RULE.test(newPassword)) {
      setError('新密码须 8–64 位，且同时包含字母与数字');
      return;
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与旧密码相同');
      return;
    }
    setLoading(true);
    try {
      await changePassword({ oldPassword, newPassword });
      if (user && accessToken && app && expiresAt) {
        setSession({
          accessToken,
          expiresIn: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
          app,
          user: { ...user, mustChangePassword: false },
        });
      }
      setOk(true);
      setTimeout(() => navigate(forced ? '/portal' : '/dashboard', { replace: true }), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader>
          <CardTitle className="text-xl">修改密码</CardTitle>
          <CardDescription>
            {forced
              ? '首次登录须修改初始密码后才能进入系统'
              : '请输入当前密码与新密码'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {ok ? (
              <Alert>
                <AlertDescription>密码已更新，正在跳转…</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="oldPassword">当前密码</Label>
              <Input
                id="oldPassword"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">8–64 位，须含字母与数字</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认新密码</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <SubmitButton type="submit" className="w-full" loading={loading} disabled={ok}>
              确认修改
            </SubmitButton>
            <Link
              to="/portal"
              className="block text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {forced ? '稍后再改，进入门户' : '返回门户'}
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

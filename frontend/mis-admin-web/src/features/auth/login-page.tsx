import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { fetchCaptcha, login } from '@/lib/api/auth';
import { bootstrapSession } from '@/lib/auth/bootstrap';
import { useAuthStore } from '@/stores/auth-store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/common/submit-button';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Mis@123456');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadCaptcha = async () => {
    try {
      const data = await fetchCaptcha();
      setCaptchaId(data.captchaId);
      setCaptchaImage(data.imageBase64);
      setCaptchaCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证码加载失败');
    }
  };

  useEffect(() => {
    void loadCaptcha();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login({
        appCode: 'system',
        username,
        password,
        captchaId,
        captchaCode,
      });
      setSession(data);
      await bootstrapSession();
      if (data.user.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate('/portal', { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
      void loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex"
        style={{ backgroundImage: 'var(--login-bg-image)', backgroundSize: 'cover' }}
      >
        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold">
              M
            </span>
            <span className="text-lg font-semibold tracking-tight">MIS Platform</span>
          </div>
        </div>
        <div className="relative z-10 max-w-md space-y-3">
          <h2 className="text-3xl font-semibold leading-tight">一处登录，贯通业务子系统</h2>
          <p className="text-sm text-white/70">
            面向企业的一体化身份、权限与运营中台。统一入口、统一权限、可演进微前端。
          </p>
        </div>
        <p className="relative z-10 text-xs text-white/50">© MIS Platform</p>
      </div>

      <div className="flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm border shadow-card">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">登录</CardTitle>
            <CardDescription>使用租户管理员账号进入门户</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="captcha">验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="captcha"
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value)}
                    maxLength={4}
                    required
                  />
                  {captchaImage ? (
                    <button
                      type="button"
                      className="h-9 shrink-0 overflow-hidden rounded-md border bg-card"
                      onClick={() => void loadCaptcha()}
                      title="点击刷新"
                    >
                      <img src={captchaImage} alt="验证码" className="h-9 w-[100px] object-cover" />
                    </button>
                  ) : null}
                </div>
              </div>
              <SubmitButton type="submit" className="w-full" loading={loading}>
                {loading ? '登录中…' : '登录'}
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


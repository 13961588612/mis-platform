import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchCaptcha, login } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/auth-store';

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
      if (data.user.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
      void loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>MIS Platform</h1>
        <p className="subtitle">企业管理后台</p>
        {error ? <div className="error">{error}</div> : null}
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label>
          验证码
          <div className="captcha-row">
            <input value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} maxLength={4} />
            {captchaImage ? (
              <button type="button" className="captcha-image" onClick={() => void loadCaptcha()} title="点击刷新">
                <img src={captchaImage} alt="验证码" />
              </button>
            ) : null}
          </div>
        </label>
        <button type="submit" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}

export function ChangePasswordPlaceholder() {
  return (
    <div className="page-center">
      <div className="card">
        <h2>首次登录须修改密码</h2>
        <p>改密页将在 Sprint 2 实现，当前可先跳过验收。</p>
        <Link to="/dashboard">暂时进入系统</Link>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const app = useAuthStore((s) => s.app);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-xl font-medium">欢迎，{user?.realName ?? user?.username}</h2>
        <p className="mt-2 text-sm text-muted-foreground">角色：{user?.roles?.join(', ') || '—'}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {app?.name ?? 'MIS'} Sprint 1 认证闭环已就绪。后续 Sprint 将接入动态菜单与用户管理。
        </p>
      </div>
    </div>
  );
}

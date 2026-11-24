import { AppWindow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { IntranetOnlyBadge } from '@/components/common/intranet-only-badge';
import { appFromCatalog, navigateIntoApp, tryEnterAppByCode } from '@/lib/nav/intranet-app';

/** 待办/消息抽屉：跳进关联应用；仅内网且当前非内网时由 tryEnterAppByCode 拦截。 */
export function OpenAppButton({ appCode }: { appCode: string | null | undefined }) {
  const navigate = useNavigate();
  if (!appCode) return null;
  const app = appFromCatalog(appCode);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        tryEnterAppByCode(appCode, (ok) => navigateIntoApp(navigate, ok));
      }}
    >
      <AppWindow className="mr-1 h-3.5 w-3.5" />
      打开应用
      {app?.intranetOnly ? <IntranetOnlyBadge className="ml-1" /> : null}
    </Button>
  );
}

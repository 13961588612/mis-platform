import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppItem } from '@/types/api';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import {
  appCodeFromPath,
  isIntranetPathBlocked,
  setAppCatalog,
} from './intranet-app';

function app(partial: Partial<AppItem> & Pick<AppItem, 'code'>): AppItem {
  return {
    id: partial.code,
    tenantId: '1',
    name: partial.code,
    icon: null,
    basePath: null,
    description: null,
    portalGroup: null,
    kind: 'subsystem',
    runtime: 'remote',
    sort: 1,
    status: 1,
    enterable: true,
    ...partial,
  };
}

afterEach(() => setAppCatalog([]));

describe('intranet jump guard', () => {
  it('parses remote / iframe path', () => {
    setAppCatalog([app({ code: 'spm', intranetOnly: true, enterable: false })]);
    expect(appCodeFromPath('/remote/spm/home')).toBe('spm');
    expect(appCodeFromPath('/iframe/spm')).toBe('spm');
    expect(appCodeFromPath('/remote/imap/')).toBe('imap');
  });

  it('blocks intranet-only app when not enterable', () => {
    setAppCatalog([app({ code: 'spm', intranetOnly: true, enterable: false })]);
    expect(isIntranetPathBlocked('/remote/spm/home')).toBe(true);
    expect(isIntranetPathBlocked('/system/user')).toBe(false);
  });

  it('allows intranet-only app when enterable', () => {
    setAppCatalog([app({ code: 'spm', intranetOnly: true, enterable: true })]);
    expect(isIntranetPathBlocked('/remote/spm/home')).toBe(false);
  });
});

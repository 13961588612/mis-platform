/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { normalizeEditorHtml, sanitizePastedHtml } from './message-rich-editor';

describe('sanitizePastedHtml', () => {
  it('strips script and keeps safe color style', () => {
    const html =
      '<p style="color: red; mso-fareast-font: SimSun" class="MsoNormal"><script>alert(1)</script>你好</p>';
    const out = sanitizePastedHtml(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('mso-');
    expect(out).not.toContain('MsoNormal');
    expect(out).toContain('color');
    expect(out).toContain('你好');
  });
});

describe('normalizeEditorHtml', () => {
  it('rewrites blob preview to file API path when data-file-id present', () => {
    const html = '<p><img src="blob:http://x/1" data-file-id="99" width="50%"></p>';
    const out = normalizeEditorHtml(html);
    expect(out).toContain('/api/v1/messages/files/99');
    expect(out).toContain('data-file-id="99"');
  });
});

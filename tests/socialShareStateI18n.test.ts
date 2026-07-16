import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAlipayStateStrings } from '@/apps/Alipay/utils/stateStrings';
import { resolveUnknownRedBookUserName } from '@/apps/RedBook/utils/stateStrings';
import { resolveBilibiliStateStrings } from '@/apps/Bilibili/utils/stateStrings';

describe('social sharing state-layer i18n', () => {
  it('resolves Alipay unknown-contact fallback from App language or OS fallback', () => {
    expect(resolveAlipayStateStrings('zh', 'en').chat_unknown_contact).toBe('未知联系人');
    expect(resolveAlipayStateStrings('en', 'zh-Hans').chat_unknown_contact).toBe('Unknown');
    expect(resolveAlipayStateStrings(null, 'en').chat_unknown_contact).toBe('Unknown');
  });

  it('formats RedBook fallback usernames with localized resource templates', () => {
    expect(resolveUnknownRedBookUserName('42', 'zh-CN', 'en')).toBe('用户 42');
    expect(resolveUnknownRedBookUserName('42', 'en-US', 'zh-Hans')).toBe('User 42');
    expect(resolveUnknownRedBookUserName('42', null, 'en')).toBe('User 42');
  });

  it('resolves Bilibili image-message placeholders in both locales', () => {
    expect(resolveBilibiliStateStrings('zh', 'en').chat_image_placeholder).toBe('[图片]');
    expect(resolveBilibiliStateStrings('en', 'zh-Hans').chat_image_placeholder).toBe('[Image]');
    expect(resolveBilibiliStateStrings(null, 'en').chat_image_placeholder).toBe('[Image]');
  });

  it('keeps the requested fallback literals out of state modules', () => {
    const alipay = readFileSync('apps/Alipay/state.ts', 'utf8');
    const redBook = readFileSync('apps/RedBook/state.ts', 'utf8');
    const bilibili = readFileSync('apps/Bilibili/state.ts', 'utf8');

    expect(alipay).not.toContain("?? 'Unknown'");
    expect(redBook).not.toMatch(/name:\s*[`']User /);
    expect(bilibili).not.toContain("'[图片]'");
  });
});


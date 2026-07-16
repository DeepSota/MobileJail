import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAVIGATION_DECLARATION } from '@/apps/Mail/navigation.declaration';

describe('Mail attachment navigation contract', () => {
  it('declares attachment open as an item action with attachment and file ids', () => {
    const detail = NAVIGATION_DECLARATION.routes.find((route) => route.path === '/message/:messageId');
    const action = detail?.uiStates[0].actions?.find((item) => item.id === 'mail.detail.item.open');

    expect(action).toEqual(expect.objectContaining({
      scope: 'item',
      paramsSchema: { attachmentId: 'string', fileId: 'string' },
    }));
  });

  it('binds both identifiers and opens stable refs through the system viewer contract', () => {
    const source = readFileSync('apps/Mail/pages/components/AttachmentChip.tsx', 'utf8');
    expect(source).toContain("data-action={canOpen ? 'mail.detail.item.open'");
    expect(source).toContain('attachmentId: attachment.id');
    expect(source).toContain('fileId: resolved?.ref.fileId');
    expect(source).toContain('openFileRefInViewer(resolved.ref)');
    expect(source).toContain("startActivity('gallery', intent)");
  });
});


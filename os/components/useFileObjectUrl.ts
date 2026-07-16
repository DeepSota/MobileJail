import { useEffect, useMemo, useState } from 'react';
import { openAttachment } from '../FileShareService';
import type { FileShareInput } from '../types/fileShare';

function sourceKey(source: FileShareInput | null | undefined): string {
  if (!source) return '';
  if (typeof source === 'string') return source;
  if ('fileId' in source) return `${source.fileId}:${source.modifiedAt}`;
  return `${source.id}:${source.modifiedAt}`;
}

/**
 * Resolve a content://simfs reference into a browser object URL.
 * Every URL is revoked when the source changes or the component unmounts.
 */
export function useFileObjectUrl(source: FileShareInput | null | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const key = useMemo(() => sourceKey(source), [source]);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | null = null;
    setObjectUrl(null);

    if (source) {
      void openAttachment(source).then((opened) => {
        if (!opened) return;
        if (!active) {
          opened.revoke();
          return;
        }
        revoke = opened.revoke;
        setObjectUrl(opened.objectUrl);
      }).catch(() => {
        if (active) setObjectUrl(null);
      });
    }

    return () => {
      active = false;
      revoke?.();
    };
    // `key` intentionally represents the serializable identity of source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return objectUrl;
}

export default useFileObjectUrl;


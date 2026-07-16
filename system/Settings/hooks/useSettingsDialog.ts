import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSettingsGestures } from './useSettingsGestures';

/** URL-backed dialog state so system Back and edge-back close the top sheet first. */
export function useSettingsDialog(dialog: string, dialogKey = '') {
  const { pageId = '' } = useParams<{ pageId: string }>();
  const [searchParams] = useSearchParams();
  const { bindTap, go, back } = useSettingsGestures();

  const isOpen =
    searchParams.get('dialog') === dialog &&
    (dialogKey === '' || searchParams.get('dialogKey') === dialogKey);
  const activeDialogKey = searchParams.get('dialogKey') || '';

  const open = useCallback((nextDialogKey = dialogKey) => {
    go('dialog.open', {
      pageId,
      dialog,
      dialogKey: nextDialogKey,
    });
  }, [dialog, dialogKey, go, pageId]);

  const bindOpen = <T extends HTMLElement>(nextDialogKey = dialogKey) =>
    bindTap<T>('dialog.open', {
      params: {
        pageId,
        dialog,
        dialogKey: nextDialogKey,
      },
    });

  const replaceWithWifiPassword = useCallback((ssid: string) => {
    go('wifi.password.open', {
      pageId,
      dialogKey: ssid,
    });
  }, [go, pageId]);

  const close = useCallback(() => back(), [back]);

  return {
    activeDialogKey,
    bindOpen,
    close,
    isOpen,
    open,
    replaceWithWifiPassword,
  };
}


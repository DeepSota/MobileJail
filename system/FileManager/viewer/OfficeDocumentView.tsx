import React, { useEffect, useState } from 'react';
import type { FileFormatDescriptor } from './fileFormatRegistry';
import { getOfficePreviewErrorKey, requestOfficePdf } from './officePreviewClient';
import { PdfDocumentView } from './PdfDocumentView';
import { useAppStrings } from '@/os/useAppStrings';
import { strings, type StringKey } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import type { ViewerStateReporter } from './viewerState';

interface OfficeDocumentViewProps {
  blob: Blob;
  format: FileFormatDescriptor;
  zoomPercent: number;
  targetPage: number;
  searchQuery: string;
  showThumbnails: boolean;
  onStateChange: ViewerStateReporter;
}

type PreviewState =
  | { status: 'loading'; bytes: null; errorKey: null }
  | { status: 'ready'; bytes: Uint8Array; errorKey: null }
  | { status: 'error'; bytes: null; errorKey: StringKey };

export const OfficeDocumentView: React.FC<OfficeDocumentViewProps> = ({
  blob,
  format,
  zoomPercent,
  targetPage,
  searchQuery,
  showThumbnails,
  onStateChange,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<PreviewState>({
    status: 'loading',
    bytes: null,
    errorKey: null,
  });

  useEffect(() => {
    if (state.status === 'loading') {
      onStateChange('loading');
      return;
    }
    if (state.status !== 'error') return;
    const next = state.errorKey === 'viewer_error_password'
      ? 'password-protected'
      : state.errorKey === 'viewer_error_too_large'
        ? 'too-large'
        : state.errorKey === 'viewer_error_busy'
          ? 'busy'
          : state.errorKey === 'viewer_error_timeout'
            ? 'timeout'
            : state.errorKey === 'viewer_error_service_unavailable'
              ? 'converter-offline'
              : 'corrupted';
    onStateChange(next);
  }, [onStateChange, state]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', bytes: null, errorKey: null });
    requestOfficePdf(blob, format, controller.signal).then(bytes => {
      setState({ status: 'ready', bytes, errorKey: null });
    }).catch(error => {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('[FileManager] Office preview failed:', error);
      setState({
        status: 'error',
        bytes: null,
        errorKey: getOfficePreviewErrorKey(error) as StringKey,
      });
    });
    return () => controller.abort();
  }, [blob, format, retryVersion]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center text-[14px] text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
        <div>{s.viewer_converting_office}</div>
        <div className="text-[12px] leading-5 text-gray-400">{s.viewer_converting_office_hint}</div>
      </div>
    );
  }

  if (state.status === 'error') {
    const passwordProtected = state.errorKey === 'viewer_error_password';
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div
          className="mb-5 flex h-16 w-14 items-center justify-center rounded-[9px] text-[18px] font-bold text-white shadow-md"
          style={{ backgroundColor: format.colorLabel }}
        >
          {format.iconLabel}
        </div>
        <div className="text-[16px] font-semibold text-app-text">
          {passwordProtected ? s.viewer_error_password_title : s.viewer_office_failed}
        </div>
        <div className="mt-2 text-[13px] leading-5 text-gray-500">{s[state.errorKey]}</div>
        {!passwordProtected && (
          <button
            type="button"
            onClick={() => setRetryVersion(version => version + 1)}
            data-action="viewer.file.retry"
            data-action-type="tap"
            className="mt-5 rounded-full bg-app-primary px-6 py-2.5 text-[14px] font-semibold text-white active:opacity-80"
          >
            {s.viewer_retry}
          </button>
        )}
      </div>
    );
  }

  return (
    <PdfDocumentView
      data={state.bytes}
      zoomPercent={zoomPercent}
      targetPage={targetPage}
      searchQuery={searchQuery}
      showThumbnails={showThumbnails}
      onStateChange={onStateChange}
    />
  );
};

export default OfficeDocumentView;

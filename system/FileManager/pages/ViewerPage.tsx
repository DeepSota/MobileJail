import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FSNode } from '@/os/types';
import * as FileSystem from '@/os/FileSystemService';
import { useActivityContext } from '@/os/ActivityContext';
import * as FileShareService from '@/os/FileShareService';
import {
  IcList,
  IcNavBack,
  IcSearch,
  IcShare,
} from '../res/icons';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { classifyFileFormat, type FileFormatDescriptor } from '../viewer/fileFormatRegistry';
import { PdfDocumentView } from '../viewer/PdfDocumentView';
import { TextDocumentView } from '../viewer/TextDocumentView';
import { SpreadsheetView } from '../viewer/SpreadsheetView';
import { OfficeDocumentView } from '../viewer/OfficeDocumentView';
import { shareNodesAsFiles } from '../utils/fileOperations';
import { validateViewerSourceSize } from '../viewer/viewerValidation';
import type { DocumentViewerState, ViewerStateReporter } from '../viewer/viewerState';

type BlobState =
  | { status: 'loading'; fileId: string; blob: null }
  | { status: 'ready'; fileId: string; blob: Blob }
  | { status: 'error'; fileId: string; blob: null; reason: 'missing' | 'empty' | 'too-large' };

const PdfBlobView: React.FC<{
  blob: Blob;
  zoomPercent: number;
  targetPage: number;
  searchQuery: string;
  showThumbnails: boolean;
  onStateChange: ViewerStateReporter;
}> = ({ blob, zoomPercent, targetPage, searchQuery, showThumbnails, onStateChange }) => {
  const s = useAppStrings(strings, stringsEn);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    setFailed(false);
    blob.arrayBuffer().then(buffer => {
      if (!cancelled) setBytes(new Uint8Array(buffer));
    }).catch(error => {
      if (!cancelled) {
        console.error('[FileManager] PDF read failed:', error);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    onStateChange(failed ? 'corrupted' : 'loading');
  }, [bytes, failed, onStateChange]);

  if (failed) {
    return <div className="flex h-full items-center justify-center px-8 text-center text-[14px] text-gray-500">{s.pdf_preview_failed}</div>;
  }
  if (!bytes) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px] text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
        {s.pdf_preview_loading}
      </div>
    );
  }
  return (
    <PdfDocumentView
      data={bytes}
      zoomPercent={zoomPercent}
      targetPage={targetPage}
      searchQuery={searchQuery}
      showThumbnails={showThumbnails}
      onStateChange={onStateChange}
    />
  );
};

function clampZoom(rawValue: string | null): number {
  const value = Number(rawValue || 100);
  if (!Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(50, Math.round(value / 25) * 25));
}

function parsePage(rawValue: string | null): number {
  const value = Number(rawValue || 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function formatLabel(format: FileFormatDescriptor): string {
  return format.iconLabel === 'FILE' ? (format.extension || 'FILE').toUpperCase() : format.iconLabel;
}

export const ViewerPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { activityId } = useActivityContext();
  const { bindBack, bindTap, go } = useFileManagerGestures();
  const s = useAppStrings(strings, stringsEn);
  const intentPath = useMemo(() => {
    const intent = window.__OS__?.getIntentPayload?.(activityId);
    return FileShareService.resolveViewIntent(intent, 'file_manager')?.node.path ?? '';
  }, [activityId]);
  const queryPath = searchParams.get('path') || '';
  // A foreign ACTION_VIEW is authoritative. Direct route paths are accepted
  // only for public shared storage; App-private attachments require the
  // canonical FileRef + temporary grant carried by the Intent.
  const path = intentPath || (FileShareService.isPublicSharedPath(queryPath) ? queryPath : '');
  const query = searchParams.get('q') || '';
  const zoomPercent = clampZoom(searchParams.get('zoom'));
  const targetPage = parsePage(searchParams.get('page'));
  const requestedSheet = searchParams.get('sheet') || '';
  const requestedCell = searchParams.get('cell') || '';
  const wrapText = searchParams.get('wrap') !== 'off';
  const panel = searchParams.get('panel');
  const file = useMemo<FSNode | null>(() => (path ? FileSystem.getNode(path) : null), [path]);
  const format = useMemo(() => classifyFileFormat(file || path), [file, path]);
  const [blobState, setBlobState] = useState<BlobState>({ status: 'loading', fileId: '', blob: null });
  const [rendererState, setRendererState] = useState<{
    fileId: string;
    state: DocumentViewerState;
  }>({ fileId: '', state: 'loading' });
  const reportRendererState = useCallback<ViewerStateReporter>((state) => {
    setRendererState({ fileId: file?.id ?? '', state });
  }, [file?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!path || !file || file.type !== 'file' || !format.supported) {
      setBlobState({ status: 'error', fileId: file?.id ?? '', blob: null, reason: 'missing' });
      return;
    }
    const metadataValidation = validateViewerSourceSize(file.size, format);
    if (metadataValidation !== 'ok') {
      setBlobState({ status: 'error', fileId: file.id, blob: null, reason: metadataValidation });
      return;
    }
    setBlobState({ status: 'loading', fileId: file.id, blob: null });
    FileSystem.readFile(path).then(blob => {
      if (cancelled) return;
      if (!blob) {
        setBlobState({ status: 'error', fileId: file.id, blob: null, reason: 'missing' });
        return;
      }
      const contentValidation = validateViewerSourceSize(blob.size, format);
      setBlobState(contentValidation === 'ok'
        ? { status: 'ready', fileId: file.id, blob }
        : { status: 'error', fileId: file.id, blob: null, reason: contentValidation });
    }).catch(error => {
      if (!cancelled) {
        console.error('[FileManager] File read failed:', error);
        setBlobState({ status: 'error', fileId: file.id, blob: null, reason: 'missing' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [file, format, path]);

  // Route changes render before effects run. Bind loaded bytes to the file ID
  // so a previous document can never be handed to the next format adapter.
  const currentBlobState: BlobState = file && blobState.fileId === file.id
    ? blobState
    : { status: 'loading', fileId: file?.id ?? '', blob: null };

  const handleShare = () => {
    if (!file || file.type !== 'file') return;
    shareNodesAsFiles([file]);
  };

  const renderDocument = () => {
    if (!file || file.type !== 'file' || !format.supported) {
      return (
        <div className="flex h-full flex-col items-center justify-center px-10 text-center">
          <div className="mb-5 flex h-16 w-14 items-center justify-center rounded-[9px] bg-gray-500 text-[13px] font-bold text-white shadow-md">
            {formatLabel(format).slice(0, 5)}
          </div>
          <div className="text-[16px] font-semibold text-app-text">{s.viewer_cannot_open}</div>
          <div className="mt-2 text-[13px] leading-5 text-gray-500">{s.viewer_no_compatible_app}</div>
        </div>
      );
    }

    if (currentBlobState.status === 'loading') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px] text-gray-500">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
          {s.viewer_opening}
        </div>
      );
    }
    if (currentBlobState.status === 'error') {
      const title = currentBlobState.reason === 'empty'
        ? s.viewer_error_empty_title
        : currentBlobState.reason === 'too-large'
          ? s.viewer_error_too_large_title
          : s.viewer_read_failed;
      const hint = currentBlobState.reason === 'empty'
        ? s.viewer_error_empty
        : currentBlobState.reason === 'too-large'
          ? s.viewer_error_too_large
          : s.viewer_file_missing_hint;
      return (
        <div className="flex h-full flex-col items-center justify-center px-10 text-center">
          <div className="text-[16px] font-semibold text-app-text">{title}</div>
          <div className="mt-2 text-[13px] leading-5 text-gray-500">{hint}</div>
        </div>
      );
    }

    if (format.adapter === 'pdf') {
      return (
        <PdfBlobView
          blob={currentBlobState.blob}
          zoomPercent={zoomPercent}
          targetPage={targetPage}
          searchQuery={query}
          showThumbnails={panel === 'thumbnails'}
          onStateChange={reportRendererState}
        />
      );
    }
    if (format.adapter === 'text') {
      return (
        <TextDocumentView
          blob={currentBlobState.blob}
          zoomPercent={zoomPercent}
          searchQuery={query}
          showLineNumbers
          wrap={wrapText}
          onStateChange={reportRendererState}
        />
      );
    }
    if (format.adapter === 'spreadsheet') {
      return (
        <SpreadsheetView
          blob={currentBlobState.blob}
          format={format}
          zoomPercent={zoomPercent}
          searchQuery={query}
          requestedSheet={requestedSheet}
          requestedCell={requestedCell}
          onStateChange={reportRendererState}
        />
      );
    }
    if (format.adapter === 'office-page') {
      return (
        <OfficeDocumentView
          blob={currentBlobState.blob}
          format={format}
          zoomPercent={zoomPercent}
          targetPage={targetPage}
          searchQuery={query}
          showThumbnails={panel === 'thumbnails'}
          onStateChange={reportRendererState}
        />
      );
    }
    return null;
  };

  const title = file?.name || (path.split('/').filter(Boolean).pop() ?? s.viewer_no_file);
  const canSearch = Boolean(file && format.capabilities.search && format.supported);
  const canShowThumbnails = Boolean(file && format.capabilities.thumbnails && format.supported);
  const viewerState: DocumentViewerState = !path || !file || file.type !== 'file'
    ? 'missing'
    : !format.supported
      ? 'unsupported'
      : currentBlobState.status === 'loading'
        ? 'loading'
        : currentBlobState.status === 'error'
          ? currentBlobState.reason
          : rendererState.fileId === file.id
            ? rendererState.state
            : 'loading';

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-app-surface"
      data-status-bar-foreground="dark"
      data-navigation-bar-foreground="dark"
      data-viewer-state={viewerState}
      data-viewer-kind={format.kind}
    >
      <header className="shrink-0 border-b border-black/5 bg-white pt-10 shadow-[0_1px_5px_rgba(0,0,0,0.05)]">
        <div className="flex h-[58px] items-center gap-1 px-2">
          <button
            type="button"
            {...bindBack()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-gray-100"
            aria-label={s.viewer_back}
          >
            <IcNavBack size={27} />
          </button>

          <div
            className="ml-1 flex h-9 w-8 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-bold text-white shadow-sm"
            style={{ backgroundColor: format.colorLabel }}
            aria-hidden="true"
          >
            {formatLabel(format).slice(0, 4)}
          </div>
          <div className="min-w-0 flex-1 pl-2">
            <h1 className="truncate text-[16px] font-semibold text-app-text">{title}</h1>
            {file && (
              <div className="mt-0.5 truncate text-[11px] text-gray-400">
                {FileSystem.formatFileSize(file.size)} · {format.extension.toUpperCase()}
              </div>
            )}
          </div>

          {canSearch && panel !== 'search' && (
            <button
              type="button"
              {...bindTap('viewer.search.open')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-gray-100"
              aria-label={s.toolbar_search}
            >
              <IcSearch size={21} />
            </button>
          )}
          {canShowThumbnails && panel !== 'thumbnails' && (
            <button
              type="button"
              {...bindTap('viewer.thumbnails.open')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-gray-100"
              aria-label={s.viewer_pages}
            >
              <IcList size={21} />
            </button>
          )}
          {file && file.type === 'file' && (
            <button
              type="button"
              onClick={handleShare}
              data-action="viewer.file.share"
              data-action-type="tap"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-gray-100"
              aria-label={s.viewer_share}
            >
              <IcShare size={21} />
            </button>
          )}
        </div>

        {panel === 'search' && (
          <div className="flex h-[50px] items-center gap-2 border-t border-black/5 bg-[#f8f9fb] px-3">
            <IcSearch size={19} className="shrink-0 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={event => go('viewer.search.query', { q: event.target.value }, { mode: 'replace' })}
              data-trigger="viewer.search.query"
              data-trigger-type="tap"
              data-trigger-params={JSON.stringify({ q: query })}
              placeholder={s.viewer_search_placeholder}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-app-text outline-none placeholder:text-gray-400"
            />
            <button
              type="button"
              {...bindBack()}
              className="rounded-full px-3 py-1.5 text-[14px] font-medium text-app-primary active:bg-blue-50"
            >
              {s.viewer_done}
            </button>
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 bg-[#f4f5f7]">
        {renderDocument()}
      </main>
    </div>
  );
};

export default ViewerPage;

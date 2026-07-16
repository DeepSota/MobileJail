import React, { useEffect, useMemo, useState } from 'react';
import { IcZoomIn, IcZoomOut } from '../res/icons';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { decodeTextBytes, type DecodedText } from './textDecoding';
import type { ViewerStateReporter } from './viewerState';

interface TextDocumentViewProps {
  blob: Blob;
  zoomPercent: number;
  searchQuery: string;
  showLineNumbers?: boolean;
  wrap: boolean;
  onStateChange: ViewerStateReporter;
}

function splitHighlightedText(text: string, query: string): React.ReactNode[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [text];
  const sourceLower = text.toLocaleLowerCase();
  const queryLower = normalizedQuery.toLocaleLowerCase();
  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = sourceLower.indexOf(queryLower);
  let key = 0;
  while (matchIndex >= 0) {
    if (matchIndex > cursor) fragments.push(text.slice(cursor, matchIndex));
    fragments.push(
      <mark key={`match-${key}`} className="rounded-[2px] bg-yellow-300 px-px text-inherit">
        {text.slice(matchIndex, matchIndex + normalizedQuery.length)}
      </mark>,
    );
    key += 1;
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = sourceLower.indexOf(queryLower, cursor);
  }
  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments;
}

function countMatches(text: string, query: string): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return 0;
  const source = text.toLocaleLowerCase();
  let count = 0;
  let cursor = source.indexOf(normalizedQuery);
  while (cursor >= 0) {
    count += 1;
    cursor = source.indexOf(normalizedQuery, cursor + normalizedQuery.length);
  }
  return count;
}

export const TextDocumentView: React.FC<TextDocumentViewProps> = ({
  blob,
  zoomPercent,
  searchQuery,
  showLineNumbers = false,
  wrap,
  onStateChange,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useFileManagerGestures();
  const [decoded, setDecoded] = useState<DecodedText | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (failed) {
      onStateChange('corrupted');
      return;
    }
    if (!decoded) {
      onStateChange('loading');
      return;
    }
    onStateChange(decoded.text.length === 0 ? 'empty' : 'ready');
  }, [decoded, failed, onStateChange]);

  useEffect(() => {
    let cancelled = false;
    setDecoded(null);
    setFailed(false);
    blob.arrayBuffer().then(buffer => {
      if (!cancelled) setDecoded(decodeTextBytes(new Uint8Array(buffer)));
    }).catch(error => {
      if (!cancelled) {
        console.error('[FileManager] Text load failed:', error);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blob, retryVersion]);

  const text = decoded?.text ?? null;
  const lines = useMemo(() => text?.split(/\r\n|\r|\n/) ?? [], [text]);
  const matchCount = useMemo(() => countMatches(text ?? '', searchQuery), [searchQuery, text]);
  const zoomOut = Math.max(50, zoomPercent - 25);
  const zoomIn = Math.min(200, zoomPercent + 25);
  const fontSize = 14 * (zoomPercent / 100);
  const lineHeight = 22 * (zoomPercent / 100);

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="text-[16px] font-semibold text-app-text">{s.text_preview_failed}</div>
        <button
          type="button"
          onClick={() => setRetryVersion(version => version + 1)}
          data-action="viewer.file.retry"
          data-action-type="tap"
          className="mt-5 rounded-full bg-app-primary px-6 py-2.5 text-[14px] font-semibold text-white active:opacity-80"
        >
          {s.viewer_retry}
        </button>
      </div>
    );
  }

  if (text === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px] text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
        {s.text_preview_loading}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {searchQuery.trim() && (
        <div className="shrink-0 border-b border-black/5 bg-[#fff7d8] px-4 py-2 text-[12px] text-[#6f5a16]">
          {matchCount > 0 ? `${matchCount}${s.viewer_search_matches_suffix}` : s.viewer_search_no_results}
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[#fbfbfc]"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {text.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[14px] text-gray-400">
            {s.text_preview_empty}
          </div>
        ) : (
          <div className={`${wrap ? 'w-full' : 'min-w-max'} bg-white py-5 font-mono text-[#202124]`}>
            {lines.map((line, index) => (
              <div
                key={index}
                className="flex min-h-[1.6em] px-4"
                style={{ fontSize, lineHeight: `${lineHeight}px` }}
              >
                {showLineNumbers && (
                  <span className="mr-5 w-10 shrink-0 select-none text-right text-gray-300">
                    {index + 1}
                  </span>
                )}
                <span className={wrap ? 'min-w-0 whitespace-pre-wrap break-words' : 'whitespace-pre'}>
                  {splitHighlightedText(line, searchQuery)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-t border-black/10 bg-white px-3">
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
          {s.viewer_encoding_label}{decoded?.encoding ?? 'UTF-8'}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={zoomPercent <= 50}
            {...bindTap('viewer.zoom.set', { params: { zoom: zoomOut }, mode: 'replace' })}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            aria-label={s.viewer_zoom_out}
          >
            <IcZoomOut size={20} />
          </button>
          <span className="w-10 text-center text-[12px] tabular-nums text-gray-500">{zoomPercent}%</span>
          <button
            type="button"
            disabled={zoomPercent >= 200}
            {...bindTap('viewer.zoom.set', { params: { zoom: zoomIn }, mode: 'replace' })}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            aria-label={s.viewer_zoom_in}
          >
            <IcZoomIn size={20} />
          </button>
        </div>
        <button
          type="button"
          {...bindTap('viewer.text.wrap.set', {
            params: { wrap: wrap ? 'off' : 'on' },
            mode: 'replace',
          })}
          className={`h-8 shrink-0 rounded-full px-3 text-[11px] font-medium active:opacity-70 ${
            wrap ? 'bg-blue-50 text-app-primary' : 'bg-gray-100 text-gray-500'
          }`}
          aria-pressed={wrap}
        >
          {wrap ? s.viewer_wrap_on : s.viewer_wrap_off}
        </button>
      </div>
    </div>
  );
};

export default TextDocumentView;

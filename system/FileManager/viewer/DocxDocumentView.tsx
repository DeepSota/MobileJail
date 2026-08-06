import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IcClose, IcNavBack, IcNavForward, IcZoomIn, IcZoomOut } from '../res/icons';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import type { FileFormatDescriptor } from './fileFormatRegistry';
import {
  isPasswordProtectedOfficeFile,
  matchesDocxFileSignature,
} from './officeFileInspection';
import type { ViewerStateReporter } from './viewerState';

interface DocxDocumentViewProps {
  blob: Blob;
  format: FileFormatDescriptor;
  zoomPercent: number;
  targetPage: number;
  searchQuery: string;
  showThumbnails: boolean;
  onStateChange: ViewerStateReporter;
}

function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.round(page), 1), Math.max(total, 1));
}

export const DocxDocumentView: React.FC<DocxDocumentViewProps> = ({
  blob,
  format,
  zoomPercent,
  targetPage,
  searchQuery,
  showThumbnails,
  onStateChange,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap, bindBack } = useFileManagerGestures();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [loadError, setLoadError] = useState<'corrupted' | 'password-protected' | 'legacy-format' | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(1);

  useEffect(() => {
    if (loadError === 'password-protected') {
      onStateChange('password-protected');
      return;
    }
    if (loadError) {
      onStateChange('corrupted');
      return;
    }
    if (!rendered) {
      onStateChange('loading');
      return;
    }
    onStateChange(totalPages === 0 ? 'empty' : 'ready');
  }, [loadError, onStateChange, rendered, totalPages]);

  // Load and render DOCX
  useEffect(() => {
    let cancelled = false;
    // Use requestAnimationFrame to ensure wrapperRef is in the DOM
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        console.error('[DocxDocumentView] wrapper ref is null after RAF');
        return;
      }
      setRendered(false);
      setLoadError(null);
      setTotalPages(0);
      setPageTexts([]);

      // Reuse or create the shadow root (attachShadow only works once per element)
      let shadow = wrapper.shadowRoot;
      if (!shadow) {
        shadow = wrapper.attachShadow({ mode: 'open' });
      }
      // Clear any previous content
      shadow.innerHTML = '';

      async function loadDocx() {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (isPasswordProtectedOfficeFile(bytes)) {
          if (!cancelled) setLoadError('password-protected');
          return;
        }
        if (!matchesDocxFileSignature(bytes, format.extension)) {
          if (!cancelled) setLoadError(format.extension === 'doc' ? 'legacy-format' : 'corrupted');
          return;
        }
        const docxPreview = await import('docx-preview');
        if (cancelled) return;

        const currentWrapper = wrapperRef.current;
        if (!currentWrapper || cancelled) return;
        const currentShadow = currentWrapper.shadowRoot;
        if (!currentShadow || cancelled) return;

        // Create body container inside the shadow DOM
        const shadowBody = document.createElement('div');
        currentShadow.appendChild(shadowBody);

        await docxPreview.renderAsync(blob, shadowBody, shadowBody, {
          breakPages: true,
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: false,
          debug: false,
          experimental: false,
          className: 'docx-preview',
          ignoreFonts: false,
          ignoreLastRenderedPageBreak: false,
          renderChanges: false,
          renderComments: false,
          renderAltChunks: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
          hideWrapperOnPrint: false,
        } as Partial<import('docx-preview').Options>);
        if (cancelled) return;

        const pages = shadowBody.querySelectorAll('.docx-wrapper > section');
        const count = pages.length || 1;
        pages.forEach((section, index) => {
          (section as HTMLElement).setAttribute('data-docx-page', String(index + 1));
        });
        // Extract text per page for search
        const texts: string[] = [];
        pages.forEach(section => {
          texts.push(section.textContent || '');
        });
        setPageTexts(texts);
        setTotalPages(count);
        setRendered(true);
      }

      loadDocx().catch(error => {
        if (!cancelled) {
          console.error('[FileManager] DOCX load failed:', error);
          setLoadError('corrupted');
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      // Clear shadow content but keep the shadow root alive
      const w = wrapperRef.current;
      if (w?.shadowRoot) w.shadowRoot.innerHTML = '';
    };
  }, [blob, format.extension, retryVersion]);

  // Jump to target page
  const normalizedTargetPage = clampPage(targetPage, totalPages);
  useEffect(() => {
    if (!rendered || targetPage <= 0) return;
    const frame = requestAnimationFrame(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const root = wrapper.shadowRoot ?? wrapper;
      root.querySelector<HTMLElement>(`[data-docx-page="${normalizedTargetPage}"]`)
        ?.scrollIntoView({ block: 'start' });
      setActivePage(normalizedTargetPage);
    });
    return () => cancelAnimationFrame(frame);
  }, [rendered, normalizedTargetPage, targetPage]);

  // Search
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchingPages = useMemo(() => {
    if (!normalizedQuery) return [];
    return pageTexts.flatMap((text, index) =>
      text.toLocaleLowerCase().includes(normalizedQuery) ? [index + 1] : [],
    );
  }, [normalizedQuery, pageTexts]);

  // Scroll-based active page tracking
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    const wrapper = wrapperRef.current;
    if (!scroller || !wrapper) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    let closestPage = activePage;
    let closestDistance = Number.POSITIVE_INFINITY;
    // Query inside shadow DOM
    const root = wrapper.shadowRoot ?? wrapper;
    root.querySelectorAll<HTMLElement>('[data-docx-page]').forEach(element => {
      const distance = Math.abs(element.getBoundingClientRect().top - scrollerTop - 12);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = Number(element.dataset.docxPage || 1);
      }
    });
    if (closestPage !== activePage) setActivePage(closestPage);
  }, [activePage]);

  const zoomScale = zoomPercent / 100;
  const zoomOut = Math.max(50, zoomPercent - 25);
  const zoomIn = Math.min(200, zoomPercent + 25);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#e9ebef]">
      {normalizedQuery && rendered && (
        <div className="shrink-0 border-b border-black/5 bg-[#fff7d8] px-4 py-2 text-[12px] text-[#6f5a16]">
          {matchingPages.length > 0
            ? `${matchingPages.length}${s.viewer_search_pages_suffix}`
            : s.viewer_search_no_results}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto overscroll-contain py-4"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div
          className="mx-auto origin-top"
          style={{ transform: `scale(${zoomScale})` }}
        >
          <div
            ref={wrapperRef}
            className="docx-preview-wrapper"
          />
        </div>
      </div>

      {/* Loading overlay */}
      {!rendered && !loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#e9ebef] text-[14px] text-gray-500">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
          {s.viewer_rendering_docx}
        </div>
      )}

      {/* Error overlay */}
      {loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#e9ebef] px-10 text-center">
          <div
            className="mb-5 flex h-16 w-14 items-center justify-center rounded-[9px] text-[18px] font-bold text-white shadow-md"
            style={{ backgroundColor: format.colorLabel }}
          >
            {format.iconLabel}
          </div>
          <div className="text-[16px] font-semibold text-app-text">
            {loadError === 'password-protected' ? s.viewer_error_password_title : s.viewer_error_docx}
          </div>
          <div className="mt-2 text-[13px] leading-5 text-gray-500">
            {loadError === 'password-protected'
              ? s.viewer_error_password
              : loadError === 'legacy-format'
                ? s.viewer_error_legacy_format
                : s.viewer_error_damaged}
          </div>
          {loadError !== 'password-protected' && loadError !== 'legacy-format' && (
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
      )}

      {/* Toolbar */}
      {rendered && (
        <div className="flex h-[52px] shrink-0 items-center justify-between border-t border-black/10 bg-white/95 px-4 backdrop-blur-xl">
          <button
            type="button"
            disabled={zoomPercent <= 50}
            {...bindTap('viewer.zoom.set', { params: { zoom: zoomOut }, mode: 'replace' })}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            aria-label={s.viewer_zoom_out}
          >
            <IcZoomOut size={20} />
          </button>
          <div className="flex items-center gap-3 text-[13px] text-gray-600">
            <button
              type="button"
              disabled={activePage <= 1}
              {...bindTap('viewer.page.set', { params: { page: Math.max(1, activePage - 1) }, mode: 'replace' })}
              className="flex h-8 w-8 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
              aria-label={s.viewer_previous_page}
            >
              <IcNavBack size={19} />
            </button>
            <span className="min-w-[72px] text-center tabular-nums">
              {activePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={activePage >= totalPages}
              {...bindTap('viewer.page.set', { params: { page: Math.min(totalPages, activePage + 1) }, mode: 'replace' })}
              className="flex h-8 w-8 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
              aria-label={s.viewer_next_page}
            >
              <IcNavForward size={19} />
            </button>
          </div>
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
      )}

      {/* Thumbnails sidebar */}
      {showThumbnails && rendered && (
        <div className="absolute inset-0 z-30 flex bg-black/35">
          <aside className="flex h-full w-[142px] flex-col bg-[#f7f8fa] shadow-xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-black/5 px-3">
              <span className="text-[14px] font-semibold text-app-text">{s.viewer_pages}</span>
              <button
                type="button"
                {...bindBack()}
                className="flex h-8 w-8 items-center justify-center rounded-full active:bg-gray-200"
                aria-label={s.dialog_cancel}
              >
                <IcClose size={19} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="flex flex-col items-center gap-4">
                {Array.from({ length: totalPages }, (_, index) => {
                  const pageNumber = index + 1;
                  return (
                    <button
                      key={pageNumber}
                      type="button"
                      {...bindTap('viewer.page.set', { params: { page: pageNumber }, mode: 'replace' })}
                      className={`rounded-[4px] p-1 ${activePage === pageNumber ? 'bg-blue-100 ring-2 ring-app-primary' : 'bg-white'}`}
                    >
                      <DocxPageThumbnail
                        wrapperRef={wrapperRef}
                        pageNumber={pageNumber}
                      />
                      <span className="mt-1 block text-[11px] text-gray-600">{pageNumber}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
          <button type="button" {...bindBack()} className="flex-1" aria-label={s.dialog_cancel} />
        </div>
      )}
    </div>
  );
};

// Minimal thumbnail: clone the page section at small scale from shadow DOM
const DocxPageThumbnail: React.FC<{
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  pageNumber: number;
}> = ({ wrapperRef, pageNumber }) => {
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const thumb = thumbRef.current;
    if (!wrapper || !thumb) return;
    const root = wrapper.shadowRoot ?? wrapper;
    const section = root.querySelector<HTMLElement>(`[data-docx-page="${pageNumber}"]`);
    if (!section) return;
    const clone = section.cloneNode(true) as HTMLElement;
    clone.style.margin = '0';
    clone.style.boxShadow = 'none';
    thumb.innerHTML = '';
    thumb.appendChild(clone);
  }, [wrapperRef, pageNumber]);

  return (
    <div
      ref={thumbRef}
      className="overflow-hidden"
      style={{ width: 92, height: 120, transform: 'scale(0.25)', transformOrigin: 'top left' }}
    />
  );
};

export default DocxDocumentView;
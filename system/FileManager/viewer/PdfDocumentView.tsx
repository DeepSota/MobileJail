import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IcClose, IcNavBack, IcNavForward, IcZoomIn, IcZoomOut } from '../res/icons';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { classifyPdfLoadError, type PdfLoadErrorKind } from './pdfError';
import type { ViewerStateReporter } from './viewerState';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfDocumentViewProps {
  data: Uint8Array;
  zoomPercent: number;
  targetPage: number;
  searchQuery: string;
  showThumbnails: boolean;
  onStateChange: ViewerStateReporter;
}

interface PdfCanvasPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  className?: string;
}

const PdfCanvasPage: React.FC<PdfCanvasPageProps> = ({
  document,
  pageNumber,
  width,
  className = '',
}) => {
  const s = useAppStrings(strings, stringsEn);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1.414);

  useEffect(() => {
    let cancelled = false;
    document.getPage(pageNumber).then(nextPage => {
      if (cancelled) return;
      const viewport = nextPage.getViewport({ scale: 1 });
      setAspectRatio(viewport.height / viewport.width);
      setPage(nextPage);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      setPage(null);
    };
  }, [document, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page || width <= 0) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = width / baseViewport.width;
    const cssViewport = page.getViewport({ scale: cssScale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: cssScale * outputScale });

    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));
    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;

    let task: RenderTask | null = page.render({
      canvas,
      viewport: renderViewport,
      background: '#ffffff',
    });
    task.promise.catch(error => {
      if (error instanceof Error && error.name === 'RenderingCancelledException') return;
      console.error('[FileManager] PDF page render failed:', error);
    });

    return () => {
      task?.cancel();
      task = null;
    };
  }, [page, width]);

  return (
    <canvas
      ref={canvasRef}
      className={`block bg-white ${className}`}
      style={{ width, minHeight: width * aspectRatio }}
      aria-label={`${s.viewer_pdf_page_prefix}${pageNumber}${s.viewer_pdf_page_suffix}`}
    />
  );
};

function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.round(page), 1), Math.max(total, 1));
}

export const PdfDocumentView: React.FC<PdfDocumentViewProps> = ({
  data,
  zoomPercent,
  targetPage,
  searchQuery,
  showThumbnails,
  onStateChange,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap, bindBack } = useFileManagerGestures();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [containerWidth, setContainerWidth] = useState(380);
  const [loadError, setLoadError] = useState<PdfLoadErrorKind | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (loadError === 'password-protected') {
      onStateChange('password-protected');
      return;
    }
    if (loadError) {
      onStateChange('corrupted');
      return;
    }
    onStateChange(document ? 'ready' : 'loading');
  }, [document, loadError, onStateChange]);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = getDocument({ data: data.slice() });
    setDocument(null);
    setPageTexts([]);
    setLoadError(null);

    loadingTask.promise.then(nextDocument => {
      if (cancelled) {
        void nextDocument.destroy();
        return;
      }
      setDocument(nextDocument);
    }).catch(error => {
      if (!cancelled) {
        console.error('[FileManager] PDF load failed:', error);
        setLoadError(classifyPdfLoadError(error));
      }
    });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [data, retryVersion]);

  useEffect(() => {
    if (!document) return;
    const pdfDocument = document;
    let cancelled = false;
    async function extractText() {
      const textByPage: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        textByPage.push(textContent.items.map(item => ('str' in item ? item.str : '')).join(' '));
        if (cancelled) return;
      }
      if (!cancelled) setPageTexts(textByPage);
    }
    extractText().catch(() => {
      if (!cancelled) setPageTexts([]);
    });
    return () => {
      cancelled = true;
    };
  }, [document]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const totalPages = document?.numPages ?? 0;
  const normalizedTargetPage = clampPage(targetPage, totalPages);
  useEffect(() => {
    if (!document || targetPage <= 0) return;
    const frame = requestAnimationFrame(() => {
      scrollerRef.current
        ?.querySelector<HTMLElement>(`[data-pdf-page="${normalizedTargetPage}"]`)
        ?.scrollIntoView({ block: 'start' });
      setActivePage(normalizedTargetPage);
    });
    return () => cancelAnimationFrame(frame);
  }, [document, normalizedTargetPage, targetPage]);

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchingPages = useMemo(() => {
    if (!normalizedQuery) return [];
    return pageTexts.flatMap((text, index) =>
      text.toLocaleLowerCase().includes(normalizedQuery) ? [index + 1] : [],
    );
  }, [normalizedQuery, pageTexts]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    let closestPage = activePage;
    let closestDistance = Number.POSITIVE_INFINITY;
    scroller.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach(element => {
      const distance = Math.abs(element.getBoundingClientRect().top - scrollerTop - 12);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = Number(element.dataset.pdfPage || 1);
      }
    });
    if (closestPage !== activePage) setActivePage(closestPage);
  };

  if (loadError) {
    const passwordProtected = loadError === 'password-protected';
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="text-[16px] font-semibold text-app-text">
          {passwordProtected ? s.viewer_error_password_title : s.viewer_error_pdf}
        </div>
        <div className="mt-2 text-[13px] leading-5 text-gray-500">
          {passwordProtected ? s.viewer_error_password : s.viewer_error_damaged}
        </div>
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

  if (!document) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px] text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
        {s.viewer_rendering}
      </div>
    );
  }

  const pageWidth = Math.max(180, (containerWidth - 28) * (zoomPercent / 100));
  const zoomOut = Math.max(50, zoomPercent - 25);
  const zoomIn = Math.min(200, zoomPercent + 25);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#e9ebef]">
      {normalizedQuery && (
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
        <div className="flex min-w-max flex-col items-center gap-4 px-3">
          {Array.from({ length: totalPages }, (_, index) => {
            const pageNumber = index + 1;
            const isMatch = matchingPages.includes(pageNumber);
            return (
              <section
                key={pageNumber}
                data-pdf-page={pageNumber}
                className={`relative overflow-hidden rounded-[3px] shadow-[0_2px_12px_rgba(0,0,0,0.18)] ${
                  isMatch ? 'ring-[3px] ring-amber-400' : ''
                }`}
              >
                <PdfCanvasPage document={document} pageNumber={pageNumber} width={pageWidth} />
                <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                  {pageNumber}
                </span>
              </section>
            );
          })}
        </div>
      </div>

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

      {showThumbnails && (
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
                      <PdfCanvasPage document={document} pageNumber={pageNumber} width={92} />
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

export default PdfDocumentView;

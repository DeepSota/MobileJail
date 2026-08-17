import React, { useEffect, useRef, useState } from 'react';
import { IcClose, IcNavBack, IcNavForward, IcZoomIn, IcZoomOut } from '../res/icons';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import type { FileFormatDescriptor } from './fileFormatRegistry';
import {
  isPasswordProtectedOfficeFile,
  matchesPptxFileSignature,
} from './officeFileInspection';
import type { ViewerStateReporter } from './viewerState';

interface PptxDocumentViewProps {
  blob: Blob;
  format: FileFormatDescriptor;
  zoomPercent: number;
  targetPage: number;
  searchQuery: string;
  showThumbnails: boolean;
  onStateChange: ViewerStateReporter;
}

export const PptxDocumentView: React.FC<PptxDocumentViewProps> = ({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<import('@aiden0z/pptx-renderer').PptxViewer | null>(null);
  const [rendered, setRendered] = useState(false);
  const [loadError, setLoadError] = useState<'corrupted' | 'password-protected' | 'legacy-format' | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [activeSlide, setActiveSlide] = useState(1);
  const [searchMatchCount, setSearchMatchCount] = useState(0);

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
    onStateChange(totalSlides === 0 ? 'empty' : 'ready');
  }, [loadError, onStateChange, rendered, totalSlides]);

  // Load and render PPTX — deferred one frame so the container is mounted & sized
  useEffect(() => {
    let cancelled = false;
    setRendered(false);
    setLoadError(null);
    setTotalSlides(0);
    setActiveSlide(1);

    // Wait one frame for the container to be in the DOM with dimensions
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) {
        console.error('[PptxDocumentView] container ref is null after RAF');
        return;
      }

      async function loadPptx() {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (isPasswordProtectedOfficeFile(bytes)) {
          if (!cancelled) setLoadError('password-protected');
          return;
        }
        if (!matchesPptxFileSignature(bytes, format.extension)) {
          if (!cancelled) setLoadError(format.extension === 'ppt' ? 'legacy-format' : 'corrupted');
          return;
        }

        const { PptxViewer } = await import('@aiden0z/pptx-renderer');
        if (cancelled) return;
        const currentContainer = containerRef.current;
        if (!currentContainer || cancelled) return;

        const viewer = new PptxViewer(currentContainer, {
          fitMode: 'contain',
          zoomPercent: 100,
          onSlideChange: (index: number) => {
            setActiveSlide(index + 1);
          },
        });
        viewerRef.current = viewer;

        await viewer.open(blob, {
          renderMode: 'list',
          lazyMedia: true,
        });

        if (cancelled) return;
        setTotalSlides(viewer.slideCount);
        setActiveSlide(viewer.currentSlideIndex + 1);
        setRendered(true);
      }

      loadPptx().catch(error => {
        if (!cancelled) {
          console.error('[FileManager] PPTX load failed:', error);
          if (viewerRef.current) {
            try { viewerRef.current.destroy(); } catch { /* ignore */ }
            viewerRef.current = null;
          }
          setLoadError('corrupted');
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (viewerRef.current) {
        try { viewerRef.current.destroy(); } catch { /* ignore */ }
        viewerRef.current = null;
      }
    };
  }, [blob, format.extension, retryVersion]);

  // Sync zoom to viewer
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !rendered) return;
    viewer.setZoom(zoomPercent).catch(() => undefined);
  }, [zoomPercent, rendered]);

  // Jump to target page
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !rendered || targetPage <= 0) return;
    const index = Math.min(Math.max(targetPage - 1, 0), viewer.slideCount - 1);
    viewer.goToSlide(index).catch(() => undefined);
    setActiveSlide(index + 1);
  }, [rendered, targetPage]);

  // Search — use PptxViewer built-in search with text index
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !rendered) return;
    viewer.clearSearchHighlights();
    const query = searchQuery.trim();
    if (!query) {
      setSearchMatchCount(0);
      return;
    }
    try {
      const results = viewer.searchText(query);
      setSearchMatchCount(results.length);
      for (const result of results.slice(0, 100)) {
        viewer.highlightSearchResult(result, {
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
        }).catch(() => undefined);
      }
    } catch {
      setSearchMatchCount(0);
    }
  }, [searchQuery, rendered]);

  const zoomOut = Math.max(50, zoomPercent - 25);
  const zoomIn = Math.min(200, zoomPercent + 25);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#e9ebef]">
      {searchQuery.trim() && rendered && (
        <div className="shrink-0 border-b border-black/5 bg-[#fff7d8] px-4 py-2 text-[12px] text-[#6f5a16]">
          {searchMatchCount > 0
            ? `${searchMatchCount}${s.viewer_search_matches_suffix}`
            : s.viewer_search_no_results}
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div
          ref={containerRef}
          className="min-h-full"
        />
      </div>

      {/* Loading overlay */}
      {!rendered && !loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#e9ebef] text-[14px] text-gray-500">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
          {s.viewer_rendering_pptx}
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
            {loadError === 'password-protected' ? s.viewer_error_password_title : s.viewer_error_pptx}
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
              disabled={activeSlide <= 1}
              {...bindTap('viewer.page.set', { params: { page: Math.max(1, activeSlide - 1) }, mode: 'replace' })}
              className="flex h-8 w-8 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
              aria-label={s.viewer_previous_page}
            >
              <IcNavBack size={19} />
            </button>
            <span className="min-w-[72px] text-center tabular-nums">
              {activeSlide} / {totalSlides}
            </span>
            <button
              type="button"
              disabled={activeSlide >= totalSlides}
              {...bindTap('viewer.page.set', { params: { page: Math.min(totalSlides, activeSlide + 1) }, mode: 'replace' })}
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
                {Array.from({ length: totalSlides }, (_, index) => {
                  const slideNumber = index + 1;
                  return (
                    <button
                      key={slideNumber}
                      type="button"
                      {...bindTap('viewer.page.set', { params: { page: slideNumber }, mode: 'replace' })}
                      className={`rounded-[4px] p-1 ${activeSlide === slideNumber ? 'bg-blue-100 ring-2 ring-app-primary' : 'bg-white'}`}
                    >
                      <PptxSlideThumbnail
                        viewer={viewerRef.current}
                        slideIndex={index}
                      />
                      <span className="mt-1 block text-[11px] text-gray-600">{slideNumber}</span>
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

const PptxSlideThumbnail: React.FC<{
  viewer: import('@aiden0z/pptx-renderer').PptxViewer | null;
  slideIndex: number;
}> = ({ viewer, slideIndex }) => {
  const thumbContainerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<import('@aiden0z/pptx-renderer').SlideHandle | null>(null);

  useEffect(() => {
    if (!viewer || !thumbContainerRef.current) return;
    try {
      const handle = viewer.renderThumbnailToContainer(slideIndex, thumbContainerRef.current, {
        width: 92,
      });
      if (handle) handleRef.current = handle;
    } catch (e) {
      console.warn('[FileManager] PPTX thumbnail render failed:', e);
    }
    return () => {
      try { handleRef.current?.dispose(); } catch { /* ignore */ }
      handleRef.current = null;
    };
  }, [viewer, slideIndex]);

  return (
    <div ref={thumbContainerRef} className="h-[68px] w-[92px] overflow-hidden rounded-[2px] bg-gray-100" />
  );
};

export default PptxDocumentView;
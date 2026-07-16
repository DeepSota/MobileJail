import React, { useEffect, useRef } from 'react';
import type { FSNode } from '@/os/types';
import { classifyFileFormat } from '../viewer/fileFormatRegistry';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';

export interface UnsupportedFileSheetProps {
  file: FSNode | null;
  onClose: () => void;
}

/** Android-style resolver fallback shown without leaving the current file list. */
export const UnsupportedFileSheet: React.FC<UnsupportedFileSheetProps> = ({ file, onClose }) => {
  const s = useAppStrings(strings, stringsEn);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!file) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [file, onClose]);

  if (!file) return null;

  const format = classifyFileFormat(file);
  const iconLabel = format.iconLabel === 'FILE' ? 'FILE' : format.iconLabel;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsupported-file-title"
      aria-describedby="unsupported-file-message"
      data-testid="unsupported-file-sheet"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-label={s.unsupported_file_close}
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-[480px] rounded-t-[28px] bg-app-surface px-6 pb-[calc(18px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.18)] animate-in slide-in-from-bottom-8 fade-in duration-200"
        onClick={event => event.stopPropagation()}
      >
        <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true" />

        <div className="flex flex-col items-center text-center">
          <div className="relative mb-4 h-[72px] w-[62px]" aria-hidden="true">
            <div className="absolute inset-0 overflow-hidden rounded-[10px] border border-black/5 bg-[#f7f8fa] shadow-[0_5px_14px_rgba(0,0,0,0.12)]">
              <div
                className="absolute inset-x-0 bottom-0 flex h-[28px] items-center justify-center text-[11px] font-bold tracking-[0.08em] text-white"
                style={{ backgroundColor: format.colorLabel }}
              >
                {iconLabel.slice(0, 5)}
              </div>
            </div>
            <div className="absolute right-0 top-0 h-5 w-5 rounded-bl-[7px] border-b border-l border-black/5 bg-white" />
          </div>

          <h2
            id="unsupported-file-title"
            className="max-w-full break-words px-3 text-[17px] font-semibold leading-6 text-app-text"
          >
            {file.name}
          </h2>
          <p
            id="unsupported-file-message"
            className="mt-2 text-[15px] leading-6 text-gray-500"
          >
            {s.unsupported_file_message}
          </p>
        </div>

        <button
          ref={cancelButtonRef}
          type="button"
          onClick={onClose}
          className="mt-7 h-[50px] w-full rounded-[16px] bg-gray-100 text-[16px] font-semibold text-app-text outline-none transition-colors active:bg-gray-200 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {s.dialog_cancel}
        </button>
      </div>
    </div>
  );
};

export default UnsupportedFileSheet;

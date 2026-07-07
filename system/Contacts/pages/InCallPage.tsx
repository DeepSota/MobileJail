import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStrings } from '@/os/useAppStrings';
import { useContactsGestures } from '../hooks/useContactsGestures';
import { addCallLog, useContactsList } from '../state';
import { IcSymbolBack, IcSymbolPhone } from '../res/icons';
import { SymbolIcon } from '../components/SymbolIcon';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import * as TimeService from '@/os/TimeService';

function normalizeNumber(value: string): string {
  return (value || '').replace(/\s+/g, '');
}

/** Format seconds as MM:SS */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Circle action button on the in-call screen */
const ActionButton: React.FC<{
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active, onClick, children }) => (
  <button
    type="button"
    className="flex flex-col items-center gap-1.5 active:opacity-70"
    onClick={onClick}
    aria-label={label}
  >
    <div
      className={`w-14 h-14 rounded-full flex items-center justify-center ${active ? 'bg-white/20' : 'bg-white/10'}`}
    >
      {children}
    </div>
    <span className={`text-[12px] ${active ? 'text-white' : 'text-white/70'}`}>{label}</span>
  </button>
);

export const InCallPage: React.FC = () => {
  const { number } = useParams<{ number: string }>();
  const { back } = useContactsGestures();
  const s = useAppStrings(strings, stringsEn);
  const contacts = useContactsList();

  const decodedNumber = decodeURIComponent(number || '');
  const normalizedNumber = normalizeNumber(decodedNumber);

  // Try to resolve contact name from phone number
  const contact = useMemo(
    () =>
      contacts.find((c) =>
        (c.phones || []).some((p) => normalizeNumber(p.number) === normalizedNumber),
      ),
    [contacts, normalizedNumber],
  );

  const displayName = contact?.displayName || decodedNumber || s.incall_unknown;
  const avatarText = (displayName.trim()[0] ?? '#').toUpperCase();

  // Call state
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(TimeService.realNow());
  const rafRef = useRef<number>(0);

  // Timer using realNow for smooth display
  useEffect(() => {
    const tick = () => {
      const now = TimeService.realNow();
      setElapsed(Math.floor((now - startTimeRef.current) / 1000));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const hangUp = useCallback(() => {
    // Record call log
    const durationSec = elapsed;
    addCallLog({
      displayName,
      number: decodedNumber,
      dateText: formatDuration(durationSec),
      type: 'outgoing',
      sim: 1,
    });
    // Navigate back
    back(1);
  }, [back, decodedNumber, displayName, elapsed]);

  return (
    <div className="h-full w-full flex flex-col items-center bg-gradient-to-b from-[#1a1a2e] to-[#16213e] text-white">
      {/* Status bar spacer */}
      <div className="h-10 flex-shrink-0" />

      {/* Top: back + duration label */}
      <div className="w-full px-4 h-12 flex items-center">
        <button
          type="button"
          className="w-10 h-10 rounded-full flex items-center justify-center active:bg-white/10"
          onClick={hangUp}
          aria-label={s.incall_hang_up}
        >
          <SymbolIcon name={IcSymbolBack} size={22} className="text-white/70" />
        </button>
        <div className="flex-1 text-center text-[13px] text-white/50">
          {elapsed < 2 ? s.incall_calling : formatDuration(elapsed)}
        </div>
        <div className="w-10" />
      </div>

      {/* Middle: avatar + name + number */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center text-white text-[36px] font-semibold"
          style={{ backgroundColor: contact?.avatarColor || '#9CA3AF' }}
        >
          {contact?.avatarUri ? (
            <img
              src={contact.avatarUri}
              alt=""
              className="w-full h-full rounded-full object-cover"
              draggable={false}
            />
          ) : (
            avatarText
          )}
        </div>
        <div className="text-[24px] font-semibold text-center truncate max-w-full">{displayName}</div>
        {contact ? (
          <div className="text-[15px] text-white/50">{decodedNumber}</div>
        ) : null}

        {/* Duration display */}
        {elapsed >= 2 ? (
          <div className="mt-2 text-[20px] font-medium text-white/70 tabular-nums">
            {formatDuration(elapsed)}
          </div>
        ) : null}
      </div>

      {/* Bottom: action buttons + hang up */}
      <div className="flex-shrink-0 w-full pb-8 px-8">
        {/* Action row */}
        <div className="flex items-center justify-around mb-8">
          <ActionButton
            label={s.incall_mute}
            active={muted}
            onClick={() => setMuted((v) => !v)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {muted ? (
                <>
                  <path d="M12 2a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3" />
                  <path d="M19 10V9a7 7 0 0 0-4-6.3" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </>
              ) : (
                <>
                  <path d="M12 2a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3" />
                  <path d="M19 10V9a7 7 0 0 0-4-6.3" />
                  <path d="M17 16.5a7 7 0 0 1-14 0" />
                </>
              )}
            </svg>
          </ActionButton>

          <ActionButton label={s.incall_keypad} onClick={() => { /* stub */ }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="4" height="4" rx="1" />
              <rect x="10" y="2" width="4" height="4" rx="1" />
              <rect x="16" y="2" width="4" height="4" rx="1" />
              <rect x="4" y="8" width="4" height="4" rx="1" />
              <rect x="10" y="8" width="4" height="4" rx="1" />
              <rect x="16" y="8" width="4" height="4" rx="1" />
              <rect x="4" y="14" width="4" height="4" rx="1" />
              <rect x="10" y="14" width="4" height="4" rx="1" />
              <rect x="16" y="14" width="4" height="4" rx="1" />
            </svg>
          </ActionButton>

          <ActionButton
            label={s.incall_speaker}
            active={speaker}
            onClick={() => setSpeaker((v) => !v)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              {speaker ? (
                <>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </>
              ) : (
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              )}
            </svg>
          </ActionButton>

          <ActionButton label={s.incall_add_call} onClick={() => { /* stub */ }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 2v6h6" />
              <path d="M22 2l-6 6" />
            </svg>
          </ActionButton>
        </div>

        {/* Hang up button */}
        <div className="flex justify-center">
          <button
            type="button"
            className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center active:bg-red-600 shadow-lg"
            onClick={hangUp}
            aria-label={s.incall_hang_up}
            data-trigger="incall.hangup"
            data-trigger-type="action"
          >
            <SymbolIcon name={IcSymbolPhone} size={28} className="text-white rotate-[135deg]" />
          </button>
        </div>
      </div>
    </div>
  );
};
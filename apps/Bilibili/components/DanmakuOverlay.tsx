import React, { useMemo, useRef, useEffect } from 'react';
import type { BilibiliDanmaku } from '../types';

interface DanmakuOverlayProps {
  danmakuList: BilibiliDanmaku[];
  currentSec: number;
  visible: boolean;
}

const TRACK_COUNT = 10;
const TRACK_HEIGHT = 24; // px
const BUFFER_SECONDS = 6;
const SCROLL_DURATION = 10; // seconds for a danmaku to scroll across

export const DanmakuOverlay: React.FC<DanmakuOverlayProps> = ({
  danmakuList,
  currentSec,
  visible,
}) => {
  // Track which danmaku IDs have been spawned to avoid duplicates
  const spawnedRef = useRef<Set<string>>(new Set());
  // Reset spawned set when seeking backwards (e.g. video restart)
  useEffect(() => {
    const ids = new Set(danmakuList.map(d => d.id));
    // Remove spawned items that no longer exist (shouldn't happen normally)
    for (const id of spawnedRef.current) {
      if (!ids.has(id)) spawnedRef.current.delete(id);
    }
  }, [danmakuList]);

  // Filter danmaku within the time window, only show those entering the window
  const activeDanmaku = useMemo(() => {
    const start = currentSec - 1; // allow 1s lead-in
    const end = currentSec + BUFFER_SECONDS;
    return danmakuList.filter(dm => {
      if (dm.time < start || dm.time > end) return false;
      return true;
    });
  }, [danmakuList, currentSec]);

  // Assign tracks using a simple approach: hash time to track
  const trackAssignments = useMemo(() => {
    const tracks: Map<string, number> = new Map();
    // Track usage timestamps for collision avoidance
    const trackUsedAt: number[] = new Array(TRACK_COUNT).fill(-Infinity);
    // Sort by time for sequential assignment
    const sorted = [...activeDanmaku].sort((a, b) => a.time - b.time);
    for (const dm of sorted) {
      // Find the track whose last usage is furthest in the past
      let bestTrack = 0;
      let oldestUse = trackUsedAt[0];
      for (let i = 1; i < TRACK_COUNT; i++) {
        if (trackUsedAt[i] < oldestUse) {
          oldestUse = trackUsedAt[i];
          bestTrack = i;
        }
      }
      tracks.set(dm.id, bestTrack);
      trackUsedAt[bestTrack] = dm.time;
    }
    return tracks;
  }, [activeDanmaku]);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none z-[5]"
      style={{
        height: `${TRACK_COUNT * TRACK_HEIGHT}px`,
        top: 0,
        left: 0,
        right: 0,
      }}
    >
      <style>{`
        @keyframes danmaku-scroll {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(-100%);
          }
        }
        .danmaku-item {
          position: absolute;
          white-space: nowrap;
          font-size: 14px;
          font-weight: 500;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8);
          animation: danmaku-scroll linear forwards;
          will-change: transform;
        }
      `}</style>
      {activeDanmaku.map(dm => {
        const track = trackAssignments.get(dm.id) ?? 0;
        const delay = dm.time - currentSec;
        if (delay < -1) return null; // already past
        const duration = SCROLL_DURATION + (dm.text.length * 0.1); // longer text = longer duration

        return (
          <span
            key={dm.id}
            className="danmaku-item"
            style={{
              top: `${track * TRACK_HEIGHT}px`,
              color: dm.color || '#FFFFFF',
              animationDuration: `${duration}s`,
              animationDelay: `${Math.max(0, delay)}s`,
              right: 0,
            }}
          >
            {dm.text}
          </span>
        );
      })}
    </div>
  );
};
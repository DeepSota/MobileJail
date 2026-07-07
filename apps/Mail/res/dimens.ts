/** Numeric pixel dimensions reused across pages. Avoid rem (browser default font-size is not
 *  16px in this environment — JS pixel math drifts against rem-derived heights). */

export const dimens = {
  icSizeTab: 24,
  icSizeNav: 24,
  icSizeAction: 18,
  icSizeToolbar: 22,
  icSizeChevron: 18,
  icStrokeWidth: 2,
} as const;

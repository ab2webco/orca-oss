// Why 360: below it a grid game's cells shrink to a few pixels; 768 with both panels open leaves 137.
export const ARCADE_MIN_CENTER_WIDTH = 360

/** Whether an Arcade tab that just became active should close the right panel to make room. */
export const arcadeNeedsRightPanelClosed = (boxWidth: number, isRightPanelOpen: boolean): boolean =>
  isRightPanelOpen && boxWidth > 0 && boxWidth < ARCADE_MIN_CENTER_WIDTH

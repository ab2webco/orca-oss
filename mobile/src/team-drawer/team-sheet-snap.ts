export type TeamSheetSnap = 'peek' | 'open'

/** pt/s: a release at least this fast snaps in its direction instead of to the nearer point. */
export const TEAM_SHEET_FLING_VELOCITY = 500

/** Where a released sheet rests. `offset` is pt below open: 0 is open, `travel` is the peek. */
export function teamSheetSnapOf(offset: number, travel: number, velocityY: number): TeamSheetSnap {
  'worklet'
  if (travel <= 0) {
    return 'peek'
  }
  if (velocityY <= -TEAM_SHEET_FLING_VELOCITY) {
    return 'open'
  }
  if (velocityY >= TEAM_SHEET_FLING_VELOCITY) {
    return 'peek'
  }
  return offset < travel / 2 ? 'open' : 'peek'
}

/** The sheet's offset under the finger, held between open and peek. */
export function teamSheetOffsetOf(start: number, translationY: number, travel: number): number {
  'worklet'
  return Math.min(Math.max(start + translationY, 0), travel)
}

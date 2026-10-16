export type MemberState = 'working' | 'idle' | 'waiting'
export type Mood = 'hurt' | 'cheer' | 'none'

export const WORKING = 0x56c8d8
export const IDLE = 0x8a8f99
export const WAITING = 0xff5a5a
export const HURT = 0xff3b3b
export const CHEER = 0xffd84a

export const isBlink = (tick: number): boolean => Math.floor(tick / 4) % 2 === 0

export const moodPixel = (
  mood: Mood | undefined,
  color: number | undefined,
  tick: number
): number | undefined =>
  color !== undefined && mood === 'hurt' && Math.floor(tick / 3) % 2 === 0 ? HURT : color

export const isRestingOf = (state: MemberState, mood: Mood | undefined): boolean =>
  state !== 'waiting' && (state === 'idle' || mood === 'cheer')

export const snoreGlyph = (tick: number): string => ['z', 'Z', 'z'][Math.floor(tick / 6) % 3] ?? 'z'

export const moodMarkOf = (
  state: MemberState,
  mood: Mood | undefined,
  tick: number
): { glyph: string; color: number } | undefined => {
  if (state === 'waiting') {
    return isBlink(tick) ? { glyph: '!', color: WAITING } : undefined
  }
  if (mood === 'hurt') {
    return { glyph: '×', color: HURT }
  }
  if (isRestingOf(state, mood)) {
    return { glyph: snoreGlyph(tick), color: mood === 'cheer' ? CHEER : IDLE }
  }
  return undefined
}

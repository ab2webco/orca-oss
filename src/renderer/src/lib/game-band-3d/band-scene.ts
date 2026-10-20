// The contract every POC renderer (three, ogl, pixi) implements for the band overlay.
export type BandLib = 'three' | 'ogl' | 'pixi'

export type BandMemberState = 'working' | 'waiting' | 'idle' | 'done'

export type BandMember = {
  key: string
  name: string
  isLead: boolean
  state: BandMemberState
  lives: number
  benched: boolean
  /** Set during the step a life was won or lost, so the scene can animate it. */
  lifeChange: { delta: number; ageMs: number } | null
  ticket: string
  review: string
  hurt: boolean
}

export type BandCi = 'pending' | 'success' | 'failure' | 'neutral' | 'none'

export type BandModel = {
  members: BandMember[]
  ci: BandCi
  merged: boolean
  caption: string
  /** 0 at midnight, 1 at noon. */
  daylight: number
}

export type BandQuality = {
  fpsCap: number
  /** Device pixels per CSS pixel the canvas renders at. */
  pixelRatio: number
  shadows: boolean
  particles: number
}

export type MemberRect = { key: string; x: number; y: number; width: number; height: number }

export type BandScene = {
  readonly lib: BandLib
  readonly canvas: HTMLCanvasElement
  /** UNMASKED_RENDERER_WEBGL, or null when the extension is missing. */
  readonly rendererName: string | null
  resize(width: number, height: number, quality: BandQuality): void
  render(timeMs: number, model: BandModel): void
  /** CSS-pixel boxes of each character, for tags, hover and click. */
  memberRects(): MemberRect[]
  dispose(): void
}

export const QUALITY_FULL: BandQuality = {
  fpsCap: 60,
  pixelRatio: 2,
  shadows: true,
  particles: 160
}
export const QUALITY_LITE: BandQuality = {
  fpsCap: 30,
  pixelRatio: 1,
  shadows: false,
  particles: 40
}

export const MEMBER_COLORS = [0xf2c14e, 0x5fb3f9, 0x7bd389, 0xf47c7c, 0xc39bf2, 0xf2a65a] as const

export const daylightOf = (date: Date): number => {
  const hours = date.getHours() + date.getMinutes() / 60
  return (1 - Math.cos((hours / 24) * Math.PI * 2)) / 2
}

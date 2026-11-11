// Office's red CI: a bug hops across the failing screen and the desk shakes, until CI is green.
export const OFFICE_VIRUS_COLORS = {
  body: '#7ee04b',
  outline: '#1b1418',
  eye: '#fdfdfb',
  glow: 'rgb(229 72 77 / 0.28)'
} as const

/** Sideways shake of a failing desk in stage px; a jitter, never a slide. */
export const officeVirusShakeAt = (t: number, px: number): number =>
  Math.sin(t * 38) * Math.max(0.6, 1.4 * px)

/** The bug over `rect` (stage px), hopping across the screen on the clock. */
export function drawOfficeVirus(
  g: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  t: number
): void {
  const { x, y, width, height } = rect
  g.save()
  g.fillStyle = OFFICE_VIRUS_COLORS.glow
  g.fillRect(x, y, width, height)
  // Why eased: a hop that rises and lands softly reads as alive; a sine bounce reads as a spring.
  const phase = (t * 1.6) % 1
  const hop = 4 * phase * (1 - phase) * height * 0.32
  const bx = x + width * (0.5 + Math.sin(t * 1.3) * 0.26)
  const by = y + height * 0.66 - hop
  const r = height * 0.19
  g.strokeStyle = OFFICE_VIRUS_COLORS.outline
  g.lineWidth = Math.max(0.6, r * 0.26)
  g.lineCap = 'round'
  for (const side of [-1, 1]) {
    for (const k of [-0.45, 0.05, 0.5]) {
      const kick = Math.sin(t * 18 + k * 4) * r * 0.35
      g.beginPath()
      g.moveTo(bx, by + k * r)
      g.lineTo(bx + side * r * 1.55, by + k * r + r * 0.45 + kick)
      g.stroke()
    }
  }
  g.beginPath()
  g.ellipse(bx, by, r * 1.1, r, 0, 0, 2 * Math.PI)
  g.fillStyle = OFFICE_VIRUS_COLORS.body
  g.fill()
  g.stroke()
  for (const side of [-1, 1]) {
    g.beginPath()
    g.arc(bx + side * r * 0.42, by - r * 0.25, r * 0.3, 0, 2 * Math.PI)
    g.fillStyle = OFFICE_VIRUS_COLORS.eye
    g.fill()
    g.beginPath()
    g.arc(bx + side * r * 0.42, by - r * 0.18, r * 0.14, 0, 2 * Math.PI)
    g.fillStyle = OFFICE_VIRUS_COLORS.outline
    g.fill()
  }
  g.restore()
}

// Relative luminance and CIE lightness, so hd keeps its outlines inked and its layers apart from the sky.

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

const linearOf = (color: number, shift: number): number => LINEAR[(color >> shift) & 255] ?? 0

const encodedOf = (linear: number, round: (n: number) => number): number => {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, round(c * 255)))
}

export const luminanceOf = (color: number): number =>
  0.2126 * linearOf(color, 16) + 0.7152 * linearOf(color, 8) + 0.0722 * linearOf(color, 0)

/** CIE L*, 0 to 100: equal steps look equally far apart, even among dark colours. */
export const lightnessOfLuminance = (y: number): number =>
  y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27

export const luminanceOfLightness = (l: number): number =>
  l > 8 ? ((l + 16) / 116) ** 3 : (Math.max(0, l) * 27) / 24389

export const lightnessOf = (color: number): number => lightnessOfLuminance(luminanceOf(color))

/** The colour scaled toward black or mixed toward white in linear light until its luminance is `target`. */
export const withLuminance = (color: number, target: number): number => {
  const r = linearOf(color, 16)
  const g = linearOf(color, 8)
  const b = linearOf(color, 0)
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Why the rounding: darkening rounds down and lightening up, so the result never falls short.
  if (target <= y) {
    const k = y === 0 ? 0 : Math.max(0, target) / y
    const down = (c: number): number => encodedOf(c * k, Math.floor)
    return (down(r) << 16) | (down(g) << 8) | down(b)
  }
  const t = Math.min(1, (target - y) / Math.max(1e-9, 1 - y))
  const up = (c: number): number => encodedOf(c + (1 - c) * t, Math.ceil)
  return (up(r) << 16) | (up(g) << 8) | up(b)
}

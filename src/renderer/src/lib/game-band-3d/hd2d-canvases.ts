// The land's canvas-drawn images (sky gradient, sun disc, ground field), shared by every library.
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import type { Hd2dWorld } from './hd2d-world'

export const cssColorOf = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

/** One row per sky colour, two columns wide; sample it linearly to stretch it over the band. */
export const skyCanvasOf = (world: Hd2dWorld): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = world.sky.length
  const g = canvas.getContext('2d')
  world.sky.forEach((color, y) => {
    if (g !== null) {
      g.fillStyle = cssColorOf(color)
      g.fillRect(0, y, 2, 1)
    }
  })
  return canvas
}

/** The sun or moon with a soft halo. */
export const sunCanvasOf = (world: Hd2dWorld): HTMLCanvasElement => {
  const disc = world.night > 0.5 ? 0xe8ecff : mix(world.sun.color, 0xffffff, 0.3)
  const halo = `rgba(${(disc >> 16) & 255},${(disc >> 8) & 255},${disc & 255},0.35)`
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g !== null) {
    const fill = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    fill.addColorStop(0, cssColorOf(disc))
    fill.addColorStop(0.28, cssColorOf(disc))
    fill.addColorStop(0.36, halo)
    fill.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = fill
    g.fillRect(0, 0, 128, 128)
  }
  return canvas
}

/** The ground's field texture repeats every this many world units. */
export const GROUND_TILE = 24
/** Mean grass-to-soil mix of the field noise, for libraries that paint the ground flat. */
export const GROUND_SOIL_MIX = 0.225

/** Grass with value noise so the ground reads as a field; tiles seamlessly. */
export const groundCanvasOf = (world: Hd2dWorld): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g !== null) {
    for (let y = 0; y < 128; y += 4) {
      for (let x = 0; x < 128; x += 4) {
        const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
        g.fillStyle = cssColorOf(mix(world.grass, world.soil, Math.abs(n) * 0.45))
        g.fillRect(x, y, 4, 4)
      }
    }
  }
  return canvas
}

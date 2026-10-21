import { describe, expect, it } from 'vitest'

import {
  costumeSpriteOf,
  frameSpriteOf,
  hdSpritePixel,
  isHdHaloAt,
  outlineOf,
  ringOf
} from '../hooks/hd-sprite'
import { mix } from '../hooks/pixel-canvas'
import { sceneOf } from '../hooks/scenes/index'

describe('hd sprites', () => {
  it('rings any art with a 1-px outline', () => {
    const sprite = frameSpriteOf(['X'], { X: 0xff0000 })
    expect(sprite.rows).toEqual(['.#.', '#X#', '.#.'])
  })

  it('inks the outline from the palette’s own darkest colour', () => {
    expect(outlineOf({ A: 0xffffff, B: 0x404040 })).toBe(mix(0x404040, 0x000000, 0.55))
    expect(outlineOf({ A: 0x30a0ff })).not.toBe(outlineOf({ A: 0xff8040 }))
    const sprite = frameSpriteOf(['X'], { X: 0x30a0ff })
    expect(hdSpritePixel(sprite, 1, 0, 0, 0)).toBe(outlineOf({ X: 0x30a0ff }))
    const ring = hdSpritePixel(sprite, 1, 0, 0, 0, 0x4fc3f7)
    expect(ring).toBe(ringOf(sprite, 0x4fc3f7))
    expect([ring === 0x4fc3f7, ring === sprite.outline]).toEqual([false, false])
  })

  it('lights the top-left, shades the bottom-right and keeps the costume colour inside', () => {
    const sprite = frameSpriteOf(['XXX', 'XXX', 'XXX'], { X: 0x808080 })
    expect(hdSpritePixel(sprite, 1, 1, 0, 0)).toBe(mix(0x808080, 0xffffff, 0.18))
    expect(hdSpritePixel(sprite, 3, 3, 0, 0)).toBe(mix(0x808080, 0x000000, 0.24))
    expect(hdSpritePixel(sprite, 2, 2, 0, 0)).toBe(0x808080)
    expect(hdSpritePixel(sprite, 0, 0, 0, 0)).toBeUndefined()
  })

  it('stands a costume on its legs and sits it without them', () => {
    const costume = sceneOf('quest').costumes.working
    expect(costumeSpriteOf(costume, 0, false).rows).toHaveLength(costume.rows.length + 3)
    expect(costumeSpriteOf(costume, 0, true).rows).toHaveLength(costume.rows.length + 2)
    expect(costumeSpriteOf(costume, 1, false)).toBe(costumeSpriteOf(costume, 3, false))
  })

  it('backs a gap with the figure on both sides and above it, so the land does not show through', () => {
    const sprite = frameSpriteOf(['XXXXX', 'X...X', 'X...X'], { X: 0x808080 })
    // The middle of the gap between the legs, and the row the legs end on.
    expect(hdSpritePixel(sprite, 3, 3, 0, 0)).toBe(sprite.outline)
    expect(hdSpritePixel(sprite, 3, 4, 0, 0)).toBe(sprite.outline)
  })

  it('keeps a notch open to the sky open, as between two ears', () => {
    const sprite = frameSpriteOf(['X...X', 'X...X', 'XXXXX'], { X: 0x808080 })
    expect(hdSpritePixel(sprite, 3, 0, 0, 0)).toBeUndefined()
    expect(hdSpritePixel(sprite, 3, 1, 0, 0)).toBeUndefined()
  })

  it('leaves no see-through gap inside any built-in costume', () => {
    for (const id of ['quest', 'vigilante', 'jrpg', 'tamer']) {
      for (const costume of Object.values(sceneOf(id).costumes)) {
        const sprite = costumeSpriteOf(costume, 0, false)
        sprite.rows.forEach((row, r) => {
          for (let c = 0; c < row.length; c += 1) {
            const isOpen = row[c] === '.'
            const isFlanked = /[^.]/.test(row.slice(0, c)) && /[^.]/.test(row.slice(c + 1))
            const isUnder = sprite.rows.slice(0, r).some((above) => (above[c] ?? '.') !== '.')
            expect(isOpen && isFlanked && isUnder, `${id} r${r} c${c}`).toBe(false)
          }
        })
      }
    }
  })

  it('rings the outline with a halo one pixel outside it, never inside the figure', () => {
    const sprite = frameSpriteOf(['X'], { X: 0x808080 })
    expect(isHdHaloAt(sprite, 1, -1, 0, 0)).toBe(true)
    expect(isHdHaloAt(sprite, 0, 0, 0, 0)).toBe(true)
    expect(isHdHaloAt(sprite, 1, 1, 0, 0)).toBe(false)
    expect(isHdHaloAt(sprite, 1, 0, 0, 0)).toBe(false)
    expect(isHdHaloAt(sprite, 5, 5, 0, 0)).toBe(false)
  })
})

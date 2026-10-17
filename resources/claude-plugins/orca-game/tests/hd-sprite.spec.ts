import { describe, expect, it } from 'vitest'

import { costumeSpriteOf, frameSpriteOf, hdSpritePixel, outlineOf } from '../hooks/hd-sprite'
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
    expect(hdSpritePixel(sprite, 1, 0, 0, 0, 0x4fc3f7)).toBe(0x4fc3f7)
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
})

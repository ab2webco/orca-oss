import { describe, expect, it } from 'vitest'
import { computeScrollbarThumb, scrollLeftFromThumbLeft } from './plane-board-minimap-geometry'

describe('computeScrollbarThumb', () => {
  it('sizes the thumb by the visible fraction of the content', () => {
    // Half the content is visible -> thumb spans half the track.
    expect(
      computeScrollbarThumb({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 500, trackWidth: 200 })
    ).toEqual({ thumbWidth: 100, thumbLeft: 0 })
  })

  it('positions the thumb proportionally to scrollLeft', () => {
    expect(
      computeScrollbarThumb({
        scrollLeft: 250,
        scrollWidth: 1000,
        clientWidth: 500,
        trackWidth: 200
      })
    ).toEqual({ thumbWidth: 100, thumbLeft: 50 })
  })

  it('clamps the thumb to the end of the track at max scroll', () => {
    const { thumbLeft, thumbWidth } = computeScrollbarThumb({
      scrollLeft: 500,
      scrollWidth: 1000,
      clientWidth: 500,
      trackWidth: 200
    })
    expect(thumbLeft + thumbWidth).toBe(200)
  })

  it('returns a zero thumb for degenerate metrics', () => {
    expect(
      computeScrollbarThumb({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0, trackWidth: 0 })
    ).toEqual({ thumbWidth: 0, thumbLeft: 0 })
  })
})

describe('scrollLeftFromThumbLeft', () => {
  it('is the inverse of the thumb-left mapping', () => {
    expect(
      scrollLeftFromThumbLeft({
        thumbLeft: 50,
        scrollWidth: 1000,
        clientWidth: 500,
        trackWidth: 200
      })
    ).toBe(250)
  })

  it('clamps below zero to zero', () => {
    expect(
      scrollLeftFromThumbLeft({
        thumbLeft: -40,
        scrollWidth: 1000,
        clientWidth: 500,
        trackWidth: 200
      })
    ).toBe(0)
  })

  it('clamps past the end to scrollWidth - clientWidth', () => {
    expect(
      scrollLeftFromThumbLeft({
        thumbLeft: 500,
        scrollWidth: 1000,
        clientWidth: 500,
        trackWidth: 200
      })
    ).toBe(500)
  })

  it('round-trips with computeScrollbarThumb', () => {
    const metrics = { scrollLeft: 320, scrollWidth: 1400, clientWidth: 600, trackWidth: 240 }
    const { thumbLeft } = computeScrollbarThumb(metrics)
    expect(scrollLeftFromThumbLeft({ ...metrics, thumbLeft })).toBeCloseTo(320, 5)
  })
})

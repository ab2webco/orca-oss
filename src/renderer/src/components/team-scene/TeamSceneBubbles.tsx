import React, { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  layoutTeamSceneBubbles,
  teamSceneCellUnder,
  teamSceneTailRunsOf,
  type TeamSceneBubbleBox,
  type TeamSceneRect
} from './team-scene-bubble-layout'
import { pixelCloudOf } from './team-scene-pixel-cloud'

export type TeamSceneSpeech = {
  key: string
  text: string
  anchor: { x: number; top: number }
  align?: 'center' | 'end'
  /** Gives its spot up when only one bubble fits, as the advisor's does (its line stays in its card). */
  yields?: boolean
  /** The lead by an asking member: its tail may pass behind that tag when nothing else fits. */
  attending?: boolean
}

type Props = {
  speeches: TeamSceneSpeech[]
  width: number
  height: number
  /** Pixel's scene pixel size: draw the game's thought cloud instead of the dark bubble. */
  cloudPixel?: number
  /** What no bubble may cover, such as an asking member's tag. */
  obstacles?: readonly TeamSceneRect[]
  /** Told after each layout which speeches no bubble shows whole (none, or clamped), so their lines can show elsewhere. */
  onUnplaced?: (keys: string[]) => void
  /** Where the stage starts to show; no bubble starts above it. 0 when the stage shows whole. */
  visibleTop?: number
}

const NONE: readonly TeamSceneRect[] = []

// Why: the cloud carries its own trail, drawn on the scene's grid from the bubble to the head.
function PixelCloudCanvas({
  box,
  anchorTop,
  pixel,
  obstacles
}: {
  box: TeamSceneBubbleBox
  anchorTop: number
  pixel: number
  /** Tags its trail passes behind: no cell is painted over one. */
  obstacles: readonly TeamSceneRect[]
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const width = Math.ceil(box.width / pixel)
  const height = Math.ceil(box.height / pixel)
  const tailX = Math.round(box.tailX / pixel)
  const tailY = Math.round((anchorTop - box.top) / pixel) - 1
  const cloud = pixelCloudOf({ width, height, tailX, tailY, bob: 0 })
  useLayoutEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g) {
      return
    }
    g.clearRect(0, 0, width, cloud.rows)
    for (const [key, color] of cloud.pixels) {
      const [x, y] = [key % 4096, Math.floor(key / 4096)]
      const cell = { x: box.left + x * pixel, y: box.top + y * pixel, size: pixel }
      if (!teamSceneCellUnder(cell, obstacles)) {
        g.fillStyle = color
        g.fillRect(x, y, 1, 1)
      }
    }
  })
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      width={width}
      height={cloud.rows}
      className="absolute left-0 top-0 -z-10 [image-rendering:pixelated]"
      style={{ width: width * pixel, height: cloud.rows * pixel }}
    />
  )
}

/** Bubbles over the canvas tied to their speakers: a dark card with a hairline, or Pixel's cloud. */
export function TeamSceneBubbles({
  speeches,
  width,
  height,
  cloudPixel,
  obstacles = NONE,
  onUnplaced,
  visibleTop = 0
}: Props): React.JSX.Element {
  const refs = useRef(new Map<string, HTMLSpanElement>())
  const [boxes, setBoxes] = useState<TeamSceneBubbleBox[]>([])
  // Why a content key: callers rebuild the array each render, and layout sets state.
  const layoutKey = [
    // Why attending too: it changes where a lead's bubble may go, with no other change to see.
    ...speeches.map(
      (s) => `${s.key}:${s.text}:${s.anchor.x}:${s.anchor.top}:${s.attending === true}`
    ),
    ...obstacles.map((o) => `${o.left},${o.top},${o.width},${o.height}`)
  ].join('|')

  useLayoutEffect(() => {
    const requests = speeches.map((s) => {
      const el = refs.current.get(s.key)
      if (!el) {
        return {
          key: s.key,
          anchor: s.anchor,
          align: s.align,
          yields: s.yields,
          attending: s.attending,
          width: 0,
          height: 0
        }
      }
      // Why max-content: a row-shared cloud keeps its narrowed width until laid out again, and
      // text that may break anywhere would shrink to the room left of its old spot.
      const laid = el.style.width
      el.style.width = 'max-content'
      // Why +1: offsetWidth rounds, and a box half a pixel short wraps the line its cloud was sized for.
      const size = { width: el.offsetWidth + 1, height: el.offsetHeight }
      // Why measured on one line too: an attending lead's line clamps to it when two find no room.
      // Why the text too: its pre-line keeps a question's line break, which nowrap must override.
      const text = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : null
      const wrap = [el.style.whiteSpace, text?.style.whiteSpace ?? '']
      el.style.whiteSpace = 'nowrap'
      if (text) {
        text.style.whiteSpace = 'nowrap'
      }
      const oneLine = s.attending
        ? { width: el.offsetWidth + 1, height: el.offsetHeight }
        : undefined
      el.style.whiteSpace = wrap[0]!
      if (text) {
        text.style.whiteSpace = wrap[1]!
      }
      // Why restore: React skips a width equal to its last one, which would leave max-content.
      el.style.width = laid
      return {
        key: s.key,
        anchor: s.anchor,
        align: s.align,
        yields: s.yields,
        attending: s.attending,
        oneLine,
        ...size
      }
    })
    const laid = layoutTeamSceneBubbles(
      requests,
      { width, height, top: visibleTop },
      { beside: Boolean(cloudPixel), obstacles }
    )
    setBoxes(laid)
    // Why clamped too: a line cut to one in its bubble is not whole there either, so its card shows it.
    const whole = new Set(laid.filter((b) => !b.clamped).map((b) => b.key))
    onUnplaced?.(speeches.filter((s) => !whole.has(s.key)).map((s) => s.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKey stands for speeches and obstacles
  }, [layoutKey, width, height, cloudPixel, visibleTop])

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      data-scene-visible-top={visibleTop}
      data-scene-obstacles={obstacles.length}
    >
      {speeches.map((s) => {
        const box = boxes.find((b) => b.key === s.key)
        const tail = box ? Math.max(4, s.anchor.top - box.top - box.height) : 0
        return (
          <span
            key={s.key}
            ref={(el) => {
              if (el) {
                refs.current.set(s.key, el)
              } else {
                refs.current.delete(s.key)
              }
            }}
            data-scene-bubble={s.key}
            // Why fixed and solid: the scene sky is dark in both themes, so the bubble is too.
            className={
              cloudPixel
                ? 'absolute isolate max-w-[170px] px-2 pb-3 pt-4 font-mono text-[10px] leading-tight text-scene-cloud-ink'
                : 'absolute max-w-[170px] rounded-lg border border-white/15 bg-scene-bubble px-2 py-1 text-[10.5px] leading-snug text-white'
            }
            style={{
              left: box?.left ?? 0,
              top: box?.top ?? 0,
              width: box?.width,
              visibility: box ? 'visible' : 'hidden'
            }}
          >
            {/* Why anywhere: a long path or command has no space to break at, and was cut mid-word. */}
            {/* Why pre-line and three: a waiting lead's line is its state over the question; one when clamped. */}
            <span
              className={cn(
                'whitespace-pre-line [overflow-wrap:anywhere]',
                box?.clamped ? 'line-clamp-1' : 'line-clamp-3'
              )}
            >
              {s.text}
            </span>
            {box && cloudPixel ? (
              <PixelCloudCanvas
                box={box}
                anchorTop={s.anchor.top}
                pixel={cloudPixel}
                obstacles={obstacles}
              />
            ) : null}
            {box && !cloudPixel
              ? // Why in runs: where the tail passes behind a tag, that stretch is not drawn.
                teamSceneTailRunsOf(box, box.top + box.height + tail, obstacles).map(
                  (run, i, all) => (
                    <span
                      key={run.from}
                      className="absolute w-px bg-white/50"
                      style={{
                        left: box.tailX,
                        top: run.from - box.top,
                        height: run.to - run.from
                      }}
                    >
                      {i === all.length - 1 ? (
                        <span className="absolute -left-[2px] bottom-0 size-[5px] rounded-full bg-white/70" />
                      ) : null}
                    </span>
                  )
                )
              : null}
          </span>
        )
      })}
    </div>
  )
}

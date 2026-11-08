import React, { useLayoutEffect, useRef, useState } from 'react'
import { layoutTeamSceneBubbles, type TeamSceneBubbleBox } from './team-scene-bubble-layout'
import { pixelCloudOf } from './team-scene-pixel-cloud'

export type TeamSceneSpeech = {
  key: string
  text: string
  anchor: { x: number; top: number }
  align?: 'center' | 'end'
}

type Props = {
  speeches: TeamSceneSpeech[]
  width: number
  height: number
  /** Pixel's scene pixel size: draw the game's thought cloud instead of the glass bubble. */
  cloudPixel?: number
}

// Why: the cloud carries its own trail, drawn on the scene's grid from the bubble to the head.
function PixelCloudCanvas({
  box,
  anchorTop,
  pixel
}: {
  box: TeamSceneBubbleBox
  anchorTop: number
  pixel: number
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
      g.fillStyle = color
      g.fillRect(key % 4096, Math.floor(key / 4096), 1, 1)
    }
  })
  return (
    <canvas
      ref={ref}
      width={width}
      height={cloud.rows}
      className="absolute left-0 top-0 -z-10 [image-rendering:pixelated]"
      style={{ width: width * pixel, height: cloud.rows * pixel }}
    />
  )
}

/** Bubbles over the canvas tied to their speakers: glass with a hairline, or Pixel's cloud. */
export function TeamSceneBubbles({
  speeches,
  width,
  height,
  cloudPixel
}: Props): React.JSX.Element {
  const refs = useRef(new Map<string, HTMLSpanElement>())
  const [boxes, setBoxes] = useState<TeamSceneBubbleBox[]>([])
  // Why a content key: callers rebuild the array each render, and layout sets state.
  const layoutKey = speeches
    .map((s) => `${s.key}:${s.text}:${s.anchor.x}:${s.anchor.top}`)
    .join('|')

  useLayoutEffect(() => {
    const requests = speeches.map((s) => {
      const el = refs.current.get(s.key)
      if (!el) {
        return { key: s.key, anchor: s.anchor, align: s.align, width: 0, height: 0 }
      }
      // Why max-content: a row-shared cloud keeps its narrowed width until laid out again, and
      // text that may break anywhere would shrink to the room left of its old spot.
      const laid = el.style.width
      el.style.width = 'max-content'
      // Why +1: offsetWidth rounds, and a box half a pixel short wraps the line its cloud was sized for.
      const size = { width: el.offsetWidth + 1, height: el.offsetHeight }
      // Why restore: React skips a width equal to its last one, which would leave max-content.
      el.style.width = laid
      return { key: s.key, anchor: s.anchor, align: s.align, ...size }
    })
    setBoxes(layoutTeamSceneBubbles(requests, { width, height }, { beside: Boolean(cloudPixel) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKey stands for speeches
  }, [layoutKey, width, height, cloudPixel])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
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
            // Why fixed glass: the scene sky is dark in both themes, so the bubble is too.
            className={
              cloudPixel
                ? 'absolute isolate max-w-[170px] px-2 pb-3 pt-4 font-mono text-[10px] leading-tight text-[#23232b]'
                : 'absolute max-w-[170px] rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-[10.5px] leading-snug text-white backdrop-blur-sm'
            }
            style={{
              left: box?.left ?? 0,
              top: box?.top ?? 0,
              width: box?.width,
              visibility: box ? 'visible' : 'hidden'
            }}
          >
            {/* Why anywhere: a long path or command has no space to break at, and was cut mid-word. */}
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{s.text}</span>
            {box && cloudPixel ? (
              <PixelCloudCanvas box={box} anchorTop={s.anchor.top} pixel={cloudPixel} />
            ) : null}
            {box && !cloudPixel ? (
              <span
                className="absolute top-full w-px bg-white/50"
                style={{ left: box.tailX, height: tail }}
              >
                <span className="absolute -left-[2px] bottom-0 size-[5px] rounded-full bg-white/70" />
              </span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

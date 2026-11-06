import React, { useLayoutEffect, useRef, useState } from 'react'
import { layoutTeamSceneBubbles, type TeamSceneBubbleBox } from './team-scene-bubble-layout'

export type TeamSceneSpeech = { key: string; text: string; anchor: { x: number; top: number } }

type Props = { speeches: TeamSceneSpeech[]; width: number; height: number }

/** Glass bubbles over the canvas, each tied to its speaker by a hairline ending in a dot. */
export function TeamSceneBubbles({ speeches, width, height }: Props): React.JSX.Element {
  const refs = useRef(new Map<string, HTMLSpanElement>())
  const [boxes, setBoxes] = useState<TeamSceneBubbleBox[]>([])
  // Why a content key: callers rebuild the array each render, and layout sets state.
  const layoutKey = speeches
    .map((s) => `${s.key}:${s.text}:${s.anchor.x}:${s.anchor.top}`)
    .join('|')

  useLayoutEffect(() => {
    const requests = speeches.map((s) => {
      const el = refs.current.get(s.key)
      return {
        key: s.key,
        anchor: s.anchor,
        width: el?.offsetWidth ?? 0,
        height: el?.offsetHeight ?? 0
      }
    })
    setBoxes(layoutTeamSceneBubbles(requests, { width, height }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKey stands for speeches
  }, [layoutKey, width, height])

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
            className="absolute max-w-[170px] rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-[10.5px] leading-snug text-white backdrop-blur-sm"
            style={{
              left: box?.left ?? 0,
              top: box?.top ?? 0,
              visibility: box ? 'visible' : 'hidden'
            }}
          >
            <span className="line-clamp-2">{s.text}</span>
            {box ? (
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

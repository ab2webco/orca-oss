import { useContext, useEffect, useRef } from 'react'
import { TeamScenePainterContext } from '../team-scene/team-scene-painter-context'
import type { TeamScenePortraitSubject } from '../team-scene/team-scene-painter'

const SIZE = 38

/** V28's card face; nothing without a scene painter that can draw one. */
export function TeamCardFace({ who }: { who: TeamScenePortraitSubject }): React.JSX.Element | null {
  const painter = useContext(TeamScenePainterContext)
  const ref = useRef<HTMLCanvasElement>(null)
  const { role, key, characterKey, name } = who
  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g || !painter?.portrait) {
      return
    }
    const ratio = window.devicePixelRatio || 1
    canvas.width = SIZE * ratio
    canvas.height = SIZE * ratio
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, SIZE, SIZE)
    painter.portrait(g, { role, key, characterKey, name }, SIZE)
  }, [painter, role, key, characterKey, name])
  if (!painter?.portrait) {
    return null
  }
  return (
    <canvas
      ref={ref}
      data-team-face=""
      aria-hidden="true"
      className="shrink-0 rounded-[9px] bg-muted"
      style={{ width: SIZE, height: SIZE }}
    />
  )
}

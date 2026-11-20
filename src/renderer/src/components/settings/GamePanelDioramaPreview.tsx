import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { dioramaPlotViewOf } from '../../../../shared/team-scene/team-diorama-actions'
import { teamDioramaLayoutOf } from '../../../../shared/team-scene/team-diorama-layout'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { dioramaStage } from '../team-scene/team-diorama-stage'
import { dioramaView } from '../team-scene/team-diorama-view'
import { useTeamSceneStatusColors } from '../team-scene/team-scene-status-colors'
import { translate } from '@/i18n/i18n'

// Why a still frame: Settings shows what Figures looks like; one frame costs no animation loop.

const member = (
  key: string,
  activity: TeamSceneMemberInput['activity'],
  stage: TeamSceneMemberInput['site']['stage'],
  ci?: TeamSceneMemberInput['ci']
): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: key,
  activity,
  reportId: null,
  mergedPr: null,
  site: { stage, broken: false },
  ...(ci ? { ci } : {})
})

/** Figures as the diorama on a small team: building, under review, and fishing. */
export function GamePanelDioramaPreview({
  lite,
  onNoWebgl
}: {
  /** Low resources, so the preview shows what the chosen quality draws. */
  lite: boolean
  onNoWebgl: () => void
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const status = useTeamSceneStatusColors()
  const [width, setWidth] = useState(0)
  const leadName = translate('auto.components.settings.GamePanelStylePreview.lead', 'Lead')
  useEffect(() => {
    const el = canvas.current?.parentElement
    if (!el) {
      return
    }
    const observer = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)))
    observer.observe(el)
    setWidth(Math.round(el.clientWidth))
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const el = canvas.current
    if (!el) {
      return
    }
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true })
    } catch {
      onNoWebgl()
      return
    }
    if (width === 0) {
      renderer.dispose()
      return
    }
    const members = [
      member('a', 'working', 1),
      member('b', 'working', 3, 'pending'),
      member('c', 'resting', 1)
    ]
    const input: TeamSceneInput = {
      lead: { key: 'lead', name: leadName, characterKey: null, activity: 'working' },
      advisor: null,
      members
    }
    const layout = teamDioramaLayoutOf([
      {
        key: '',
        name: '',
        home: true,
        reachable: true,
        members: ['a', 'b', 'c'],
        cap: null,
        taken: 0
      }
    ])
    const views = new Map(members.map((m) => [m.key, dioramaPlotViewOf(m)]))
    const stage = dioramaStage(renderer, {
      width,
      dark: document.documentElement.classList.contains('dark'),
      status,
      input,
      layout,
      views,
      cues: [],
      lite,
      pace: 'normal',
      view: { ...dioramaView(), mode: 'all' }
    })
    stage.draw(1.3)
    el.dataset.dioramaPreview = 'drawn'
    return () => {
      stage.dispose()
      renderer.dispose()
    }
  }, [width, status, leadName, onNoWebgl, lite])
  return <canvas ref={canvas} className="block w-full" data-diorama-preview="" />
}

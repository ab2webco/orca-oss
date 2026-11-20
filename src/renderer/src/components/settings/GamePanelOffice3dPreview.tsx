import { useEffect, useRef, useState } from 'react'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { teamOffice3dLayoutOf } from '../../../../shared/team-scene/team-office3d-layout'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { dioramaRenderer } from '../team-scene/team-diorama-stage'
import { office3dStage } from '../team-scene/team-office3d-stage'
import { useTeamSceneStatusColors } from '../team-scene/team-scene-status-colors'
import { localHostDisplayLabel } from '@/lib/local-host-display-label'
import { translate } from '@/i18n/i18n'

// Why a still frame: Settings shows what the Office looks like; one frame costs no animation loop.

const member = (key: string, activity: TeamSceneMemberInput['activity']): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: key,
  activity,
  reportId: null,
  mergedPr: null,
  site: { stage: 2, broken: false }
})

/** The Office as the 3D building on a small team: two at work, one asking. */
export function GamePanelOffice3dPreview({
  onNoWebgl
}: {
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
    const renderer = dioramaRenderer(el, true)
    if (!renderer) {
      onNoWebgl()
      return
    }
    if (width === 0) {
      renderer.dispose()
      return
    }
    const members = [member('a', 'working'), member('b', 'needsYou'), member('c', 'working')]
    const input: TeamSceneInput = {
      lead: { key: 'lead', name: leadName, characterKey: null, activity: 'working' },
      advisor: null,
      members
    }
    const layout = teamOffice3dLayoutOf(
      [
        {
          key: '',
          host: { kind: 'local' },
          members: members.map((m) => ({ paneKey: m.key }) as TeamMemberCard),
          cap: 5,
          running: 3,
          reachable: true,
          lead: true,
          taken: 0,
          free: 2
        }
      ],
      { leadAdvisor: false }
    )
    const stage = office3dStage(renderer, {
      width,
      dark: document.documentElement.classList.contains('dark'),
      status,
      input,
      layout,
      pace: 'normal',
      maxHeight: 280,
      words: {
        thisMachine: localHostDisplayLabel(),
        offline: translate('teamPanel.machines.offline', 'Offline')
      }
    })
    stage.draw(1.3)
    el.dataset.office3dPreview = 'drawn'
    return () => {
      stage.dispose()
      renderer.dispose()
    }
  }, [width, status, leadName, onNoWebgl])
  return <canvas ref={canvas} className="block w-full" data-office3d-preview="" />
}

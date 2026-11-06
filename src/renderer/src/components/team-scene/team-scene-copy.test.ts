import { afterEach, describe, expect, it } from 'vitest'
import { setRendererUiLanguage } from '@/i18n/i18n'
import type { TeamLeadCard } from '../../../../shared/team-panel-model-types'
import { teamSceneLabel, teamSceneLeadLineOf } from './team-scene-copy'

type Lead = Pick<TeamLeadCard, 'liveAction' | 'status'>
const lead = (extra: Partial<Lead> = {}): Lead => ({
  liveAction: null,
  status: 'working',
  ...extra
})

afterEach(async () => {
  await setRendererUiLanguage('en')
})

describe('team scene copy', () => {
  it('labels the scene in the UI language', async () => {
    expect(teamSceneLabel()).toBe('Live team scene')
    await setRendererUiLanguage('es')
    expect(teamSceneLabel()).toBe('Escena en vivo del equipo')
  })

  it('words a question as waiting for the user, in the UI language', async () => {
    const asking = lead({ liveAction: { kind: 'question', text: '¿Mergeo #923?', options: [] } })
    expect(teamSceneLeadLineOf(asking)).toBe('Waiting for you · ¿Mergeo #923?')
    await setRendererUiLanguage('es')
    expect(teamSceneLeadLineOf(asking)).toBe('Esperándote · ¿Mergeo #923?')
  })

  it('shows a tool step or a link as written, like the sidebar rows', () => {
    expect(
      teamSceneLeadLineOf(
        lead({ liveAction: { kind: 'tool', tool: 'Bash', detail: 'gh pr checks 924' } })
      )
    ).toBe('Bash: gh pr checks 924')
    expect(
      teamSceneLeadLineOf(lead({ liveAction: { kind: 'tool', tool: 'Read', detail: null } }))
    ).toBe('Read')
    expect(
      teamSceneLeadLineOf(
        lead({
          liveAction: { kind: 'link', name: 'Plane', id: 'ORCA-1051', url: 'u', running: true }
        })
      )
    ).toBe('Plane ORCA-1051')
  })

  it('says the lead is done in the UI language, and nothing while it idles', async () => {
    expect(teamSceneLeadLineOf(lead({ status: 'done' }))).toBe('Done, nothing pending')
    await setRendererUiLanguage('es')
    expect(teamSceneLeadLineOf(lead({ status: 'done' }))).toBe('Listo, sin tareas pendientes')
    expect(teamSceneLeadLineOf(lead({ status: 'idle' }))).toBeNull()
  })
})

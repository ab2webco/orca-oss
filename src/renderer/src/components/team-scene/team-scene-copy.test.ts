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

  // hallmark rule 10: no middle-dot joiner; the state on one line, the question under it.
  it('words a question as waiting for the user over the question, in the UI language', async () => {
    const asking = lead({ liveAction: { kind: 'question', text: '¿Mergeo #923?', options: [] } })
    expect(teamSceneLeadLineOf(asking)).toBe('Waiting for you\n¿Mergeo #923?')
    await setRendererUiLanguage('es')
    expect(teamSceneLeadLineOf(asking)).toBe('Esperándote\n¿Mergeo #923?')
  })

  // Why (ORCA-1129): with no question read, the bubble showed the raw tool name.
  it('never names the question tool, in the UI language', async () => {
    const asking = lead({ liveAction: { kind: 'tool', tool: 'AskUserQuestion', detail: null } })
    expect(teamSceneLeadLineOf(asking)).toBe('Waiting for you')
    await setRendererUiLanguage('es')
    expect(teamSceneLeadLineOf(asking)).toBe('Esperándote')
  })

  // ORCA-1139: V28's bubble names the step (`gh pr view 923`), never a raw line with flags and ids.
  it.each([
    ['gh pr view 923', 'gh pr view 923'],
    [
      'orca orchestration reply --id msg_5843aeef4a69 --body "Looks good, merge"',
      'orca orchestration reply'
    ],
    ['"$ORCA_GAME_CLI" game state --json 2>&1 | head -40', 'orca game state'],
    ['cd /Users/someone/repo && npm test -- --run src/a.test.ts', 'npm test'],
    ['python3 /Users/someone/scripts/check.py --limit 3', 'python3 check.py'],
    ["git commit -q -m 'fix: thing'", 'git commit'],
    ['FOO=1 pnpm run lint', 'pnpm run lint']
  ])('shortens the shell line %j to %j', (detail, label) => {
    expect(teamSceneLeadLineOf(lead({ liveAction: { kind: 'tool', tool: 'Bash', detail } }))).toBe(
      label
    )
  })

  it('names a file tool by the file, not its path', () => {
    expect(
      teamSceneLeadLineOf(
        lead({ liveAction: { kind: 'tool', tool: 'Read', detail: '/Users/someone/src/app.ts' } })
      )
    ).toBe('Read app.ts')
  })

  it('labels a bare tool by its name, or a link as written', () => {
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

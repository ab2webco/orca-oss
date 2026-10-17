import { describe, expect, it } from 'vitest'

import { stateReportOf } from '../hooks/state-report'
import { stateReportWordsOf } from '../hooks/state-report-words'

const EN = stateReportWordsOf('en')

const member = (name: string, patch: Record<string, unknown>) => ({
  paneKey: `tab-1:${name}`,
  displayName: name,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...patch
})

const STATE = {
  config: {
    mode: 'zen',
    scene: 'file:orca/scene.json',
    hud: true,
    rewards: false,
    tracker: true,
    openLinks: 'orca',
    render: 'classic',
    timezone: 'America/Bogota'
  },
  sources: {
    mode: 'project',
    scene: 'project',
    hud: 'default',
    rewards: 'local',
    tracker: 'default',
    openLinks: 'default',
    render: 'default',
    timezone: 'global'
  },
  warnings: ['orchestratorGame.extra is not a known setting'],
  worktree: { id: 'wt-1', path: '/w/cineco', branch: 'main', displayName: 'cineco' },
  agents: [
    {
      paneKey: 'tab-1:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: true
    },
    member('CIN-12 checkout', {
      review: {
        provider: 'github',
        number: 41,
        title: 'feat: checkout',
        url: 'https://github.com/o/r/pull/41',
        state: 'open',
        ci: 'pending'
      },
      worktree: { id: 'wt-2', branch: 'feat/cin-12', displayName: 'cin-12' }
    }),
    member('builder', {
      state: 'waiting',
      worktree: { id: 'wt-3', branch: 'feat/CIN-13-seats', displayName: 'seats' },
      workItem: {
        provider: 'jira',
        identifier: 'cin-13',
        title: 'Seats',
        url: 'https://jira.example.com/browse/CIN-13',
        status: 'In Progress',
        statusGroup: 'in_progress'
      }
    }),
    member('CIN-9 done', {
      state: 'idle',
      worktree: { id: 'wt-4', branch: 'feat/cin-9', displayName: 'cin-9' },
      review: {
        provider: 'github',
        number: 39,
        title: 'feat: nine',
        url: 'https://github.com/o/r/pull/39',
        state: 'merged',
        ci: 'success'
      }
    })
  ],
  review: null,
  workItem: null,
  links: [
    {
      id: 'board',
      kind: 'project',
      provider: 'jira',
      label: 'Board',
      url: 'https://jira.example.com/board'
    }
  ],
  lead: { autostart: true, cap: 4, label: 'orquestador' },
  role: 'lead',
  stopped: { since: '2026-10-17T15:00:00.000Z', by: 'lead' }
}

describe('stateReportOf', () => {
  it('reads every setting with its layer, the fleet with its slots, STOP, warnings and links', () => {
    expect(stateReportOf(JSON.stringify({ result: STATE }), {}, EN)).toBe(
      [
        'Agent Teams game · cineco (main)',
        'Mode      zen (from project)',
        'Scene     file:orca/scene.json (from project) · scene file orca/scene.json',
        'Render    classic (from default)',
        'Timezone  America/Bogota (from global)',
        'HUD on (from default) · rewards off (from local) · tracker on (from default)',
        'Lead      orquestador, this pane · 2 of 4 slots used, 2 free',
        '  CIN-12  working    PR #41 open, CI running',
        '  CIN-13  needs you  In Progress',
        '  CIN-9   finished   PR #39 merged, CI green',
        'STOP since 2026-10-17T15:00:00.000Z (by lead): nothing is launched or pushed until `game resume`',
        'Warnings',
        '  - orchestratorGame.extra is not a known setting',
        'Links',
        '  Board  https://jira.example.com/board'
      ].join('\n')
    )
  })

  it("adds this session's mode and render overrides where they differ from the config", () => {
    const report = stateReportOf(JSON.stringify(STATE), { mode: 'on', render: 'hd' }, EN) ?? ''
    expect(report).toContain('Mode      zen (from project) · this session: on (/orca-game:mode)')
    expect(report).toContain(
      'Render    classic (from default) · this session: hd (/orca-game:render)'
    )
    const same = stateReportOf(JSON.stringify(STATE), { mode: 'zen', render: 'classic' }, EN) ?? ''
    expect(same).not.toContain('this session')
  })

  it('says a member pane has no fleet of its own, and a lead with none yet that it has none', () => {
    const asMember = stateReportOf(JSON.stringify({ ...STATE, role: 'member' }), {}, EN) ?? ''
    expect(asMember).toContain('Lead      orquestador · this pane is a member and reports to it')
    expect(asMember).not.toContain('slots used')
    const empty = { ...STATE, agents: STATE.agents.slice(0, 1), stopped: null, warnings: [] }
    const idle = stateReportOf(JSON.stringify(empty), {}, EN) ?? ''
    expect(idle).toContain(
      'Lead      orquestador, this pane · 0 of 4 slots used, 4 free · no members yet'
    )
    expect(idle).not.toMatch(/STOP|Warnings/)
  })

  it('reads an older host with no layers, lead or STOP, and answers undefined for no state', () => {
    const old = { config: { mode: 'on', scene: 'quest', hud: true, rewards: true }, agents: [] }
    expect(stateReportOf(JSON.stringify(old), {}, EN)).toBe(
      ['Agent Teams game', 'Mode      on', 'Scene     quest', 'HUD on · rewards on'].join('\n')
    )
    expect(stateReportOf('not json', {}, EN)).toBeUndefined()
    expect(stateReportOf('[1]', {}, EN)).toBeUndefined()
  })

  it('speaks Spanish', () => {
    const report = stateReportOf(JSON.stringify(STATE), { render: 'hd' }, stateReportWordsOf('es'))
    expect(report).toContain(
      'Render        classic (de default) · esta sesión: hd (/orca-game:render)'
    )
    expect(report).toContain('Zona horaria  America/Bogota (de global)')
    expect(report).toContain(
      'Líder         orquestador, este panel · 2 de 4 cupos usados, 2 libres'
    )
    expect(report).toContain('  CIN-12  trabajando  PR #41 abierto, CI en curso')
    expect(report).toContain('  CIN-13  te espera   In Progress')
    expect(report).toContain('Avisos')
  })
})

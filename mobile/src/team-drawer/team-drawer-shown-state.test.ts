import { describe, expect, it } from 'vitest'
import { teamCardWordsOf } from './team-card-words'
import { teamLeadViewOf } from './team-drawer-model'
import { teamLeadLiveText } from './team-sheet-lead'

const member = (over: Record<string, unknown> = {}) => ({
  paneKey: 'tab-2:leaf',
  displayName: 'Rosalina ORCA-1198',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

const leader = (over: Record<string, unknown> = {}) => ({
  paneKey: 'tab-1:leaf',
  displayName: 'Alfred',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: true,
  isMember: false,
  ...over
})

const viewOf = (members: Record<string, unknown>[], lead = leader()) =>
  teamLeadViewOf({
    role: 'lead',
    lead: { autostart: false, cap: 4, agent: 'claude' },
    agents: [lead, ...members]
  })

const review = (ci: string, state = 'open') => ({
  provider: 'github',
  number: 1205,
  title: 't',
  url: 'https://github.com/o/r/pull/1205',
  state,
  ci
})

// Why (ORCA-1205 criterion 3): the phone mapped a raw `done` to "Terminado" and its own needs-you.
describe('the phone reads the desktop derived state', () => {
  it('reads a stopped member on red CI as idle with its CI, never done', () => {
    const [row] = viewOf([member({ state: 'done', review: review('failure') })])?.members ?? []
    expect(row).toMatchObject({ state: 'idle', idleCi: 'failure' })
  })

  it('keeps done for merged work', () => {
    const [row] =
      viewOf([member({ state: 'done', review: review('success', 'merged') })])?.members ?? []
    expect(row).toMatchObject({ state: 'done', idleCi: null })
  })

  it('names a permission prompt in the pane apart from an Inbox question', () => {
    const [row] = viewOf([member({ state: 'waiting', toolName: 'Bash' })])?.members ?? []
    expect(row).toMatchObject({ needsYou: true, ask: { kind: 'permission', tool: 'Bash' } })
  })

  it('reads the phase from what the member does', () => {
    const [tests] = viewOf([member({ toolName: 'Bash', toolInput: 'pnpm test' })])?.members ?? []
    expect(tests?.phase).toBe('tests')
    const [asking] =
      viewOf([member({ state: 'waiting', toolName: 'AskUserQuestion' })])?.members ?? []
    expect(asking?.phase).toBeNull()
  })

  it('says the lead waits on its members instead of Done', () => {
    const view = viewOf([member(), member({ paneKey: 'tab-3:leaf', state: 'waiting' })])
    expect(view?.lead && teamLeadLiveText(view.lead, teamCardWordsOf('en'))).toBe(
      'Waiting on 2 agents'
    )
    expect(view?.lead && teamLeadLiveText(view.lead, teamCardWordsOf('es'))).toBe(
      'Esperando a 2 agentes'
    )
  })
})

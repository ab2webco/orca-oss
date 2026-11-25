import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatFleet, formatWave } from './orchestrator-game-fleet-format'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { gameHostRefusalOf } from '../../shared/orchestrator-game-host-load'
import { LEAD, fakeClient, member, run, stateWith } from './orchestrator-game-fleet-test-fixtures'

// An earlier lead's member on a paired host, as `remoteFoundSessionsOf` lists it after a fresh lead.
const foundOn = (host: string, ticket: string, state = 'idle') =>
  member({
    paneKey: `remote-found:env-${host}:tab-${ticket}:leaf`,
    displayName: `${ticket} implement`,
    state,
    terminalHandle: undefined,
    found: true,
    remote: { host, environmentId: `env-${host}`, stateKnown: true },
    worktree: { id: `repo::/w/${ticket}`, branch: `fab/${ticket}`, displayName: ticket }
  })

// Why this shape: 2026-11-25, finished members held koombea 4/4 and imac 2/2, so four launched locally.
const inherited = () =>
  stateWith({
    agents: [
      LEAD,
      foundOn('koombea', 'ORCA-1388'),
      foundOn('koombea', 'ORCA-1391'),
      foundOn('koombea', 'ORCA-1395'),
      foundOn('koombea', 'ORCA-1395R', 'done'),
      foundOn('imac', 'ORCA-1407'),
      foundOn('imac', 'ORCA-1400', 'working')
    ],
    lead: { autostart: false, cap: 8, agent: 'claude' },
    hosts: [
      { host: 'local', cap: 2, status: 'ok' },
      { host: 'koombea', id: 'env-koombea', cap: 4, status: 'ok' },
      { host: 'imac', id: 'env-imac', cap: 2, status: 'ok' }
    ]
  })

describe('found sessions with no live agent are leftovers (ORCA-1424)', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('a host full of leftovers shows its real free slots; a working found session still counts', () => {
    const fleet = gameFleetReportOf(inherited() as never)

    expect(fleet.hosts?.map(({ host, running, free }) => ({ host, running, free }))).toEqual([
      { host: 'local', running: 0, free: 2 },
      { host: 'koombea', running: 0, free: 4 },
      { host: 'imac', running: 1, free: 1 }
    ])
    const text = formatFleet(fleet).split('\n')
    expect(text[0]).toContain('5 leftover, no slot held')
    expect(text[1]).toBe('Hosts: local 0/2 · koombea 0/4 · imac 1/2')
  })

  it('a leftover row offers adopt, else names the commands that close its tab on its host', () => {
    const fleet = gameFleetReportOf(inherited() as never)
    const row = fleet.rows.find((one) => one.ticket === 'ORCA-1388')!
    const working = fleet.rows.find((one) => one.ticket === 'ORCA-1400')!

    expect(row.leftover).toBe(true)
    expect(row.next).toBe(
      'leftover on koombea (idle, no lead): orca game adopt ORCA-1388 if its work goes on, else orca game stop ORCA-1388 closes its pane there'
    )
    expect(working.leftover).toBe(false)
    expect(working.next).toContain('orca game adopt ORCA-1400')
    expect(formatFleet(fleet)).toMatch(/ORCA-1388 implement \(leftover\)\n/)
    expect(formatFleet(fleet)).toMatch(/ORCA-1400 implement \(found\)\n/)
  })

  it('wave --dry-run points at the paired hosts, and launch --on koombea is not refused', async () => {
    const { client } = fakeClient(inherited())

    await run('game wave', client, [['dry-run', true]])

    expect(formatWave(printed())).toContain(
      'Room on koombea (4 free), imac (1 free): `game launch <ticket> --on koombea'
    )
    const fleet = gameFleetReportOf(inherited() as never)
    expect(gameHostRefusalOf(fleet.hosts ?? [], fleet, 'koombea', 'ORCA-1427')).toBeNull()
  })
})

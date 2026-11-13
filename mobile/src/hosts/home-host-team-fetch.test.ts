import { describe, expect, it, vi } from 'vitest'
import { MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import type { HostTeamLine } from './host-team-line'
import { fetchHomeHostTeamLine } from './home-host-team-fetch'

type Lines = Record<string, HostTeamLine | null>

function clientAnswering(answer: (method: string) => Promise<unknown>) {
  return { sendRequest: vi.fn(answer) } as never
}

function store(initial: Lines) {
  let lines = initial
  const set = (updater: (prev: Lines) => Lines) => {
    lines = updater(lines)
  }
  return { set, read: () => lines }
}

const TEAM_HOST = async (method: string) => {
  switch (method) {
    case 'status.get':
      return { ok: true, result: { capabilities: [MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY] } }
    case 'game.leads':
      return {
        ok: true,
        result: { leads: [{ handle: 'term_a', paneKey: 'tab:a', worktreeId: 'wt-a' }] }
      }
    case 'game.state':
      return {
        ok: true,
        result: { role: 'lead', lead: {}, agents: [{ name: 'Mago', state: 'working' }] }
      }
    default:
      return { ok: false }
  }
}

describe('fetchHomeHostTeamLine', () => {
  it("stores the host's team line under its id", async () => {
    const lines = store({})

    await fetchHomeHostTeamLine(clientAnswering(TEAM_HOST), 'host-1', lines.set, () => false)

    expect(lines.read()).toEqual({ 'host-1': { members: 1, working: 1, needsYou: 0 } })
  })

  it('stores no line for an older desktop that does not advertise the team', async () => {
    const lines = store({})
    const client = clientAnswering(async () => ({ ok: true, result: { capabilities: [] } }))

    await fetchHomeHostTeamLine(client, 'host-1', lines.set, () => false)

    expect(lines.read()).toEqual({ 'host-1': null })
  })

  it('keeps the last line when the refresh fails mid-flight', async () => {
    const last = { members: 3, working: 1, needsYou: 0 }
    const lines = store({ 'host-1': last })
    const client = clientAnswering(async () => {
      throw new Error('socket closed')
    })

    await fetchHomeHostTeamLine(client, 'host-1', lines.set, () => false)

    expect(lines.read()).toEqual({ 'host-1': last })
  })

  it('writes nothing once the screen that asked is gone', async () => {
    const lines = store({})

    await fetchHomeHostTeamLine(clientAnswering(TEAM_HOST), 'host-1', lines.set, () => true)

    expect(lines.read()).toEqual({})
  })
})

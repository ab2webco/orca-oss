import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LEADS_HANDLERS } from './orchestrator-game-leads'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const LEADS = [
  { project: 'cineco', label: 'Ana', handle: 'term_a', since: '2026-10-17T10:00:00.000Z' },
  { project: 'orca', label: '', handle: 'term_b', since: '2026-10-17T10:05:00.000Z' }
]

function fakeClient(error?: RuntimeClientError) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (error) {
        throw error
      }
      return { ok: true, result: { leads: LEADS } }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, json: boolean) =>
  ORCHESTRATOR_GAME_LEADS_HANDLERS['game leads']({ flags: new Map(), client, cwd: '/repo', json })

describe('orca game leads', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_TERMINAL_HANDLE = 'term_a'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('prints project, label, lead handle and state, marking this terminal', async () => {
    const { client, calls } = fakeClient()

    await run(client, false)

    expect(calls).toEqual([['game.leads', undefined]])
    const lines = output.join('\n').split('\n')
    expect(lines[0]).toMatch(/project\s+label\s+lead\s+state/)
    expect(lines[1]).toMatch(/cineco\s+Ana\s+term_a\s+live \(you\)/)
    expect(lines[2]).toMatch(/orca\s+-\s+term_b\s+live$/)
  })

  it('says so when no lead is live', async () => {
    const client = {
      call: async () => ({ ok: true, result: { leads: [] } })
    } as unknown as RuntimeClient

    await run(client, false)

    expect(output.join('\n')).toContain('No lead is live on this Orca host.')
  })

  it('prints the host answer as JSON', async () => {
    const { client } = fakeClient()

    await run(client, true)

    expect(JSON.parse(output.join('')).result.leads).toEqual(LEADS)
  })

  it('says the host does not support game leads instead of throwing', async () => {
    const { client } = fakeClient(
      new RuntimeClientError('method_not_found', 'Unknown method: game.leads')
    )

    await run(client, false)
    await run(client, true)

    expect(output[0]).toBe(
      'This Orca host does not support game leads. Update or restart Orca Lab.'
    )
    expect(JSON.parse(output[1] ?? '').result).toEqual({ leads: [], supported: false })
  })
})

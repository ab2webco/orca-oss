import { describe, expect, it, vi } from 'vitest'
import { readSoloLeadHandles } from './use-team-solo-lead-handles'

const target = { kind: 'environment', environmentId: 'env-old' } as const

// Why (ORCA-1129): the no-team filter reads every shown host, and paired hosts update apart.
describe('readSoloLeadHandles', () => {
  it("lists a host's lead handles, from a host too old to name the lead's pane", async () => {
    const read = vi.fn(async () => [{ handle: 'term_lead' }])
    expect(await readSoloLeadHandles(target, read)).toEqual(new Set(['term_lead']))
  })

  it('reads a host older than game.leads as having no leads', async () => {
    const read = vi.fn(async () => {
      throw Object.assign(new Error('method_not_found'), { code: 'method_not_found' })
    })
    expect(await readSoloLeadHandles(target, read)).toEqual(new Set())
  })

  it('keeps the last read when a host does not answer', async () => {
    const read = vi.fn(async () => {
      throw new Error('timeout')
    })
    expect(await readSoloLeadHandles(target, read)).toBeNull()
  })
})

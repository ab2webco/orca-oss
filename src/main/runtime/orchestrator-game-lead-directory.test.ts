import { describe, expect, it } from 'vitest'
import { GameLeadDirectory } from './orchestrator-game-lead-directory'

const entry = (projectKey: string, handle: string, label = 'Ana') => ({
  projectKey,
  project: projectKey,
  handle,
  label,
  at: '2026-10-17T10:00:00.000Z'
})

describe('GameLeadDirectory', () => {
  it('lists each registered lead whose terminal still exists', () => {
    const leads = new GameLeadDirectory()
    leads.register(entry('repo:a', 'term_a'))
    leads.register(entry('repo:b', 'term_b', 'Bo'))

    expect(leads.live(() => true).map((one) => one.handle)).toEqual(['term_a', 'term_b'])
  })

  it('keeps one lead per project: a later registration replaces the earlier one', () => {
    const leads = new GameLeadDirectory()
    leads.register(entry('repo:a', 'term_old'))
    leads.register(entry('repo:a', 'term_new'))

    expect(leads.live(() => true).map((one) => one.handle)).toEqual(['term_new'])
    expect(leads.leadOf('repo:a', () => true)?.handle).toBe('term_new')
  })

  it('drops a lead whose terminal is gone and answers none when no lead is live', () => {
    const leads = new GameLeadDirectory()
    leads.register(entry('repo:a', 'term_a'))

    expect(leads.live((handle) => handle !== 'term_a')).toEqual([])
    expect(leads.leadOf('repo:a', () => false)).toBeNull()
    expect(leads.leadOf('repo:other', () => true)).toBeNull()
  })

  it('moves a terminal to the project it registers for last', () => {
    const leads = new GameLeadDirectory()
    leads.register(entry('repo:a', 'term_x'))
    leads.register(entry('repo:b', 'term_x'))

    expect(leads.live(() => true).map((one) => one.projectKey)).toEqual(['repo:b'])
  })

  it('maps lead handles to labels for the inbox', () => {
    const leads = new GameLeadDirectory()
    leads.register(entry('repo:a', 'term_a', 'Ana'))
    leads.register(entry('repo:b', 'term_b', ''))

    expect(leads.labelsOf(() => true)).toEqual({ term_a: 'Ana', term_b: 'repo:b' })
  })
})

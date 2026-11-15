import { describe, expect, it } from 'vitest'
import { migrateProjectOrderByOnLoad } from './project-order-migration'

describe('migrateProjectOrderByOnLoad', () => {
  it('moves a stored recent order to needs-you first once', () => {
    expect(migrateProjectOrderByOnLoad({ projectOrderBy: 'recent' })).toEqual({
      projectOrderBy: 'needs-you',
      needsSave: true
    })
  })

  it('keeps a stored manual order', () => {
    expect(migrateProjectOrderByOnLoad({ projectOrderBy: 'manual' }).projectOrderBy).toBe('manual')
  })

  it('never runs again once the flag is recorded, so a later recent choice stays', () => {
    const first = migrateProjectOrderByOnLoad({ projectOrderBy: 'recent' })
    expect(first.projectOrderBy).toBe('needs-you')
    // The person picks Recent after the migration; the next load must respect it.
    expect(
      migrateProjectOrderByOnLoad({ projectOrderBy: 'recent', _projectOrderNeedsYouMigrated: true })
    ).toEqual({ projectOrderBy: 'recent', needsSave: false })
    expect(
      migrateProjectOrderByOnLoad({ projectOrderBy: 'manual', _projectOrderNeedsYouMigrated: true })
    ).toEqual({ projectOrderBy: 'manual', needsSave: false })
  })

  it('gives a fresh or unreadable profile the needs-you default', () => {
    expect(migrateProjectOrderByOnLoad(undefined).projectOrderBy).toBe('needs-you')
    expect(migrateProjectOrderByOnLoad({}).projectOrderBy).toBe('needs-you')
    expect(migrateProjectOrderByOnLoad({ projectOrderBy: 'bogus' }).projectOrderBy).toBe(
      'needs-you'
    )
  })

  it('asks for a save whenever the flag is not yet recorded', () => {
    expect(migrateProjectOrderByOnLoad({ projectOrderBy: 'manual' }).needsSave).toBe(true)
    expect(
      migrateProjectOrderByOnLoad({
        projectOrderBy: 'needs-you',
        _projectOrderNeedsYouMigrated: true
      }).needsSave
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { defaultGameMemberCapOf, GAME_HOST_CAP_MAX } from './orchestrator-game-lead'
import {
  hostPlacementCapOf,
  parseHostPlacementRecord,
  type HostPlacementRecord
} from './orchestration-host-placement-record'

const GB = 1024 ** 3

const valid = (): Record<string, unknown> => ({
  environment: 'studio',
  role: 'dev',
  cap: 3,
  repos: { 'acme/orca': 'orca' }
})

const parsed = (value: unknown): HostPlacementRecord | null => {
  const result = parseHostPlacementRecord(value)
  return result.ok ? result.record : null
}

const errorOf = (value: unknown): string | null => {
  const result = parseHostPlacementRecord(value)
  return result.ok ? null : result.error
}

describe('parseHostPlacementRecord', () => {
  it('parses a record with role, cap and repo map', () => {
    expect(parsed(valid())).toEqual({
      environment: 'studio',
      role: 'dev',
      cap: 3,
      repos: { 'acme/orca': 'orca' }
    })
    for (const role of ['dev', 'e2e', 'any']) {
      expect(parsed({ ...valid(), role })?.role).toBe(role)
    }
  })

  it('trims the environment name and selectors', () => {
    expect(
      parsed({
        ...valid(),
        environment: ' studio ',
        repos: { ' a/b ': ' b ' }
      })
    ).toEqual({
      environment: 'studio',
      role: 'dev',
      cap: 3,
      repos: { 'a/b': 'b' }
    })
  })

  it('rejects an unknown role', () => {
    expect(errorOf({ ...valid(), role: 'prod' })).toMatch(/^role /)
    expect(errorOf({ ...valid(), role: undefined })).toMatch(/^role /)
  })

  it('rejects a cap outside 1 to the lead cap max', () => {
    expect(parsed({ ...valid(), cap: 1 })?.cap).toBe(1)
    expect(parsed({ ...valid(), cap: GAME_HOST_CAP_MAX })?.cap).toBe(GAME_HOST_CAP_MAX)
    for (const cap of [0, -1, GAME_HOST_CAP_MAX + 1, 2.5, '3', Number.NaN]) {
      expect(errorOf({ ...valid(), cap })).toMatch(/^cap /)
    }
  })

  it('leaves cap unset when the record does not set it', () => {
    const { cap: _cap, ...rest } = valid()
    expect(parsed(rest)).toEqual({
      environment: 'studio',
      role: 'dev',
      repos: { 'acme/orca': 'orca' }
    })
  })

  it('rejects a repo map entry with an empty selector or ticket repo', () => {
    expect(errorOf({ ...valid(), repos: { 'acme/orca': '' } })).toMatch(/^repos/)
    expect(errorOf({ ...valid(), repos: { 'acme/orca': '   ' } })).toMatch(/^repos/)
    expect(errorOf({ ...valid(), repos: { '': 'orca' } })).toMatch(/^repos/)
    expect(errorOf({ ...valid(), repos: { 'acme/orca': 7 } })).toMatch(/^repos/)
  })

  it('accepts an empty repo map and defaults a missing one to empty', () => {
    expect(parsed({ ...valid(), repos: {} })?.repos).toEqual({})
    const { repos: _repos, ...rest } = valid()
    expect(parsed(rest)?.repos).toEqual({})
  })

  it('rejects an empty environment name', () => {
    expect(errorOf({ ...valid(), environment: '  ' })).toMatch(/^environment /)
  })

  it('rejects any pairing code or device token field', () => {
    for (const key of ['pairingCode', 'deviceToken', 'token', 'pairing']) {
      expect(errorOf({ ...valid(), [key]: 'orca://pair?x' })).toMatch(new RegExp(key))
    }
  })

  it('rejects a value that is not an object', () => {
    for (const value of [null, 'studio', 3, ['studio']]) {
      expect(parseHostPlacementRecord(value).ok).toBe(false)
    }
  })
})

describe('hostPlacementCapOf', () => {
  const host = { totalMemory: 32 * GB, cpuCoreCount: 10 }

  it('defaults to the member cap of the host memory', () => {
    const record = parsed({ environment: 'studio', role: 'any' })
    expect(record).not.toBeNull()
    expect(hostPlacementCapOf(record!, host)).toBe(defaultGameMemberCapOf(host))
    expect(hostPlacementCapOf(record!, host)).toBe(5)
    expect(hostPlacementCapOf(record!, null)).toBe(defaultGameMemberCapOf(null))
  })

  it('lets an explicit cap win over the host memory', () => {
    expect(hostPlacementCapOf(parsed({ ...valid(), cap: 2 })!, host)).toBe(2)
    expect(hostPlacementCapOf(parsed({ ...valid(), cap: 9 })!, host)).toBe(9)
  })
})

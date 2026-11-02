import { afterEach, describe, expect, it } from 'vitest'

import { resumeMembersArgvOf } from '../hooks/game-config'
import { setGameLocale } from '../hooks/game-strings'
import { agentTagOf, memberRemoteOf } from '../hooks/member-tags'
import { remoteRecoveryOf, resumeToastOf } from '../hooks/remote-member-view'

afterEach(() => setGameLocale('en'))

// Why: a paired host's restart or a dropped link left a member with no action on its card; only
// a click in the host's own window brought it back (ORCA-915).
const member = (remote: { host: string; stateKnown: boolean; gone?: true; asleep?: true }) => ({
  paneKey: 'remote:ctx_15',
  displayName: 'Merlin · LUM-15',
  remote
})

describe('a remote member a restart or a dropped link left behind', () => {
  it('keeps the asleep mark its host sent', () => {
    expect(memberRemoteOf({ host: 'imac', stateKnown: true, asleep: true })).toEqual({
      host: 'imac',
      stateKnown: true,
      asleep: true
    })
  })

  it('tags an asleep member as asleep on its host, shorter on a narrow card', () => {
    const asleep = { host: 'imac', stateKnown: true, asleep: true as const }
    expect(agentTagOf({ agentType: '', remote: asleep }, 40)).toBe('asleep on imac')
    expect(agentTagOf({ agentType: '', remote: asleep }, 10)).toBe('imac asleep')
    setGameLocale('es')
    expect(agentTagOf({ agentType: '', remote: asleep }, 40)).toBe('dormido en imac')
  })

  it('offers Resume for an asleep member and Reconnect for a silent host', () => {
    expect(remoteRecoveryOf(member({ host: 'imac', stateKnown: true, asleep: true }))).toEqual({
      action: 'resume',
      label: 'Resume',
      ticket: 'LUM-15'
    })
    expect(remoteRecoveryOf(member({ host: 'imac', stateKnown: false }))).toEqual({
      action: 'reconnect',
      label: 'Reconnect',
      ticket: 'LUM-15'
    })
    setGameLocale('es')
    expect(remoteRecoveryOf(member({ host: 'imac', stateKnown: true, asleep: true }))?.label).toBe(
      'Reanudar'
    )
  })

  it('offers nothing for a live member, a gone one, or a local one', () => {
    expect(remoteRecoveryOf(member({ host: 'imac', stateKnown: true }))).toBeNull()
    expect(remoteRecoveryOf(member({ host: 'imac', stateKnown: true, gone: true }))).toBeNull()
    expect(remoteRecoveryOf({ paneKey: 'tab:1', displayName: 'LUM-12' })).toBeNull()
  })

  it('resumes through the absolute CLI path with one ticket, never a flag in its place', () => {
    expect(resumeMembersArgvOf('/opt/orca', 'LUM-15')).toEqual([
      '/opt/orca',
      'game',
      'resume-members',
      '--tickets',
      'LUM-15',
      '--json'
    ])
    expect(resumeMembersArgvOf('orca', 'LUM-15')).toBeUndefined()
    expect(resumeMembersArgvOf('/opt/orca', '--discard')).toBeUndefined()
  })
})

describe('what Resume says once the CLI answers', () => {
  const stdout = (member: Record<string, unknown>) =>
    JSON.stringify({ result: { members: [{ ticket: 'LUM-15', ...member }] } })

  it('says the member woke on its host', () => {
    expect(
      resumeToastOf('Merlin · LUM-15', 'imac', 'LUM-15', {
        ok: true,
        stdout: stdout({ result: 'woken', terminal: 'term_woken' })
      })
    ).toBe('Merlin · LUM-15 woke on imac')
  })

  it('passes on why its host could not wake it', () => {
    expect(
      resumeToastOf('Merlin · LUM-15', 'imac', 'LUM-15', {
        ok: false,
        stdout: stdout({ result: 'failed', reason: 'The Orca Lab on imac cannot wake terminals' })
      })
    ).toBe('Could not resume Merlin · LUM-15: The Orca Lab on imac cannot wake terminals')
  })

  it('says so when the CLI could not run or answered nothing it can read', () => {
    expect(resumeToastOf('Merlin · LUM-15', 'imac', 'LUM-15', undefined)).toBe(
      'Could not resume Merlin · LUM-15: Orca did not answer'
    )
    expect(resumeToastOf('Merlin · LUM-15', 'imac', 'LUM-15', { ok: false, stdout: '' })).toBe(
      'Could not resume Merlin · LUM-15: Orca did not answer'
    )
  })
})

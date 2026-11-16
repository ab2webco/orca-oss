import { describe, expect, it } from 'vitest'
import {
  getRepoDisplayLabelKey,
  getRepoDisplayLabelsByPath,
  getRepoHostQualifiedLabels
} from './repo-display-labels'

describe('getRepoDisplayLabelsByPath', () => {
  it('keeps non-colliding repository names basename-only', () => {
    const labels = getRepoDisplayLabelsByPath([
      { path: '/workspace/platform/web', displayName: 'web' },
      { path: '/workspace/platform/worker', displayName: 'worker' }
    ])

    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/platform/web' }))).toBe('web')
    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/platform/worker' }))).toBe(
      'worker'
    )
  })

  it('adds the minimal real parent suffix only for colliding basenames', () => {
    const labels = getRepoDisplayLabelsByPath([
      { path: '/workspace/platform/web', displayName: 'web' },
      { path: '/workspace/platform/payments/api', displayName: 'api' },
      { path: '/workspace/platform/billing/api', displayName: 'api' }
    ])

    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/platform/web' }))).toBe('web')
    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/platform/payments/api' }))).toBe(
      'payments/api'
    )
    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/platform/billing/api' }))).toBe(
      'billing/api'
    )
  })

  it('expands colliding labels in lockstep without skipping shared segments', () => {
    const labels = getRepoDisplayLabelsByPath([
      { path: '/workspace/team1/shared/api', displayName: 'api' },
      { path: '/workspace/team2/shared/api', displayName: 'api' }
    ])

    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/team1/shared/api' }))).toBe(
      'team1/shared/api'
    )
    expect(labels.get(getRepoDisplayLabelKey({ path: '/workspace/team2/shared/api' }))).toBe(
      'team2/shared/api'
    )
  })

  it('scopes labels by execution host so same-path repos on different hosts do not collide', () => {
    // Real SSH folder-repo shape: connectionId set, executionHostId unset — so
    // it must fall back to the connection host, not look identical to a local repo.
    const localRepo = { path: '/Users/alice', displayName: 'alice' }
    const sshRepo = { path: '/Users/alice', displayName: 'alice-prod', connectionId: 'prod-ssh' }
    const labels = getRepoDisplayLabelsByPath([localRepo, sshRepo])

    expect(labels.get(getRepoDisplayLabelKey(localRepo))).toBe('alice')
    expect(labels.get(getRepoDisplayLabelKey(sshRepo))).toBe('alice-prod')
    expect(labels.size).toBe(2)
  })

  it('keeps cross-host repos with identical path AND name on their bare name', () => {
    // Why: the host header names the host; a path suffix would only repeat the shared path.
    const localRepo = { path: '/Users/alice', displayName: 'home' }
    const sshRepo = { path: '/Users/alice', displayName: 'home', connectionId: 'prod-ssh' }
    const labels = getRepoDisplayLabelsByPath([localRepo, sshRepo])

    expect(getRepoDisplayLabelKey(localRepo)).not.toBe(getRepoDisplayLabelKey(sshRepo))
    expect(labels.get(getRepoDisplayLabelKey(localRepo))).toBe('home')
    expect(labels.get(getRepoDisplayLabelKey(sshRepo))).toBe('home')
  })

  it('disambiguates same-name repos only among the repos of one host (ORCA-1181)', () => {
    const projects = { path: '/Users/me/Projects/orca-oss', displayName: 'orca-oss' }
    const workspaces = { path: '/Users/me/workspaces/orca-oss', displayName: 'orca-oss' }
    const paired = {
      path: '/Users/me/Projects/orca-oss',
      displayName: 'orca-oss',
      executionHostId: 'runtime:m1' as const
    }
    // SSH folder repo: connectionId set, executionHostId unset.
    const sshFolder = { path: '/srv/orca-oss', displayName: 'orca-oss', connectionId: 'contabo' }
    const labels = getRepoDisplayLabelsByPath([projects, workspaces, paired, sshFolder])

    expect(labels.get(getRepoDisplayLabelKey(projects))).toBe('Projects/orca-oss')
    expect(labels.get(getRepoDisplayLabelKey(workspaces))).toBe('workspaces/orca-oss')
    expect(labels.get(getRepoDisplayLabelKey(paired))).toBe('orca-oss')
    expect(labels.get(getRepoDisplayLabelKey(sshFolder))).toBe('orca-oss')
  })

  it('normalizes Windows separators to slash display labels', () => {
    const labels = getRepoDisplayLabelsByPath([
      { path: 'C:\\workspace\\payments\\api', displayName: 'api' },
      { path: 'C:\\workspace\\billing\\api', displayName: 'api' }
    ])

    expect(labels.get(getRepoDisplayLabelKey({ path: 'C:\\workspace\\payments\\api' }))).toBe(
      'payments/api'
    )
    expect(labels.get(getRepoDisplayLabelKey({ path: 'C:\\workspace\\billing\\api' }))).toBe(
      'billing/api'
    )
  })

  it('disambiguates Windows paths on one host while another host keeps the bare name', () => {
    const payments = { path: 'C:\\work\\payments\\api', displayName: 'api' }
    const billing = { path: 'C:\\work\\billing\\api', displayName: 'api' }
    const remote = { path: 'C:\\work\\payments\\api', displayName: 'api', connectionId: 'win-box' }
    const labels = getRepoDisplayLabelsByPath([payments, billing, remote])

    expect(labels.get(getRepoDisplayLabelKey(payments))).toBe('payments/api')
    expect(labels.get(getRepoDisplayLabelKey(billing))).toBe('billing/api')
    expect(labels.get(getRepoDisplayLabelKey(remote))).toBe('api')
  })
})

describe('getRepoHostQualifiedLabels', () => {
  const hostLabels = new Map([
    ['local', 'Este equipo'],
    ['ssh:m1', 'm1']
  ])

  it('names the host only on repos whose label repeats on another host', () => {
    const labels = getRepoHostQualifiedLabels(
      [
        { id: 'a', path: '/w/orca-oss', displayName: 'orca-oss' },
        { id: 'b', path: '/w/orca-oss', displayName: 'orca-oss', connectionId: 'm1' },
        { id: 'c', path: '/w/web', displayName: 'web' }
      ],
      hostLabels
    )

    expect(labels.get('a')).toBe('orca-oss · Este equipo')
    expect(labels.get('b')).toBe('orca-oss · m1')
    expect(labels.get('c')).toBe('web')
  })

  it('keeps the per-host parent suffix when one host has two of the same name', () => {
    const labels = getRepoHostQualifiedLabels(
      [
        { id: 'a', path: '/w/Projects/orca-oss', displayName: 'orca-oss' },
        { id: 'b', path: '/w/workspaces/orca-oss', displayName: 'orca-oss' }
      ],
      hostLabels
    )

    expect(labels.get('a')).toBe('Projects/orca-oss')
    expect(labels.get('b')).toBe('workspaces/orca-oss')
  })
})

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findClaudeIdentityInOtherProfiles,
  findDuplicateClaudeAccount
} from './claude-duplicate-account'
import { listClaudeIdentitiesInOtherProfiles } from './claude-profile-account-index'

const roots: string[] = []

function createProfilesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-claude-profiles-test-'))
  roots.push(root)
  return root
}

function seedVault(
  profilesRoot: string,
  profileName: string,
  accountId: string,
  identity: { emailAddress?: string; organizationUuid?: string | null }
): string {
  const profilePath = join(profilesRoot, profileName)
  const authPath = join(profilePath, 'claude-accounts', accountId, 'auth')
  mkdirSync(authPath, { recursive: true })
  writeFileSync(join(authPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  writeFileSync(join(authPath, 'oauth-account.json'), JSON.stringify(identity), 'utf-8')
  return profilePath
}

const SHARED_IDENTITY = {
  emailAddress: 'fabiana@koombea.com',
  organizationUuid: 'efb40f7b-4417-4a49-846a-b3075f27637b'
}

const candidate = {
  email: SHARED_IDENTITY.emailAddress,
  organizationUuid: SHARED_IDENTITY.organizationUuid,
  managedAuthRuntime: 'host' as const,
  wslDistro: null
}

describe('Claude identities across Orca profiles', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('detects one identity registered in a neighbour profile that the current profile cannot see', () => {
    const profilesRoot = createProfilesRoot()
    const currentProfilePath = seedVault(profilesRoot, 'orca', 'account-current', {
      emailAddress: 'other@koombea.com',
      organizationUuid: SHARED_IDENTITY.organizationUuid
    })
    seedVault(profilesRoot, 'orca-dev', 'account-neighbour', SHARED_IDENTITY)

    // The current profile's own store holds no row for this identity, so the in-profile guard
    // passes — this is exactly the add that silently created a third duplicate (ORCA-496).
    expect(findDuplicateClaudeAccount([], candidate)).toBeNull()

    const match = findClaudeIdentityInOtherProfiles(
      listClaudeIdentitiesInOtherProfiles(profilesRoot, currentProfilePath),
      candidate
    )

    expect(match).toEqual({
      profileName: 'orca-dev',
      accountId: 'account-neighbour',
      email: SHARED_IDENTITY.emailAddress,
      organizationUuid: SHARED_IDENTITY.organizationUuid
    })
  })

  // Why skipped on Windows: an unprivileged directory symlink throws EPERM there.
  it.skipIf(process.platform === 'win32')(
    'never reports the current profile, including when it is named through a symlinked root',
    () => {
      const profilesRoot = createProfilesRoot()
      seedVault(profilesRoot, 'orca', 'account-current', SHARED_IDENTITY)
      const aliasRoot = join(createProfilesRoot(), 'alias')
      symlinkSync(profilesRoot, aliasRoot, 'dir')

      expect(listClaudeIdentitiesInOtherProfiles(profilesRoot, join(profilesRoot, 'orca'))).toEqual(
        []
      )
      expect(listClaudeIdentitiesInOtherProfiles(profilesRoot, join(aliasRoot, 'orca'))).toEqual([])
    }
  )

  it('keeps a different organization on the same email addable', () => {
    const profilesRoot = createProfilesRoot()
    const currentProfilePath = join(profilesRoot, 'orca')
    mkdirSync(currentProfilePath, { recursive: true })
    seedVault(profilesRoot, 'orca-dev', 'account-neighbour', {
      ...SHARED_IDENTITY,
      organizationUuid: 'a-different-organization'
    })

    expect(
      findClaudeIdentityInOtherProfiles(
        listClaudeIdentitiesInOtherProfiles(profilesRoot, currentProfilePath),
        candidate
      )
    ).toBeNull()
  })

  it('skips malformed and identity-less neighbour vaults instead of failing the add', () => {
    const profilesRoot = createProfilesRoot()
    const currentProfilePath = join(profilesRoot, 'orca')
    mkdirSync(currentProfilePath, { recursive: true })
    seedVault(profilesRoot, 'orca-broken', 'malformed', {})
    const unmarked = join(profilesRoot, 'orca-broken', 'claude-accounts', 'unmarked', 'auth')
    mkdirSync(unmarked, { recursive: true })
    writeFileSync(join(unmarked, 'oauth-account.json'), JSON.stringify(SHARED_IDENTITY), 'utf-8')
    const unparseable = join(profilesRoot, 'orca-broken', 'claude-accounts', 'unparseable', 'auth')
    mkdirSync(unparseable, { recursive: true })
    writeFileSync(join(unparseable, 'oauth-account.json'), '{ not json', 'utf-8')
    mkdirSync(join(profilesRoot, 'orca-empty'), { recursive: true })

    expect(listClaudeIdentitiesInOtherProfiles(profilesRoot, currentProfilePath)).toEqual([])
  })

  // Why skipped on Windows: chmod does not deny directory reads there, so the case cannot be set up.
  it.skipIf(process.platform === 'win32')(
    'skips a neighbour profile whose vault root denies reads',
    () => {
      const profilesRoot = createProfilesRoot()
      const currentProfilePath = join(profilesRoot, 'orca')
      mkdirSync(currentProfilePath, { recursive: true })
      const denied = seedVault(profilesRoot, 'orca-denied', 'account-denied', SHARED_IDENTITY)
      chmodSync(join(denied, 'claude-accounts'), 0o000)

      try {
        expect(listClaudeIdentitiesInOtherProfiles(profilesRoot, currentProfilePath)).toEqual([])
      } finally {
        chmodSync(join(denied, 'claude-accounts'), 0o700)
      }
    }
  )
})

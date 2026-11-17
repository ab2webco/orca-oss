import { describe, expect, it } from 'vitest'
import {
  gameHostLaunchOf,
  gameMemberRepoRefusalOf,
  memberRepoKeyOf,
  type GameRepoSummary
} from './orchestrator-game-member-repo-scope'

const repo = (
  id: string,
  displayName: string,
  remoteKey: string | null,
  ownRemoteKey?: string | null
): GameRepoSummary => ({
  id,
  displayName,
  path: `/work/${displayName}`,
  remoteKey,
  ...(ownRemoteKey === undefined ? {} : { ownRemoteKey })
})

const netsat = repo('r_netsat', 'helpdesk_netsat', 'github.com/ab2webco/helpdesk_netsat')
const orca = repo('r_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')
const front = repo('r_front', 'cineco-frontend', 'github.com/koombea/cineco-frontend')

describe('memberRepoKeyOf', () => {
  it('reads a canonical key, an https URL and an scp URL as the same remote', () => {
    expect(memberRepoKeyOf('github.com/Koombea/cineco-frontend')).toBe(
      'github.com/koombea/cineco-frontend'
    )
    expect(memberRepoKeyOf('https://github.com/koombea/cineco-frontend.git')).toBe(
      'github.com/koombea/cineco-frontend'
    )
    expect(memberRepoKeyOf('git@github.com:koombea/cineco-frontend.git')).toBe(
      'github.com/koombea/cineco-frontend'
    )
    expect(memberRepoKeyOf('cineco-frontend')).toBeNull()
  })
})

describe('gameMemberRepoRefusalOf on this host', () => {
  it('lets a lead launch into its own repo', () => {
    const read = { host: null, lead: netsat, repo: netsat, repos: [] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'id:r_netsat' })).toBeNull()
  })

  it("refuses another project's repo and names the lead's project (ORCA-1156)", () => {
    const read = { host: null, lead: netsat, repo: orca, repos: [] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })).toMatch(
      /--repo name:orca-oss is orca-oss, outside this lead's project \(helpdesk_netsat\).*memberRepos/
    )
  })

  it('lets a lead launch into a repo its orca.yaml lists in memberRepos (cineco FE/BE)', () => {
    const read = { host: null, lead: netsat, repo: front, repos: [] }
    expect(
      gameMemberRepoRefusalOf({
        read,
        selector: 'name:cineco-frontend',
        memberRepos: ['https://github.com/koombea/cineco-frontend.git']
      })
    ).toBeNull()
  })

  it('refuses a selector this host does not know', () => {
    const read = { host: null, lead: netsat, repo: null, repos: [] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:nope' })).toMatch(
      /--repo name:nope is not a repo registered in this Orca Lab/
    )
  })
})

describe('gameMemberRepoRefusalOf on a paired host', () => {
  const hostNetsat = repo('h_netsat', 'helpdesk_netsat', 'github.com/ab2webco/helpdesk_netsat')
  const hostOrca = repo('h_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')

  it("lets a lead launch into the host's copy of its own repo", () => {
    const read = {
      host: 'm1',
      lead: netsat,
      repo: hostNetsat,
      repos: [hostNetsat, hostOrca]
    }
    expect(gameMemberRepoRefusalOf({ read, selector: 'id:h_netsat' })).toBeNull()
  })

  it('names the host and the register step when the project is not on it (ORCA-1156)', () => {
    const read = {
      host: 'm1',
      lead: netsat,
      repo: hostOrca,
      repos: [hostOrca]
    }
    const refusal = gameMemberRepoRefusalOf({
      read,
      selector: 'name:orca-oss'
    })
    expect(refusal).toMatch(/helpdesk_netsat is not registered on m1/)
    expect(refusal).toMatch(/orca repo add --path <path on m1> --environment m1/)
    expect(refusal).toMatch(/No worktree was created/)
  })

  it("refuses another project's repo on the host and points at the project's own", () => {
    const read = {
      host: 'm1',
      lead: netsat,
      repo: hostOrca,
      repos: [hostNetsat, hostOrca]
    }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })).toMatch(
      /--repo name:orca-oss on m1 is orca-oss, outside this lead's project \(helpdesk_netsat\); use --repo id:h_netsat/
    )
  })

  it("never matches a host repo by the lead's local id", () => {
    const stranger = repo('r_netsat', 'other', 'github.com/someone/other')
    const read = {
      host: 'm1',
      lead: netsat,
      repo: stranger,
      repos: [stranger]
    }
    expect(gameMemberRepoRefusalOf({ read, selector: 'id:r_netsat' })).toMatch(
      /helpdesk_netsat is not registered on m1/
    )
  })
})

describe('gameMemberRepoRefusalOf for a fork (ORCA-1198)', () => {
  const upstream = 'github.com/stablyai/orca'
  // The lead's identity names its upstream remote; its own remote is the fork's origin.
  const leadFork = repo('r_orca', 'orca-oss', upstream, 'github.com/ab2webco/orca-oss')

  it("lets a lead launch into the host's clone of its fork, whose identity is origin", () => {
    const hostFork = repo(
      'h_orca',
      'orca-oss',
      'github.com/ab2webco/orca-oss',
      'github.com/ab2webco/orca-oss'
    )
    const read = {
      host: 'm1',
      lead: leadFork,
      repo: hostFork,
      repos: [hostFork]
    }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })).toBeNull()
  })

  it('refuses a host repo whose only match is the shared upstream (another fork)', () => {
    const otherFork = repo('h_other', 'orca', upstream, null)
    const read = {
      host: 'm1',
      lead: leadFork,
      repo: otherFork,
      repos: [otherFork]
    }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca' })).toMatch(
      /the upstream every fork of it shares.*No worktree was created/
    )
  })

  it('refuses a local clone of another fork that shares the upstream', () => {
    const otherFork = repo('r_other', 'orca', upstream, 'github.com/someone/orca')
    const read = { host: null, lead: leadFork, repo: otherFork, repos: [] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca' })).toMatch(
      /outside this lead's project \(orca-oss\)/
    )
  })

  it('keeps matching by remoteKey when an older runtime sends no ownRemoteKey', () => {
    const lead = repo('r_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')
    const hostFork = repo('h_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')
    const read = { host: 'm1', lead, repo: hostFork, repos: [hostFork] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })).toBeNull()
  })

  it('says a host repo with no remote identity cannot be told apart, not that the project is missing (ORCA-1250)', () => {
    const bare = repo('h_orca', 'orca-oss', null, null)
    const read = { host: 'm1', lead: leadFork, repo: bare, repos: [bare] }
    const refusal = gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })
    expect(refusal).toMatch(
      /orca-oss on m1 has no remote identity yet, so Orca cannot tell whether it is orca-oss's clone/
    )
    expect(refusal).not.toMatch(/is not registered on m1/)
  })

  it('says why a host clone named by the shared upstream is refused, not that the project is missing', () => {
    const clone = repo('h_orca', 'orca-oss', upstream, null)
    const read = { host: 'm1', lead: leadFork, repo: clone, repos: [clone] }
    const refusal = gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })
    expect(refusal).toMatch(
      /orca-oss on m1 names github\.com\/stablyai\/orca, the upstream every fork of it shares/
    )
    expect(refusal).toMatch(/memberRepos/)
    expect(refusal).not.toMatch(/is not registered on m1/)
  })

  it('still accepts an upstream the orca.yaml lists in memberRepos', () => {
    const otherFork = repo('h_other', 'orca', upstream, null)
    const read = {
      host: 'm1',
      lead: leadFork,
      repo: otherFork,
      repos: [otherFork]
    }
    expect(
      gameMemberRepoRefusalOf({
        read,
        selector: 'name:orca',
        memberRepos: [upstream]
      })
    ).toBeNull()
  })
})

describe('gameHostLaunchOf (ORCA-1207)', () => {
  const upstream = 'github.com/stablyai/orca'
  const leadFork = repo('r_orca', 'orca-oss', upstream, 'github.com/ab2webco/orca-oss')
  const hostFork = repo('h_orca', 'orca-oss', 'github.com/ab2webco/orca-oss')
  const upstreamClone = repo('h_up', 'orca-oss', upstream, null)
  const partialClone = repo('h_partial', 'orca-oss', null, null)

  it('finds the project on a host that has its clone', () => {
    expect(gameHostLaunchOf({ lead: leadFork, host: 'm1', repos: [front, hostFork] })).toEqual({
      kind: 'ready',
      repo: hostFork
    })
  })

  it('names a host without the project as not registered (koombea)', () => {
    expect(gameHostLaunchOf({ lead: leadFork, host: 'koombea', repos: [front] })).toEqual({
      kind: 'unregistered',
      project: 'orca-oss',
      reason: expect.stringMatching(/orca-oss is not registered on koombea.*orca repo add/)
    })
  })

  it('quotes the fork refusal for a clone named by the shared upstream (ORCA-1198)', () => {
    expect(gameHostLaunchOf({ lead: leadFork, host: 'imac', repos: [upstreamClone] })).toEqual({
      kind: 'refused',
      reason: expect.stringMatching(/names github\.com\/stablyai\/orca, the upstream every fork/)
    })
  })

  it('refuses a host whose only candidate has no remote identity yet (koombea partial clone, ORCA-1250)', () => {
    expect(
      gameHostLaunchOf({ lead: leadFork, host: 'koombea', repos: [front, partialClone] })
    ).toEqual({
      kind: 'refused',
      reason:
        "orca-oss on koombea has no remote identity yet, so Orca cannot tell whether it is orca-oss's clone. See ORCA-1250."
    })
  })

  it('keeps a host with no candidate repo as not registered, folder workspaces included', () => {
    const folder = { ...repo('h_notes', 'notes', null, null), kind: 'folder' as const }
    for (const repos of [[], [front], [folder]]) {
      expect(gameHostLaunchOf({ lead: leadFork, host: 'koombea', repos }).kind).toBe('unregistered')
    }
  })

  it('refuses every host for a lead whose project Orca cannot tell', () => {
    expect(gameHostLaunchOf({ lead: null, host: 'm1', repos: [hostFork] }).kind).toBe('refused')
  })

  // Why: the tab and `game launch --on` must never disagree about a host.
  it('says what game launch --on refuses with, minus the launch-only clause', () => {
    for (const repos of [[front], [upstreamClone], [partialClone]]) {
      const launch = gameHostLaunchOf({ lead: leadFork, host: 'm1', repos })
      const refusal = gameMemberRepoRefusalOf({
        read: { host: 'm1', lead: leadFork, repo: null, repos },
        selector: 'name:orca-oss'
      })
      expect(launch.kind).not.toBe('ready')
      expect(refusal).toBe(
        `${launch.kind === 'ready' ? '' : launch.reason} No worktree was created.`
      )
    }
  })
})

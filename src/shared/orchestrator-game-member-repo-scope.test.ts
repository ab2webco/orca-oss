import { describe, expect, it } from 'vitest'
import {
  gameMemberRepoRefusalOf,
  memberRepoKeyOf,
  type GameRepoSummary
} from './orchestrator-game-member-repo-scope'

const repo = (id: string, displayName: string, remoteKey: string | null): GameRepoSummary => ({
  id,
  displayName,
  path: `/work/${displayName}`,
  remoteKey
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
    const read = { host: 'm1', lead: netsat, repo: hostNetsat, repos: [hostNetsat, hostOrca] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'id:h_netsat' })).toBeNull()
  })

  it('names the host and the register step when the project is not on it (ORCA-1156)', () => {
    const read = { host: 'm1', lead: netsat, repo: hostOrca, repos: [hostOrca] }
    const refusal = gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })
    expect(refusal).toMatch(/helpdesk_netsat is not registered on m1/)
    expect(refusal).toMatch(/orca repo add --path <path on m1> --environment m1/)
    expect(refusal).toMatch(/No worktree was created/)
  })

  it("refuses another project's repo on the host and points at the project's own", () => {
    const read = { host: 'm1', lead: netsat, repo: hostOrca, repos: [hostNetsat, hostOrca] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'name:orca-oss' })).toMatch(
      /--repo name:orca-oss on m1 is orca-oss, outside this lead's project \(helpdesk_netsat\); use --repo id:h_netsat/
    )
  })

  it("never matches a host repo by the lead's local id", () => {
    const stranger = repo('r_netsat', 'other', 'github.com/someone/other')
    const read = { host: 'm1', lead: netsat, repo: stranger, repos: [stranger] }
    expect(gameMemberRepoRefusalOf({ read, selector: 'id:r_netsat' })).toMatch(
      /helpdesk_netsat is not registered on m1/
    )
  })
})

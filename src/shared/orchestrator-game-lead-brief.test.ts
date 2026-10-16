import { describe, expect, it } from 'vitest'

import { gameLeadBriefOf } from './orchestrator-game-lead-brief'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'

describe('gameLeadBriefOf', () => {
  it('makes the session the lead that delegates every ticket, with the project cap', () => {
    const brief = gameLeadBriefOf({ ...DEFAULT_GAME_LEAD, cap: 3 }, 'cineco')

    expect(brief).toContain('You are the lead of cineco')
    expect(brief).toContain('Never edit code')
    expect(brief).toContain('orca game launch <ticket>')
    expect(brief).toContain('At most 3 members run at once')
    expect(brief).toContain('worker_done,escalation,question')
    expect(brief).not.toContain('Project rules')
  })

  it('names the fleet verbs: status, a wave from the To Do, a verified sweep and a push', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('`orca game fleet`')
    expect(brief).toContain('`orca game wave --dry-run`')
    expect(brief).toContain('`orca game sweep`')
    expect(brief).toContain('`orca game sweep --close`')
    expect(brief).toContain('`orca game push`')
  })

  it('stops every member at once when the person says stop, and never relaunches on its own', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('stop/detener')
    expect(brief).toContain('`orca game stop --all` at once')
    expect(brief).toContain("don't relaunch or re-arm watchers until asked")
  })

  it('reads and relays its orchestration messages when Orca says it has some, never echoing the line', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco', '/opt/orca-dev')

    expect(brief).toContain('"You have N orchestration messages"')
    expect(brief).toContain('run `/opt/orca-dev orchestration check --json` at once')
    expect(brief).toContain('answer a member question, verify a worker_done, escalate')
    expect(brief).toContain('one short line who wrote and what it means')
    expect(brief).toContain('quote the member')
    expect(brief).toContain('Never just repeat that line')
  })

  it('hands a non-implementation task to a member with --prompt', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain(
      'For a task that is not implementing the ticket (tests, QA runs, investigations) pass `--prompt <task>` to game launch.'
    )
  })

  it('writes every command with the CLI this session runs', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco', '/opt/orca-dev')

    expect(brief).toContain('`/opt/orca-dev game launch <ticket>`')
    expect(brief).toContain('`/opt/orca-dev orchestration check --wait')
    expect(brief).not.toMatch(/`orca /)
  })

  it("names the lead with the project's label and appends the project's rules", () => {
    const brief = gameLeadBriefOf(
      { ...DEFAULT_GAME_LEAD, label: 'orquestador', rules: 'Members report TERMINADO CIN-NNN.' },
      'cineco'
    )

    expect(brief).toContain('You are the lead of cineco ("orquestador")')
    expect(brief.trimEnd().endsWith('## Project rules\n\nMembers report TERMINADO CIN-NNN.')).toBe(
      true
    )
  })
})

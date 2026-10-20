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

  it('forbids Claude Code subagents and points the lead to a member launch', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('Never use the Agent or Task tool')
    expect(brief).toContain('`orca game launch <ticket> --prompt <task>`')
  })

  it('names the fleet verbs: status, a wave from the To Do, a verified sweep and a push', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('`orca game fleet`')
    expect(brief).toContain('`orca game wave --dry-run`')
    expect(brief).toContain('`orca game sweep`')
    expect(brief).toContain('`orca game sweep --close`')
    expect(brief).toContain('`orca game push`')
  })

  it('holds a persistent STOP when the person stops everyone, and lifts it only when told', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('"detén todo y que no sigan"')
    expect(brief).toContain('`orca game stop --all --hold` at once')
    expect(brief).toContain('confirm what stopped and that STOP holds')
    expect(brief).toContain('`orca game resume` only when the person says to resume')
    expect(brief).toContain("don't relaunch or re-arm watchers until asked")
  })

  it('reads the events and inbox before saying what happened', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('"qué pasó"')
    expect(brief).toContain('read `orca game events` and `orca game inbox` first')
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

  // Why: an unacknowledged Delivery replays in front of every later worker_done (ORCA-701).
  it('acknowledges each Delivery it handled before it waits again', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain(
      '`orca orchestration check --ack <deliveryId> --wait --types worker_done,escalation,question --timeout-ms 900000 --json`'
    )
    expect(brief).toContain('`orca orchestration check --ack <deliveryId> --json`')
    expect(brief).toContain('replays the same messages')
    // Why: a timed-out wait has no deliveryId, and `--ack null` fails the watch before it waits.
    expect(brief).toContain('no `deliveryId` (it timed out), wait again without `--ack`')
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

  // Why: Claude Code's Bash tool is Git Bash on Windows, where a backslash path or a space breaks the word.
  it('writes the CLI as one Bash word, a Windows path with forward slashes', () => {
    const windows = gameLeadBriefOf(
      DEFAULT_GAME_LEAD,
      'cineco',
      "C:\\Program Files\\Orca Lab (x86)\\it's\\orca.exe"
    )
    expect(windows).toContain(
      "`'C:/Program Files/Orca Lab (x86)/it'\\''s/orca.exe' game launch <ticket>`"
    )
    expect(windows).not.toContain('C:\\')

    const devMac = gameLeadBriefOf(
      DEFAULT_GAME_LEAD,
      'cineco',
      '/Users/me/Library/Application Support/orca-dev/cli/bin/orca-dev'
    )
    expect(devMac).toContain(
      "`'/Users/me/Library/Application Support/orca-dev/cli/bin/orca-dev' game fleet`"
    )
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

  it('names the account tools, lets the person pick an agent or account per ticket, and handles a limited member', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('`orca game accounts`')
    expect(brief).toContain('"lanza CIN-1 con Codex"')
    expect(brief).toContain('--agent <id>')
    expect(brief).toContain('--account <email|id>')
    expect(brief).toContain('`orca game move <ticket>`')
    expect(brief).toContain('when the first account is back')
    expect(brief).not.toContain('accounts: auto')
  })

  it('leaves the account to Orca with accounts: auto unless the person names one', () => {
    const brief = gameLeadBriefOf({ ...DEFAULT_GAME_LEAD, accounts: 'auto' }, 'cineco')

    expect(brief).toContain('accounts: auto')
    expect(brief).toContain("don't pick an account yourself unless the person names one")
  })

  it('answers about members from Orca, not from memory: member, fleet and history', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('`orca game member <ticket>`')
    expect(brief).toContain('never from memory')
    expect(brief).toContain('a status question')
    expect(brief).toContain('`orca game history`')
    expect(brief).toContain('"what did CIN-1 do", yesterday\'s work')
    expect(brief).toContain('cite its record')
  })

  it("lets a lead ask another project's lead to launch work, only when the person asks", () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('`orca game leads`')
    expect(brief).toContain(
      '`orca orchestration send --to <lead handle> --subject <subject> --body <request>`'
    )
    expect(brief).toContain('only when the person asks')
    expect(brief).toContain('never to yourself')
  })

  it("acts on a peer lead's request and reports back once, never to acknowledge", () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain("A peer lead's request to launch work")
    expect(brief).toContain('as if the person asked')
    expect(brief).toContain('report back to that lead once')
    expect(brief).toContain('never reply just to acknowledge')
  })
})

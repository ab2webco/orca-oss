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
    expect(brief).toContain('worker_done,escalation,question,decision_gate')
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

  it('resumes the members a restart paused at once, then tells the person', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('After Orca or the machine restarts')
    expect(brief).toContain('run `orca game resume-members` at once, without asking')
    expect(brief).toContain('Then tell the person in one line who resumed')
    expect(brief).not.toContain('resume them?')
    expect(brief).toContain('never `game launch` a paused ticket')
  })

  it('asks the person first when the project keeps resuming ask-first', () => {
    const brief = gameLeadBriefOf({ ...DEFAULT_GAME_LEAD, askBeforeResume: true }, 'cineco')

    expect(brief).toContain('After Orca or the machine restarts')
    expect(brief).not.toContain('without asking')
    expect(brief).toContain('"3 members were working; resume them?"')
    expect(brief).toContain('`orca game resume-members`')
    expect(brief).toContain('`orca game resume-members --discard`')
    expect(brief).toContain('never `game launch` a paused ticket')
  })

  it('reads the events and inbox before saying what happened', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('"qué pasó"')
    expect(brief).toContain('read `orca game events` and `orca game inbox` first')
  })

  it('relays a retired backlog as one line and verifies what is still open (ORCA-824)', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco', '/opt/orca-dev')

    expect(brief).toContain('A check result with `retired`')
    expect(brief).toContain('under `unverified` with `/opt/orca-dev game member <ticket>`')
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
      '`orca orchestration check --ack <deliveryId> --wait --watch --types worker_done,escalation,question,decision_gate --timeout-ms 900000 --json`'
    )
    expect(brief).toContain('`orca orchestration check --ack <deliveryId> --json`')
    expect(brief).toContain('replays the same messages')
  })

  // Why: leads added status to --types to hear other leads, and woke on every member ping (ORCA-861).
  it('says mail from outside its members wakes the watch, so status stays out of --types', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('Mail from another lead or the person wakes it whatever its type')
    expect(brief).toContain('never add `status` to --types')
    expect(brief).not.toContain('decision_gate,status')
  })

  // Why: a quiet timeout used to print a result the lead had to re-arm for, one turn per window with no event (ORCA-746 T6b).
  it('watches with --watch so a quiet window never wakes the lead', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('`orca orchestration check --wait --watch --types')
    expect(brief).not.toContain('it timed out')
    expect(brief).not.toContain('wait again without `--ack`')
  })

  it('hands a non-implementation task to a member with --prompt', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain(
      'For a task that is not implementing the ticket (tests, QA runs, investigations) pass `--prompt <task>` to game launch.'
    )
  })

  it('places a member on a paired host with game launch --on, never a plain worker-start (ORCA-794)', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain(
      '`orca game launch <ticket> --on <host> --repo <selector of the repo on that host>`'
    )
    expect(brief).toContain('never with `orchestration worker-start --on`')
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

  // Why: ORCA-770's member sent a decision_gate and blocked; the lead saw it only through its own monitor.
  it('waits on decision gates too, so a member gate reaches the lead', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain(
      '--types worker_done,escalation,question,decision_gate --timeout-ms 900000'
    )
  })

  it('answers member questions and gates itself, falls back to a send, and records the answer', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('question or decision gate you can')
    expect(brief).toContain('if that reply fails')
    expect(brief).toContain(
      '`orca orchestration send --to <member terminal handle> --subject "Answer" --body <answer>`'
    )
    expect(brief).toContain('If the member is idle, `orca game push` it')
    expect(brief).toContain('Record each answer you give a member as a comment on its ticket')
  })

  it('asks the person only about what only they decide, and decides the rest itself', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('Ask the person only what only they can decide')
    expect(brief).toContain('releases and publishing')
    expect(brief).toContain('spending money or quota beyond the plan')
    expect(brief).toContain('force pushes to shared branches')
    expect(brief).toContain('changing repo visibility')
    expect(brief).toContain('credentials')
    expect(brief).toContain('scope or product direction')
    expect(brief).toContain('Decide everything else yourself')
  })

  it('consults an advisor tool once for a hard call, and decides by the bar without one', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain(
      'if your agent offers an advisor tool, consult it once for that decision'
    )
    expect(brief).toContain('never for a status update')
    expect(brief).toContain('Without one, decide by the bar above')
  })

  // Why: owner rule 2026-10-23: no pile of unfinished workspaces; the lead removes merged ones at once.
  it('removes a merged member worktree and its branch right away, never keeping them', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain("remove each merged member's worktree and its branch right away")
    expect(brief).toContain('`orca worktree rm --worktree branch:<branch>`')
    expect(brief).not.toContain('worktrees stay')
  })

  it('keeps members working and finishes each ticket before it starts another', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(brief).toContain('Keep members working')
    expect(brief).toContain('An idle member with no PR in flight is a lead failure')
    expect(brief).toContain('Finish before starting')
    expect(brief).toContain('new launches only fill slots freed by merged work')
  })
})

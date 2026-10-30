import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GameLeadSessions,
  awaitResumedLead,
  leadPaneStateOf,
  leadResumeArgsOf,
  resumeExitErrorOf,
  resumedPaneStateOf
} from './orchestrator-game-lead-sessions'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function sessions(): { store: GameLeadSessions; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-lead-'))
  dirs.push(dir)
  return { store: new GameLeadSessions(() => join(dir, 'leads')), dir }
}

const SESSION = {
  sessionId: 'sess-1',
  agentArgs: '--teammate-mode auto',
  worktreeId: 'wt1',
  accountId: null
}

describe('GameLeadSessions', () => {
  it("keeps each project's lead session across a restart of the store", async () => {
    const { store, dir } = sessions()
    expect(await store.read('repo:a')).toBeNull()

    await store.write('repo:a', SESSION)
    await store.write('repo:b', { ...SESSION, sessionId: 'sess-2', agentArgs: null })

    const reopened = new GameLeadSessions(() => join(dir, 'leads'))
    expect(await reopened.read('repo:a')).toEqual(SESSION)
    expect(await reopened.read('repo:b')).toEqual({
      ...SESSION,
      sessionId: 'sess-2',
      agentArgs: null
    })
  })

  it('keeps the account the lead ran on, so the reopen finds the conversation in its store', async () => {
    const { store } = sessions()
    await store.write('repo:a', { ...SESSION, accountId: 'acct-1' })

    expect(await store.read('repo:a')).toEqual({ ...SESSION, accountId: 'acct-1' })
  })

  it('reads a record kept before leads named their account as one with no account', async () => {
    const { store, dir } = sessions()
    await store.write('repo:a', SESSION)
    const [file] = (await import('node:fs')).readdirSync(join(dir, 'leads'))
    const { accountId: _none, ...legacy } = SESSION
    writeFileSync(join(dir, 'leads', file ?? ''), JSON.stringify(legacy))

    expect(await store.read('repo:a')).toEqual(SESSION)
  })

  it('reads a damaged record as no session', async () => {
    const { store, dir } = sessions()
    await store.write('repo:a', SESSION)
    const [file] = (await import('node:fs')).readdirSync(join(dir, 'leads'))
    writeFileSync(join(dir, 'leads', file ?? ''), '{"sessionId": 3}')

    expect(await store.read('repo:a')).toBeNull()
  })

  it("clears one project's session and leaves the others, even when there is none to clear", async () => {
    const { store } = sessions()
    await store.write('repo:a', SESSION)
    await store.write('repo:b', SESSION)

    await store.clear('repo:a')
    await store.clear('repo:a')
    await store.clear('repo:never')

    expect(await store.read('repo:a')).toBeNull()
    expect(await store.read('repo:b')).toEqual(SESSION)
  })
})

describe('leadResumeArgsOf', () => {
  it("keeps the lead's teammate mode, which a resume launch would otherwise drop with the game", () => {
    expect(
      leadResumeArgsOf({
        agentCommand:
          "claude --teammate-mode auto --plugin-dir '/opt/orca/game' '--dangerously-skip-permissions'",
        agentArgs: '--dangerously-skip-permissions'
      })
    ).toBe('--teammate-mode auto --dangerously-skip-permissions')
    expect(
      leadResumeArgsOf({ agentCommand: 'claude --teammate-mode in-process', agentArgs: '' })
    ).toBe('--teammate-mode in-process')
  })

  it('reads the Agent Teams wrapper as teammate mode auto, as it launches Claude', () => {
    expect(
      leadResumeArgsOf({
        agentCommand: 'orca claude-teams',
        agentArgs: '--dangerously-skip-permissions'
      })
    ).toBe('--teammate-mode auto --dangerously-skip-permissions')
    expect(
      leadResumeArgsOf({ agentCommand: "'/opt/orca dev/orca-dev' claude-teams", agentArgs: '' })
    ).toBe('--teammate-mode auto')
  })

  it('leaves args that already name a teammate mode, and has none for a plain pane', () => {
    expect(
      leadResumeArgsOf({ agentCommand: 'claude', agentArgs: '--teammate-mode=auto --verbose' })
    ).toBe('--teammate-mode=auto --verbose')
    expect(leadResumeArgsOf({ agentCommand: 'claude', agentArgs: '' })).toBeNull()
    expect(leadResumeArgsOf(null)).toBeNull()
  })
})

describe('awaitResumedLead', () => {
  const run = (reads: ('session' | 'running' | 'shell' | 'starting')[]) => {
    let at = 0
    let clock = 0
    return awaitResumedLead({
      read: async () => reads[Math.min(at++, reads.length - 1)] ?? 'shell',
      timeoutMs: 3000,
      settleMs: 1000,
      intervalMs: 500,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      }
    })
  }

  it('confirms once the reopened pane reports the stored session', async () => {
    await expect(run(['shell', 'running', 'session'])).resolves.toBe('resumed')
  })

  it('fails when Claude exits back to the shell, as it does for a missing conversation', async () => {
    await expect(run(['shell', 'running', 'shell'])).resolves.toBe('exited')
  })

  it('keeps a pane still running Claude when the session is not reported in time', async () => {
    await expect(run(['shell', 'running'])).resolves.toBe('resumed')
  })

  it('waits through the login and shell a pane passes before Claude starts', async () => {
    await expect(run(['starting', 'shell', 'starting', 'running', 'session'])).resolves.toBe(
      'resumed'
    )
  })

  it('counts Claude that kept running past the settle time without waiting for the deadline', async () => {
    await expect(run(['shell', 'running', 'running', 'running', 'shell'])).resolves.toBe('resumed')
  })

  it('keeps Claude that ran when its title reads as its version at the deadline', async () => {
    await expect(run(['shell', 'running', 'starting'])).resolves.toBe('resumed')
  })

  it('fails a pane that never left its shell by the deadline', async () => {
    await expect(run(['shell'])).resolves.toBe('exited')
  })
})

describe('resumeExitErrorOf', () => {
  it("names the account and Claude's own reason for refusing the conversation", () => {
    expect(
      resumeExitErrorOf({
        output: [
          "fabolivar@mac orca-oss % claude --resume 'sess-1'",
          'No conversation found with session ID: sess-1',
          'fabolivar@mac orca-oss % '
        ],
        account: 'lead@example.com'
      })
    ).toBe(
      'Claude exited instead of reopening the conversation on account lead@example.com: No conversation found with session ID: sess-1'
    )
  })

  it('quotes the last lines the pane printed when Claude gave another reason', () => {
    expect(
      resumeExitErrorOf({
        output: ['', 'Invalid API key · Please run /login', '% ', ''],
        account: null
      })
    ).toBe(
      'Claude exited instead of reopening the conversation: Invalid API key · Please run /login | %'
    )
  })

  it('says the pane printed nothing when its output is empty', () => {
    expect(resumeExitErrorOf({ output: [' ', ''], account: null })).toBe(
      'Claude exited instead of reopening the conversation: the pane printed nothing'
    )
  })
})

describe('resumedPaneStateOf', () => {
  it('counts only Claude itself as running, and a shell as the shell', () => {
    expect(resumedPaneStateOf('claude')).toBe('running')
    expect(resumedPaneStateOf('zsh')).toBe('shell')
    expect(resumedPaneStateOf('bash.exe')).toBe('shell')
  })

  it('reads what a pane shows while it starts as neither', () => {
    expect(resumedPaneStateOf('login')).toBe('starting')
    expect(resumedPaneStateOf('2.1.302')).toBe('starting')
    expect(resumedPaneStateOf(null)).toBe('starting')
  })
})

describe('leadPaneStateOf', () => {
  it('counts the Agent Teams wrapper a lead runs under as Claude', () => {
    expect(leadPaneStateOf('Orca')).toBe('running')
    expect(leadPaneStateOf('claude')).toBe('running')
  })

  it('reads a shell as the shell and anything else as not yet known', () => {
    expect(leadPaneStateOf('zsh')).toBe('shell')
    expect(leadPaneStateOf('vim')).toBe('starting')
    expect(leadPaneStateOf(null)).toBe('starting')
  })
})

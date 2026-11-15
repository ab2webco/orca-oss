import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import {
  ClaudeSetupTokenSessions,
  redactClaudeSecrets,
  type SetupTokenPty
} from './claude-setup-token-session'

// Built, not written out, so no secret scanner reads the fixture as a leaked credential.
const TOKEN = ['sk', 'ant', 'oat01', 'Zq3_x-'.repeat(15)].join('-')
const URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=abc'
const ACCOUNTS = { accounts: [] } as unknown as ClaudeRateLimitAccountsState

// Shaped like real `claude setup-token` 2.1.325 output: Ink places words with cursor moves.
const WELCOME =
  '\u001b7\u001b[r\u001b8\u001b[?25l\u001b[38;2;215;119;87mWelcome\u001b[9Gto\u001b[12GClaude\u001b[19GCode\r\r\n'
const SIGN_IN =
  "\u001b[38;2;153;153;153mBrowser didn't open? Use the url below to sign in (c to copy)\u001b[39m\r\r\n\r\r\n" +
  `\u001b]8;id=wkepyb;${URL}\u0007\u001b[38;2;153;153;153m${URL}\u001b[39m\u001b]8;;\u0007\r\r\n` +
  '\u001b[2GPaste\u001b[8Gcode\u001b[13Ghere\u001b[18Gif\u001b[21Gprompted\u001b[30G>\r\r\n'
const OAUTH_ERROR =
  "\u001b[2GOAuth\u001b[8Gerror:\u001b[15GThat\u001b[20Gcode\u001b[25Gwasn't\u001b[32Gaccepted.\u001b[42GPress\u001b[48GEnter\u001b[54Gto\u001b[57Gretry.\r\r\n"
const SUCCESS_HEAD =
  '\u001b[2GLong-lived\u001b[13Gauthentication\u001b[28Gtoken\u001b[34Gcreated\u001b[42Gsuccessfully!\r\r\n' +
  '\u001b[2GYour\u001b[7GOAuth\u001b[13Gtoken\u001b[19G(valid\u001b[26Gfor\u001b[30G1\u001b[32Gyear):\r\r\n\u001b[2G'

class FakePty implements SetupTokenPty {
  written: string[] = []
  killed = false
  private pending = ''
  private dataListeners: ((data: string) => void)[] = []
  private exitListeners: (() => void)[] = []
  // Like a real PTY, output written before anyone listens is not lost.
  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener)
    const pending = this.pending
    this.pending = ''
    if (pending) {
      listener(pending)
    }
  }
  onExit(listener: () => void): void {
    this.exitListeners.push(listener)
  }
  write(data: string): void {
    this.written.push(data)
  }
  kill(): void {
    if (!this.killed) {
      this.killed = true
      this.exit()
    }
  }
  emit(data: string): void {
    if (this.dataListeners.length === 0) {
      this.pending += data
      return
    }
    for (const listener of this.dataListeners) {
      listener(data)
    }
  }
  exit(): void {
    for (const listener of this.exitListeners) {
      listener()
    }
  }
}

function setup(storeToken = vi.fn().mockResolvedValue(ACCOUNTS)) {
  const ptys: FakePty[] = []
  let spawnedHome = ''
  const spawn = vi.fn(
    async (
      _command: string,
      _args: string[],
      options: { cwd: string; env: Record<string, string> }
    ) => {
      const pty = new FakePty()
      ptys.push(pty)
      pty.emit(WELCOME + SIGN_IN)
      spawnedHome = options.cwd
      return pty
    }
  )
  const sessions = new ClaudeSetupTokenSessions({ spawnPty: spawn, storeToken })
  return {
    get pty(): FakePty {
      return ptys.at(-1)!
    },
    spawn,
    sessions,
    storeToken,
    home: () => spawnedHome
  }
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('ClaudeSetupTokenSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs setup-token in a throwaway config dir with the browser suppressed', async () => {
    const { spawn, sessions, home } = setup()
    const started = await sessions.begin('account-1')

    expect(started.url).toBe(URL)
    const [, args, options] = spawn.mock.calls[0]
    expect(args).toEqual(['setup-token'])
    expect(options.env.CLAUDE_CONFIG_DIR).toBe(options.cwd)
    expect(options.env.BROWSER).toBe('true')
    expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(existsSync(home())).toBe(true)
    sessions.cancel(started.sessionId)
    expect(existsSync(home())).toBe(false)
  })

  it('types the code, then Enter on its own, and stores the captured token', async () => {
    const ctx = setup()
    const { sessions, storeToken } = ctx
    const { sessionId } = await sessions.begin('account-1')
    const pty = ctx.pty

    expect(sessions.submitCode(sessionId, '  abc123#state456 ').state).toBe('verifying')
    expect(pty.written).toEqual(['abc123#state456'])
    await vi.advanceTimersByTimeAsync(150)
    expect(pty.written).toEqual(['abc123#state456', '\r'])

    // A chunk that ends mid-token must not store the cut half.
    pty.emit(SUCCESS_HEAD + TOKEN.slice(0, 40))
    await flush()
    expect(storeToken).not.toHaveBeenCalled()
    pty.emit(`${TOKEN.slice(40)}\r\r\n\u001b[2GStore this token securely.\r\r\n`)
    await flush()

    expect(storeToken).toHaveBeenCalledWith('account-1', TOKEN)
    expect(pty.killed).toBe(true)
    expect(sessions.status(sessionId)).toEqual({ state: 'stored', error: null, accounts: ACCOUNTS })
  })

  it('hands the token to the session’s own store when it adds a new account (ORCA-1215)', async () => {
    const ctx = setup()
    const { sessions, storeToken } = ctx
    const addAccount = vi.fn().mockResolvedValue(ACCOUNTS)
    const { sessionId } = await sessions.begin('new-account:Team Max', addAccount)
    sessions.submitCode(sessionId, 'abc123')
    await vi.advanceTimersByTimeAsync(150)

    ctx.pty.emit(`${SUCCESS_HEAD}${TOKEN}\r\r\n`)
    await flush()

    expect(addAccount).toHaveBeenCalledWith(TOKEN)
    expect(storeToken).not.toHaveBeenCalled()
    expect(sessions.status(sessionId)).toEqual({ state: 'stored', error: null, accounts: ACCOUNTS })
  })

  it('reports a rejected code and never stores anything', async () => {
    const ctx = setup()
    const { sessions, storeToken } = ctx
    const { sessionId } = await sessions.begin('account-1')
    const pty = ctx.pty
    sessions.submitCode(sessionId, 'bogus')
    pty.emit(OAUTH_ERROR)
    await flush()

    expect(sessions.status(sessionId)).toEqual({
      state: 'failed',
      error: "That code wasn't accepted.",
      accounts: null
    })
    expect(storeToken).not.toHaveBeenCalled()
    expect(pty.killed).toBe(true)
  })

  it('fails when the CLI exits before printing a token', async () => {
    const ctx = setup()
    const { sessions, storeToken } = ctx
    const { sessionId } = await sessions.begin('account-1')
    const pty = ctx.pty
    sessions.submitCode(sessionId, 'code')
    pty.emit('\u001b[2GSomething\u001b[12Gwent\u001b[17Gwrong\r\n')
    pty.exit()

    const status = sessions.status(sessionId)
    expect(status.state).toBe('failed')
    expect(status.error).toContain('stopped before printing a token. Something went wrong')
    expect(storeToken).not.toHaveBeenCalled()
  })

  it('times out a code Claude never answers, and a sign-in nobody finishes', async () => {
    const first = setup()
    const one = await first.sessions.begin('account-1')
    first.sessions.submitCode(one.sessionId, 'code')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(first.sessions.status(one.sessionId).state).toBe('failed')
    expect(first.pty.killed).toBe(true)

    const second = setup()
    const two = await second.sessions.begin('account-1')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(second.sessions.status(two.sessionId)).toMatchObject({
      state: 'failed',
      error: 'The sign-in took too long. Start again.'
    })
    expect(first.storeToken).not.toHaveBeenCalled()
    expect(second.storeToken).not.toHaveBeenCalled()
  })

  it('rejects begin when no sign-in link appears, and cleans up', async () => {
    const pty = new FakePty()
    const storeToken = vi.fn()
    const sessions = new ClaudeSetupTokenSessions({ spawnPty: async () => pty, storeToken })
    const begun = sessions.begin('account-1')
    const assertion = expect(begun).rejects.toThrow(/did not print a sign-in link/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
    expect(pty.killed).toBe(true)
  })

  it('reports a failed vault write without the token in the message', async () => {
    const storeToken = vi.fn().mockRejectedValue(new Error(`settings.json is locked (${TOKEN})`))
    const ctx = setup(storeToken)
    const { sessions } = ctx
    const { sessionId } = await sessions.begin('account-1')
    const pty = ctx.pty
    sessions.submitCode(sessionId, 'code')
    pty.emit(`${SUCCESS_HEAD}${TOKEN}\r\n`)
    await flush()

    const status = sessions.status(sessionId)
    expect(status.state).toBe('failed')
    expect(status.error).toContain('could not be saved')
    expect(status.error).not.toContain(TOKEN)
  })

  it('cancels an earlier sign-in for the same account when a new one starts', async () => {
    const first = setup()
    const one = await first.sessions.begin('account-1')
    await first.sessions.begin('account-1')
    expect(() => first.sessions.status(one.sessionId)).toThrow(/Unknown or expired/)
  })

  it('refuses codes with whitespace or control characters inside', async () => {
    const ctx = setup()
    const { sessions } = ctx
    const { sessionId } = await sessions.begin('account-1')
    const pty = ctx.pty
    expect(() => sessions.submitCode(sessionId, 'abc\u001b[Adef')).toThrow(/exactly/)
    expect(() => sessions.submitCode(sessionId, 'abc def')).toThrow(/exactly/)
    expect(pty.written).toEqual([])
  })
})

describe('token redaction', () => {
  it('keeps the token out of every status, error and message the session produces', async () => {
    vi.useFakeTimers()
    try {
      const outputs: unknown[] = []
      const storeToken = vi.fn().mockRejectedValue(new Error(`write failed: ${TOKEN}`))
      const ctx = setup(storeToken)
      const { sessions } = ctx
      const started = await sessions.begin('account-1')
      outputs.push(started, sessions.submitCode(started.sessionId, 'code'))
      // The token in an error line and in a failed write, as well as the success line.
      ctx.pty.emit(`\u001b[2GOAuth error: bad ${TOKEN}\r\n`)
      await vi.advanceTimersByTimeAsync(0)
      outputs.push(sessions.status(started.sessionId))

      const again = await sessions.begin('account-1')
      sessions.submitCode(again.sessionId, 'code')
      ctx.pty.emit(`${SUCCESS_HEAD}${TOKEN}\r\n`)
      await vi.advanceTimersByTimeAsync(0)
      outputs.push(sessions.status(again.sessionId))

      const serialized = JSON.stringify(outputs)
      expect(serialized).not.toContain(TOKEN)
      expect(serialized).toContain('sk-ant-[redacted]')
    } finally {
      vi.useRealTimers()
    }
  })

  it('redacts any Anthropic secret prefix', () => {
    expect(redactClaudeSecrets(`a ${TOKEN} b sk-ant-api03-xyz`)).toBe(
      'a sk-ant-[redacted] b sk-ant-[redacted]'
    )
  })
})

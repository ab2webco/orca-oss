import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveClaudeCommand } from '../../../shared/node-cli-command-resolution'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import type {
  ClaudeSetupTokenStarted,
  ClaudeSetupTokenStatus
} from '../../../shared/claude-setup-token-types'

export type SetupTokenPty = {
  onData: (listener: (data: string) => void) => void
  onExit: (listener: () => void) => void
  write: (data: string) => void
  kill: () => void
}

export type SetupTokenPtySpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> }
) => Promise<SetupTokenPty>

type Deps = {
  spawnPty?: SetupTokenPtySpawner
  /** Stores through the existing vault path; it never runs unless a token was captured. */
  storeToken: (accountId: string, token: string) => Promise<ClaudeRateLimitAccountsState>
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>
}

const DEFAULT_TIMEOUTS = {
  url: 45_000,
  session: 10 * 60_000,
  verify: 90_000,
  submitDelay: 150,
  retention: 60_000
}
const MAX_OUTPUT = 64_000
const MAX_CODE_LENGTH = 2_048

const SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g
// Why the lookahead: a PTY chunk can end mid-token, and a cut token would be stored as valid.
const TOKEN_PATTERN = /sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{20,}(?=[^A-Za-z0-9_-])/
const AUTHORIZE_URL_PATTERN = /https:\/\/[^\s'"]*oauth\/authorize[^\s'"]*/
const ANY_URL_PATTERN = /https?:\/\/[^\s'"]+/
const OAUTH_ERROR_PATTERN = /OAuth error:\s*(.+?)(?:\s*Press Enter to retry\.?)?\s*(?:\r|\n|$)/
/* oxlint-disable no-control-regex -- terminal escapes are what is being parsed */
const OSC_PATTERN = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
// Why columns become spaces: Ink lays words out with cursor moves, not spaces.
const CURSOR_MOVE_PATTERN = /\u001b\[\d*[CG]/g
const CSI_PATTERN = /\u001b\[[0-9;?<=>]*[ -/]*[@-~]/g
const SHORT_ESCAPE_PATTERN = /\u001b[78=>]/g
/* oxlint-enable no-control-regex */

export function redactClaudeSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, 'sk-ant-[redacted]')
}

function visibleText(raw: string): string {
  return raw
    .replace(OSC_PATTERN, '')
    .replace(CURSOR_MOVE_PATTERN, ' ')
    .replace(CSI_PATTERN, '')
    .replace(SHORT_ESCAPE_PATTERN, '')
    .replace(/[ \t]+/g, ' ')
}

const spawnNodePty: SetupTokenPtySpawner = async (command, args, options) => {
  const pty = await import('node-pty')
  // Why cmd.exe on Windows: node-pty cannot run the .cmd shim claude installs there.
  const isWin32 = process.platform === 'win32'
  const term = pty.spawn(
    isWin32 ? 'cmd.exe' : command,
    isWin32 ? ['/c', `"${command}"`, ...args] : args,
    // Why 1000 columns: a wrapped URL or token would arrive split across lines.
    { name: 'xterm-256color', cols: 1000, rows: 50, cwd: options.cwd, env: options.env }
  )
  return {
    onData: (listener) => void term.onData(listener),
    onExit: (listener) => void term.onExit(() => listener()),
    write: (data) => term.write(data),
    kill: () => {
      try {
        term.kill()
      } catch {
        /* already exited */
      }
    }
  }
}

type StoreToken = (token: string) => Promise<ClaudeRateLimitAccountsState>

type Session = {
  id: string
  /** An account id, or a caller-chosen key for a sign-in that adds a new account. */
  key: string
  store: StoreToken
  home: string
  pty: SetupTokenPty
  /** Output since spawn, then only since the code went in, so an old error is not re-read. */
  raw: string
  status: ClaudeSetupTokenStatus
  /** Set once the CLI is stopped, so its own exit or late output changes nothing. */
  done: boolean
  timers: ReturnType<typeof setTimeout>[]
  onUrl: (() => void) | null
  onEarlyExit: ((reason: string) => void) | null
}

/** `claude setup-token` run on this host for one managed account; only the URL leaves it. */
export class ClaudeSetupTokenSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly spawnPty: SetupTokenPtySpawner
  private readonly timeouts: typeof DEFAULT_TIMEOUTS

  constructor(private readonly deps: Deps) {
    this.spawnPty = deps.spawnPty ?? spawnNodePty
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts }
  }

  /** `store` replaces the account-id store, e.g. to add a new account from the token. */
  async begin(key: string, store?: StoreToken): Promise<ClaudeSetupTokenStarted> {
    for (const session of this.sessions.values()) {
      if (session.key === key) {
        this.cancel(session.id)
      }
    }
    // Why a throwaway config dir and not the vault: setup-token saves nothing, and a CLI
    // started on the vault could refresh, and so rotate, the account's stored login.
    const home = mkdtempSync(join(tmpdir(), 'orca-setup-token-'))
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CLAUDE_CONFIG_DIR: home,
      TERM: 'xterm-256color',
      // Why: the dialog opens the link where the person sits; on a paired host the CLI
      // would open a browser on that other machine.
      BROWSER: 'true'
    }
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    let pty: SetupTokenPty
    try {
      pty = await this.spawnPty(resolveClaudeCommand(), ['setup-token'], { cwd: home, env })
    } catch (error) {
      rmSync(home, { recursive: true, force: true })
      throw new Error(
        `Could not start claude setup-token: ${redactClaudeSecrets(error instanceof Error ? error.message : String(error))}`
      )
    }
    const session: Session = {
      id: randomUUID(),
      key,
      store: store ?? ((token) => this.deps.storeToken(key, token)),
      home,
      pty,
      raw: '',
      status: { state: 'awaiting-code', error: null, accounts: null },
      done: false,
      timers: [],
      onUrl: null,
      onEarlyExit: null
    }
    this.sessions.set(session.id, session)
    pty.onData((data) => this.onData(session, data))
    pty.onExit(() => this.onExit(session))

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('claude setup-token did not print a sign-in link in time.'))
      }, this.timeouts.url)
      session.onUrl = () => {
        const text = visibleText(session.raw)
        const found = AUTHORIZE_URL_PATTERN.exec(text)?.[0] ?? ANY_URL_PATTERN.exec(text)?.[0]
        if (found) {
          clearTimeout(timer)
          resolve(found)
        }
      }
      session.onEarlyExit = (reason) => {
        clearTimeout(timer)
        reject(new Error(reason))
      }
      session.onUrl()
    }).catch((error: unknown) => {
      this.finish(session, null)
      this.sessions.delete(session.id)
      throw error
    })
    session.onUrl = null
    session.onEarlyExit = null
    session.timers.push(
      setTimeout(
        () => this.fail(session, 'The sign-in took too long. Start again.'),
        this.timeouts.session
      )
    )
    return { sessionId: session.id, url }
  }

  submitCode(sessionId: string, rawCode: string): ClaudeSetupTokenStatus {
    const session = this.require(sessionId)
    if (session.status.state !== 'awaiting-code') {
      throw new Error('This sign-in is not waiting for a code.')
    }
    const code = rawCode.trim()
    // oxlint-disable-next-line no-control-regex -- a control character would drive the prompt
    if (!code || code.length > MAX_CODE_LENGTH || /[\s\u0000-\u001f\u007f]/.test(code)) {
      throw new Error('Paste the code exactly as the sign-in page shows it.')
    }
    session.raw = ''
    session.status = { state: 'verifying', error: null, accounts: null }
    session.pty.write(code)
    // Why a pause before Enter: Ink reads one chunk as a paste and would keep the newline in it.
    session.timers.push(
      setTimeout(() => session.pty.write('\r'), this.timeouts.submitDelay),
      setTimeout(
        () => this.fail(session, 'Claude did not confirm the code in time. Start again.'),
        this.timeouts.verify
      )
    )
    return session.status
  }

  status(sessionId: string): ClaudeSetupTokenStatus {
    return this.require(sessionId).status
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.sessions.delete(sessionId)
      this.finish(session, null)
    }
  }

  private require(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Unknown or expired token sign-in. Start again.')
    }
    return session
  }

  private onData(session: Session, data: string): void {
    if (session.done) {
      return
    }
    session.raw = (session.raw + data).slice(-MAX_OUTPUT)
    session.onUrl?.()
    const text = visibleText(session.raw)
    const token = TOKEN_PATTERN.exec(text)?.[0]
    if (token) {
      this.capture(session, token)
      return
    }
    if (session.status.state === 'verifying') {
      const error = OAUTH_ERROR_PATTERN.exec(text)
      if (error) {
        this.fail(session, redactClaudeSecrets(error[1].trim()))
      }
    }
  }

  private onExit(session: Session): void {
    if (session.done) {
      return
    }
    const lines = visibleText(session.raw).split(/[\r\n]+/)
    const detail = redactClaudeSecrets(lines.findLast((line) => line.trim())?.trim() ?? '')
    const reason = `claude setup-token stopped before printing a token.${detail ? ` ${detail}` : ''}`
    if (session.onEarlyExit) {
      session.onEarlyExit(reason)
      return
    }
    this.fail(session, reason)
  }

  private capture(session: Session, token: string): void {
    // Why verifying until the write lands: the dialog must not report a token the vault lacks.
    session.status = { state: 'verifying', error: null, accounts: null }
    this.finish(session, 'keep-status')
    void session.store(token).then(
      (accounts) => {
        session.status = { state: 'stored', error: null, accounts }
      },
      (error: unknown) => {
        session.status = {
          state: 'failed',
          error: `The token could not be saved: ${redactClaudeSecrets(error instanceof Error ? error.message : String(error))}`,
          accounts: null
        }
      }
    )
  }

  private fail(session: Session, error: string): void {
    if (session.done) {
      return
    }
    session.status = { state: 'failed', error, accounts: null }
    this.finish(session, 'keep-status')
  }

  /** Stops the CLI and drops its output; with 'keep-status' the result stays readable a while. */
  private finish(session: Session, mode: 'keep-status' | null): void {
    session.done = true
    for (const timer of session.timers.splice(0)) {
      clearTimeout(timer)
    }
    session.raw = ''
    session.pty.kill()
    rmSync(session.home, { recursive: true, force: true })
    if (mode === 'keep-status') {
      const timer = setTimeout(() => this.sessions.delete(session.id), this.timeouts.retention)
      timer.unref?.()
    }
  }
}

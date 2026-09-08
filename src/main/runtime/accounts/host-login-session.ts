import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCliCommand } from '../../../shared/node-cli-command-resolution'

export type HostLoginAgent = 'claude' | 'codex'

export type HostLoginSessionStarted = {
  sessionId: string
  /** The page the user must open. Empty only if the agent never printed one. */
  url: string
  /** Codex device auth shows a short code on screen; Claude asks for one back. */
  deviceCode: string | null
  /** True when the agent is waiting for a code typed into its stdin. */
  awaitingCode: boolean
}

type Session = {
  id: string
  agent: HostLoginAgent
  child: ChildProcess
  /** Chosen here, never by the caller: a remote client must not name a path. */
  home: string
  exited: Promise<number | null>
  transcript: string
}

/** How long to wait for the agent to print its sign-in URL before giving up. */
const URL_WAIT_MS = 45_000
/** How long to wait for the agent to finish after the code goes in. */
const COMPLETION_WAIT_MS = 120_000
const MAX_TRANSCRIPT = 64_000

// Why capture both: `claude` prints the URL on stdout and `codex` splits its
// device-auth block across stdout and stderr depending on the terminal.
const URL_PATTERN = /https?:\/\/[^\s'"]+/
// Codex prints a short user code next to the verification URL.
const DEVICE_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/
// Claude ends its output with a prompt instead of exiting.
const AWAITING_CODE_PATTERN = /paste code|enter the code|code here/i

const sessions = new Map<string, Session>()

function agentInvocation(agent: HostLoginAgent, home: string): {
  command: string
  args: string[]
  env: Record<string, string>
} {
  if (agent === 'claude') {
    // Why --claudeai and not the console flow: it redirects to
    // platform.claude.com and hands the user a code to paste, so it needs no
    // loopback callback the caller's browser would have to reach.
    return { command: 'claude', args: ['auth', 'login', '--claudeai'], env: { CLAUDE_CONFIG_DIR: home } }
  }
  // Why --device-auth: the plain Codex flow binds a loopback callback on this
  // host, which is exactly what a remote caller cannot open.
  return { command: 'codex', args: ['login', '--device-auth'], env: { CODEX_HOME: home } }
}

function appendTranscript(session: Session, chunk: string): void {
  session.transcript = (session.transcript + chunk).slice(-MAX_TRANSCRIPT)
}

/** Start an agent sign-in on this host and return what the user needs to see. */
export async function beginHostLogin(agent: HostLoginAgent): Promise<HostLoginSessionStarted> {
  const home = mkdtempSync(join(tmpdir(), `orca-host-login-${agent}-`))
  const { command, args, env } = agentInvocation(agent, home)
  const child = spawn(resolveCliCommand(command), args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  })
  const session: Session = {
    id: randomUUID(),
    agent,
    child,
    home,
    transcript: '',
    exited: new Promise((resolve) => child.once('close', (code) => resolve(code)))
  }
  sessions.set(session.id, session)

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${command} did not print a sign-in URL in time`)),
        URL_WAIT_MS
      )
      const settleIfReady = (): void => {
        if (URL_PATTERN.test(session.transcript)) {
          clearTimeout(timer)
          resolve()
        }
      }
      const onChunk = (buf: Buffer): void => {
        appendTranscript(session, buf.toString())
        settleIfReady()
      }
      child.stdout?.on('data', onChunk)
      child.stderr?.on('data', onChunk)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      void session.exited.then(() => {
        clearTimeout(timer)
        // Why resolve and not reject: an agent that exits having printed the URL
        // already finished; the caller reads the transcript to find out.
        resolve()
      })
    })
  } catch (error) {
    endHostLogin(session.id)
    throw error
  }

  return {
    sessionId: session.id,
    url: URL_PATTERN.exec(session.transcript)?.[0] ?? '',
    deviceCode: DEVICE_CODE_PATTERN.exec(session.transcript)?.[1] ?? null,
    awaitingCode: AWAITING_CODE_PATTERN.test(session.transcript)
  }
}

export type HostLoginCompletion = {
  agent: HostLoginAgent
  /** The directory the agent wrote its credentials into, chosen by this host. */
  home: string
}

/** Hand the agent the code the user copied, then wait for it to finish. */
export async function completeHostLogin(
  sessionId: string,
  code: string | null
): Promise<HostLoginCompletion> {
  const session = sessions.get(sessionId)
  if (!session) {
    throw new Error('Unknown or already finished login session.')
  }
  if (code !== null && session.child.stdin?.writable) {
    session.child.stdin.write(`${code}\n`)
  }
  const exitCode = await Promise.race([
    session.exited,
    new Promise<number | null>((_resolve, reject) =>
      setTimeout(() => reject(new Error('The sign-in did not finish in time.')), COMPLETION_WAIT_MS)
    )
  ])
  if (exitCode !== 0) {
    const tail = session.transcript.trim().split('\n').slice(-3).join(' ')
    endHostLogin(sessionId)
    throw new Error(`Sign-in failed (exit ${exitCode ?? 'signal'}). ${tail}`.trim())
  }
  sessions.delete(sessionId)
  // Why the caller cleans up and not this module: the credentials still have to
  // be imported out of `home`, and deleting it here would race that import.
  return { agent: session.agent, home: session.home }
}

/** Kill a session the user abandoned and remove its temporary credentials. */
export function endHostLogin(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) {
    return
  }
  sessions.delete(sessionId)
  session.child.kill()
  rmSync(session.home, { recursive: true, force: true })
}

/** Remove a directory handed back by {@link completeHostLogin}. */
export function discardHostLoginHome(home: string): void {
  rmSync(home, { recursive: true, force: true })
}

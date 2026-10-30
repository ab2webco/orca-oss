import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { recognizeAgentProcess } from '../../shared/agent-process-recognition'
import { isShellProcess } from '../../shared/shell-process-detection'
import type { GameLeadSession } from './orchestrator-game-leads'

const sessionOf = (value: unknown): GameLeadSession | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { sessionId, agentArgs, worktreeId, accountId } = value as Record<string, unknown>
  // Why a missing account is valid: records kept before leads named their account have none.
  return typeof sessionId === 'string' &&
    sessionId !== '' &&
    typeof worktreeId === 'string' &&
    (agentArgs === null || typeof agentArgs === 'string') &&
    (accountId === undefined || accountId === null || typeof accountId === 'string')
    ? { sessionId, agentArgs, worktreeId, accountId: accountId ?? null }
    : null
}

const AGENT_TEAMS_WRAPPER = /(?:^|[\s'"])claude-teams(?=[\s'"]|$)/
const TEAMMATE_MODE = /(?:^|\s)--teammate-mode(?:=|\s+)(auto|in-process)(?=\s|$)/

/**
 * The args that reopen a lead with its game. Why the teammate mode: a `--resume` launch without one
 * starts as plain Claude, and the game only loads into an Agent Teams pane.
 */
export const leadResumeArgsOf = (
  launch: { agentCommand?: string; agentArgs: string } | null
): string | null => {
  const args = launch?.agentArgs.trim() ?? ''
  const command = launch?.agentCommand ?? ''
  // Why the wrapper: `orca claude-teams` adds `--teammate-mode auto` itself, so its command never shows it.
  const mode =
    TEAMMATE_MODE.exec(command)?.[1] ?? (AGENT_TEAMS_WRAPPER.test(command) ? 'auto' : undefined)
  const resumeArgs = mode && !TEAMMATE_MODE.test(args) ? `--teammate-mode ${mode} ${args}` : args
  return resumeArgs.trim() || null
}

/** What a reopened lead's pane runs. Why `starting`: a new pane shows `login`, then its shell, then Claude. */
export const resumedPaneStateOf = (foreground: string | null): 'running' | 'shell' | 'starting' => {
  if (foreground === null) {
    return 'starting'
  }
  if (recognizeAgentProcess(foreground)?.agent === 'claude') {
    return 'running'
  }
  return isShellProcess(foreground) ? 'shell' : 'starting'
}

/** What a lead's pane runs. Why the wrapper: `orca claude-teams` stays in front of the Claude it starts. */
export const leadPaneStateOf = (foreground: string | null): 'running' | 'shell' | 'starting' => {
  const agent = foreground === null ? undefined : recognizeAgentProcess(foreground)?.agent
  return agent === 'claude-agent-teams' ? 'running' : resumedPaneStateOf(foreground)
}

/**
 * Whether a reopened lead took. Why wait: the terminal spawns before Claude reads the conversation, and
 * a missing one makes Claude exit to the shell within seconds. The pane starts at its shell too, so only
 * a shell after Claude ran is a failure; Claude still up after `settleMs`, or at the deadline, counts.
 */
export const awaitResumedLead = async (args: {
  read: () => Promise<'session' | 'running' | 'shell' | 'starting'>
  timeoutMs: number
  settleMs: number
  intervalMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<'resumed' | 'exited'> => {
  const now = args.now ?? Date.now
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const deadline = now() + args.timeoutMs
  let ranSince: number | null = null
  for (;;) {
    const seen = await args.read()
    if (seen === 'session') {
      return 'resumed'
    }
    if (seen === 'shell' && ranSince !== null) {
      return 'exited'
    }
    if (seen === 'running') {
      ranSince ??= now()
    }
    if (ranSince !== null && now() - ranSince >= args.settleMs) {
      return 'resumed'
    }
    if (now() >= deadline) {
      return ranSince === null ? 'exited' : 'resumed'
    }
    await sleep(args.intervalMs)
  }
}

const MISSING_CONVERSATION = /no conversation found/i

/** Why the pane's own words: Claude prints why it refused, e.g. a conversation its account's store lacks. */
export const resumeExitErrorOf = (args: {
  output: readonly string[]
  account: string | null
}): string => {
  const lines = args.output.map((line) => line.trim()).filter((line) => line !== '')
  const reason =
    lines.find((line) => MISSING_CONVERSATION.test(line)) ??
    (lines.slice(-2).join(' | ') || 'the pane printed nothing')
  const on = args.account === null ? '' : ` on account ${args.account}`
  return `Claude exited instead of reopening the conversation${on}: ${reason}`
}

/** Each project's last lead conversation, one file per project, so it survives a restart of Orca. */
export class GameLeadSessions {
  constructor(private readonly dirOf: () => string) {}

  /** Null for a missing or damaged record: the caller then starts a new lead. */
  async read(projectKey: string): Promise<GameLeadSession | null> {
    try {
      return sessionOf(JSON.parse(await readFile(this.fileOf(projectKey), 'utf8')))
    } catch {
      return null
    }
  }

  async write(projectKey: string, session: GameLeadSession): Promise<void> {
    await mkdir(this.dirOf(), { recursive: true })
    const file = this.fileOf(projectKey)
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(session), 'utf8')
    await rename(temp, file)
  }

  /** Retires a project's stored lead conversation, so the next claim does not reopen it. */
  async clear(projectKey: string): Promise<void> {
    await rm(this.fileOf(projectKey), { force: true })
  }

  private fileOf(projectKey: string): string {
    const name = createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.lead.json`)
  }
}

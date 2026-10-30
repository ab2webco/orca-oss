import type { WorktreeProcessesResult } from '../../shared/worktree-processes'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime-client'
import { getRequiredWorktreeSelector } from '../selectors'

export function formatWorktreeProcesses(result: WorktreeProcessesResult): string {
  if (!result.supported) {
    return `Cannot list processes in ${result.root}: ${result.reason}.`
  }
  if (result.processes.length === 0) {
    return `No process has its cwd inside ${result.root}.`
  }
  const stopped = new Set(result.stopped)
  const protectedPids = new Set(result.protected)
  const lines = result.processes.map((p) => {
    const mark = stopped.has(p.pid) ? ' [stopped]' : protectedPids.has(p.pid) ? ' [kept]' : ''
    return `${p.pid}\t${p.ppid}\t${p.command}\t${p.cwd}${mark}`
  })
  const footer =
    result.stopped.length > 0
      ? `Stopped ${result.stopped.length}; kept ${result.protected.length} that still have a live owner (close their terminal instead).`
      : result.protected.length === result.processes.length
        ? 'Nothing to stop: every process still has a live owner (an open terminal, an agent, Orca or this shell).'
        : 'Run again with --stop to terminate them.'
  return [`PID\tPPID\tCOMMAND\tCWD`, ...lines, footer].join('\n')
}

// Why: the caller and its shell usually sit inside the worktree being cleaned; a remote
// runtime is another machine, where this pid would protect an unrelated process.
function callerPidFor(client: RuntimeClient): { callerPid?: number } {
  return client.isRemote ? {} : { callerPid: process.pid }
}

export const worktreeProcessesHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const result = await client.call<WorktreeProcessesResult>('worktree.processes', {
    worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client),
    stop: flags.get('stop') === true,
    ...callerPidFor(client)
  })
  printResult(result, json, formatWorktreeProcesses)
}

const BUSY_REMOVAL_ERROR =
  /EBUSY|ENOTEMPTY|EPERM|resource busy|directory not empty|used by another process|failed to delete/i

/** Only a busy folder is worth a process listing; a guard refusal must not suggest --stop. */
export function isBusyRemovalError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const code = (error as { code?: unknown }).code
  return BUSY_REMOVAL_ERROR.test(`${typeof code === 'string' ? code : ''} ${error.message}`)
}

/** After a busy `worktree rm`, names what still holds the folder; it never stops anything itself. */
export async function printProcessesHoldingWorktree(
  client: RuntimeClient,
  selector: string
): Promise<void> {
  let listing: WorktreeProcessesResult
  try {
    listing = (
      await client.call<WorktreeProcessesResult>('worktree.processes', {
        worktree: selector,
        stop: false,
        ...callerPidFor(client)
      })
    ).result
  } catch {
    // Why: an older runtime has no worktree.processes; the rm error alone is still reported.
    return
  }
  if (!listing.supported) {
    return
  }
  const kept = new Set(listing.protected)
  const holders = listing.processes
  if (holders.length === 0) {
    return
  }
  console.error(`warning: ${holders.length} process(es) still have their cwd in ${listing.root}:`)
  for (const p of holders) {
    console.error(`  ${p.pid} ${p.command}${kept.has(p.pid) ? ' [has a live owner]' : ''}`)
  }
  if (holders.some((p) => !kept.has(p.pid))) {
    console.error(`Stop the orphans with: orca worktree processes --worktree ${selector} --stop`)
  }
  if (holders.some((p) => kept.has(p.pid))) {
    console.error('Close the terminals or agents that own the others first.')
  }
}

/** `worktree rm` failure path: on a busy folder, name its holders, then rethrow the rm error. */
export async function rethrowWithProcessesHoldingWorktree(
  error: unknown,
  client: RuntimeClient,
  selector: string
): Promise<never> {
  if (isBusyRemovalError(error)) {
    await printProcessesHoldingWorktree(client, selector)
  }
  throw error
}

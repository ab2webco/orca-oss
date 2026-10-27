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
      ? `Stopped ${result.stopped.length}; kept ${result.protected.length} (Orca, this shell or another user).`
      : result.protected.length === result.processes.length
        ? 'Nothing to stop: every process is Orca, this shell or another user.'
        : 'Run again with --stop to terminate them.'
  return [`PID\tPPID\tCOMMAND\tCWD`, ...lines, footer].join('\n')
}

export const worktreeProcessesHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const result = await client.call<WorktreeProcessesResult>('worktree.processes', {
    worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client),
    stop: flags.get('stop') === true,
    // Why: the caller and its shell usually sit inside the worktree being cleaned.
    callerPid: process.pid
  })
  printResult(result, json, formatWorktreeProcesses)
}

/** After a failed `worktree rm`, names what still holds the folder; it never stops anything itself. */
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
        callerPid: process.pid
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
  const holders = listing.processes.filter((p) => !kept.has(p.pid))
  if (holders.length === 0) {
    return
  }
  console.error(`warning: ${holders.length} process(es) still have their cwd in ${listing.root}:`)
  for (const p of holders) {
    console.error(`  ${p.pid} ${p.command}`)
  }
  console.error(`Stop them with: orca worktree processes --worktree ${selector} --stop`)
}

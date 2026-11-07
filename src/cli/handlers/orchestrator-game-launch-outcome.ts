import type { CommandHandler } from '../dispatch'
import { postGameEvents } from './orchestrator-game-board-call'
import type { GameLaunchResult } from './orchestrator-game-launch-result'

type Client = Parameters<CommandHandler>[0]['client']

type ReleaseReceipt = {
  state: string
  reason?: string
  recovery?: string
  remote?: { removedWorktree: string | null; worktreeError?: string }
}

/** What a failed start left on its host, said from the release receipt and never assumed. */
async function releaseFailedRemoteStart(
  client: Client,
  dispatchId: string,
  host: string
): Promise<string> {
  try {
    const { result } = await client.call<ReleaseReceipt>('orchestration.workerRelease', {
      dispatch: dispatchId
    })
    if (result.remote?.removedWorktree) {
      return `Removed the worktree it created on ${host}.`
    }
    if (result.remote?.worktreeError) {
      return `Its worktree on ${host} was kept: ${result.remote.worktreeError}`
    }
    if (result.state !== 'released' && result.state !== 'already_released') {
      return `Its worktree on ${host} may remain: release ${result.state}${result.reason ? ` (${result.reason})` : ''}.${result.recovery ? ` ${result.recovery}` : ''}`
    }
    return ''
  } catch (error) {
    return `Its worktree on ${host} may remain: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Posts the start's event: `claimed` for a member under way, `failed` for one that is not. A failed
 * start on a paired host is released there, since each relaunch otherwise leaves another worktree
 * named after the ticket (ORCA-1103).
 */
export async function recordGameStartOutcome(
  client: Client,
  launched: GameLaunchResult,
  host: string | null
): Promise<GameLaunchResult> {
  const member = launched.dispatchId ? `member ${launched.dispatchId} ` : ''
  if (launched.state !== 'failed') {
    const who = [launched.agent, launched.account].filter(Boolean).join(' · ')
    await postGameEvents(client, [
      { kind: 'claimed', ticket: launched.ticket, text: `${member}[${launched.state}] ${who}` }
    ])
    return launched
  }
  const cleanup =
    host && launched.dispatchId
      ? await releaseFailedRemoteStart(client, launched.dispatchId, host)
      : ''
  const lastError = [launched.lastError, cleanup].filter(Boolean).join('\n') || undefined
  await postGameEvents(client, [
    {
      kind: 'failed',
      ticket: launched.ticket,
      text: `${member}start failed${lastError ? `: ${lastError}` : ''}`
    }
  ])
  return lastError ? { ...launched, lastError } : launched
}

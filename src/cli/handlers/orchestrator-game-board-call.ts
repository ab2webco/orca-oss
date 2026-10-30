import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { RuntimeRpcSuccess } from '../../shared/runtime-rpc-envelope'
import type { GameEventKind } from '../../shared/orchestrator-game-events'

type Client = Parameters<CommandHandler>[0]['client']

// Why the caller's own env: a member's board is its lead's, which the host resolves from its terminal.
export const gameBoardCaller = () => ({
  worktreeId: process.env.ORCA_WORKTREE_ID,
  terminalHandle: process.env.ORCA_TERMINAL_HANDLE
})

export function optionalText(
  flags: Map<string, string | boolean>,
  name: string
): string | undefined {
  const raw = flags.get(name)
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

export function sinceOf(flags: Map<string, string | boolean>): string | undefined {
  const since = optionalText(flags, 'since')
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--since must be a date like 2026-10-15 or 2026-10-15T09:00, not "${since}".`
    )
  }
  return since
}

/** A board RPC; an Orca older than it gets a clear update message instead of a bare error. */
export async function callGameBoard<T>(
  client: Client,
  method: string,
  params: Record<string, unknown>,
  what: string
): Promise<RuntimeRpcSuccess<T>> {
  try {
    return await client.call<T>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        `The connected Orca Lab does not keep game ${what} yet. Update or restart Orca Lab.`
      )
    }
    throw error
  }
}

export type GameEventDraft = {
  kind: GameEventKind
  ticket?: string
  text?: string
  key?: string
}

/** Posts what a command did or saw; never fails it, since an older Orca keeps no events. */
export async function postGameEvents(
  client: Client,
  drafts: readonly GameEventDraft[]
): Promise<void> {
  for (const draft of drafts) {
    await client.call('game.eventPost', { ...gameBoardCaller(), ...draft }).catch(() => undefined)
  }
}

/** Saves what the lead needs to resume a member after a restart; never fails the launch it rides on. */
export async function recordGameMember(
  client: Client,
  member: { ticket: string } & Record<string, string | undefined>
): Promise<void> {
  await client.call('game.memberRecord', { ...gameBoardCaller(), member }).catch(() => undefined)
}

/** Drops a member record a refused launch left, so it never reads as paused; never fails the caller. */
export async function forgetGameMember(client: Client, ticket: string): Promise<void> {
  await client
    .call('game.memberDiscard', { ...gameBoardCaller(), tickets: [ticket] })
    .catch(() => undefined)
}

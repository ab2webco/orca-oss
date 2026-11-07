import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import {
  parseGameOwnerQuestion,
  type GameOwnerQuestion
} from '../../../../shared/orchestrator-game-owner-questions'

const TEAM_RPC_TIMEOUT_MS = 15_000

/** The lead mod's own caller identity; game.state lists members only for the lead's pane. */
export type TeamLeadCaller = { worktreeId: string; terminalHandle: string; paneKey: string }

/** `paneKey` is absent from a host older than ORCA-1130, and on a pane the host has not placed. */
export type TeamLeadListing = { handle: string; paneKey?: string }

/** `game.leads`: live leads, and the panes of leads a restarted host is still bringing back. */
export type TeamLeadRoster = { leads: TeamLeadListing[]; restoring: string[] }

/**
 * The live lead whose pane sits in one of the active project's worktrees, or `restoring` while the
 * host brings one back after a restart.
 */
export function findTeamLeadCaller(args: {
  leads: readonly TeamLeadListing[]
  restoring?: readonly string[]
  entries: Readonly<Record<string, { paneKey: string; terminalHandle?: string }>>
  worktreeIdOfTab: (tabId: string) => string | null
  repoWorktreeIds: ReadonlySet<string>
}): TeamLeadCaller | 'restoring' | null {
  const worktreeOf = (paneKey: string): string | null => {
    const tabId = parsePaneKey(paneKey)?.tabId
    const worktreeId = tabId ? args.worktreeIdOfTab(tabId) : null
    return worktreeId && args.repoWorktreeIds.has(worktreeId) ? worktreeId : null
  }
  for (const lead of args.leads) {
    const worktreeId = lead.paneKey ? worktreeOf(lead.paneKey) : null
    if (lead.paneKey && worktreeId) {
      return { worktreeId, terminalHandle: lead.handle, paneKey: lead.paneKey }
    }
  }
  // Why still read agent status: an older host lists no pane, and a paired host's may not be local.
  const handles = new Set(args.leads.map((lead) => lead.handle))
  for (const entry of Object.values(args.entries)) {
    if (!entry.terminalHandle || !handles.has(entry.terminalHandle)) {
      continue
    }
    const worktreeId = worktreeOf(entry.paneKey)
    if (worktreeId) {
      return { worktreeId, terminalHandle: entry.terminalHandle, paneKey: entry.paneKey }
    }
  }
  return args.restoring?.some((paneKey) => worktreeOf(paneKey)) ? 'restoring' : null
}

const stringOf = (value: unknown, key: string): string | null => {
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}

export async function readTeamLeadRoster(target: RuntimeClientTarget): Promise<TeamLeadRoster> {
  const result = await callRuntimeRpc<{ leads?: unknown; restoring?: unknown }>(
    target,
    'game.leads',
    undefined,
    { timeoutMs: TEAM_RPC_TIMEOUT_MS }
  )
  // Why parse: a paired host may run another build.
  const objects = (list: unknown): object[] =>
    Array.isArray(list)
      ? list.filter((one): one is object => typeof one === 'object' && one !== null)
      : []
  return {
    leads: objects(result.leads).flatMap((one) => {
      const handle = stringOf(one, 'handle')
      const paneKey = stringOf(one, 'paneKey')
      return handle ? [{ handle, ...(paneKey ? { paneKey } : {}) }] : []
    }),
    restoring: objects(result.restoring).flatMap((one) => stringOf(one, 'paneKey') ?? [])
  }
}

export async function readTeamLeads(target: RuntimeClientTarget): Promise<{ handle: string }[]> {
  return (await readTeamLeadRoster(target)).leads
}

/**
 * Polls as the lead's mod does: recordGameMerges skips a merge it already saw only for the same
 * worktreeId and terminalHandle, so any other identity would record each merge twice.
 */
export async function readTeamLeadState(
  target: RuntimeClientTarget,
  caller: TeamLeadCaller
): Promise<OrchestratorGameState | null> {
  const state = await callRuntimeRpc<OrchestratorGameState>(
    target,
    'game.state',
    {
      worktreeId: caller.worktreeId,
      terminalHandle: caller.terminalHandle,
      paneKey: caller.paneKey
    },
    { timeoutMs: TEAM_RPC_TIMEOUT_MS }
  )
  return state?.role === 'lead' ? state : null
}

/** The project's characters XP summed, as `orca game characters` keeps it; null from a host with no list. */
export async function readTeamXp(
  target: RuntimeClientTarget,
  caller: TeamLeadCaller
): Promise<number | null> {
  const result = await callRuntimeRpc<{ characters?: unknown }>(
    target,
    'game.characters',
    { worktreeId: caller.worktreeId, terminalHandle: caller.terminalHandle },
    { timeoutMs: TEAM_RPC_TIMEOUT_MS }
  )
  if (!Array.isArray(result.characters)) {
    return null
  }
  return result.characters.reduce<number>((sum, one: unknown) => {
    const xp = (one as { xp?: unknown } | null)?.xp
    return typeof xp === 'number' && Number.isFinite(xp) && xp > 0 ? sum + xp : sum
  }, 0)
}

/** Every question the lead asked the user, answered too; parsed because a host may run another build. */
export async function readTeamOwnerQuestions(
  target: RuntimeClientTarget,
  caller: TeamLeadCaller
): Promise<GameOwnerQuestion[]> {
  const result = await callRuntimeRpc<{ questions?: unknown }>(
    target,
    'game.ownerQuestions',
    { worktreeId: caller.worktreeId, terminalHandle: caller.terminalHandle, all: true },
    { timeoutMs: TEAM_RPC_TIMEOUT_MS }
  )
  const questions = Array.isArray(result.questions) ? result.questions : []
  return questions.flatMap((raw) => parseGameOwnerQuestion(raw) ?? [])
}

import type { GameAccountProvider } from '../../../../shared/orchestrator-game-member-agent'
import { GAME_ACCOUNT_PROVIDER_LABELS } from '../../../../shared/orchestrator-game-member-agent'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import {
  resolveHostMemberAccount,
  type FederatedMemberAccount
} from './orchestration-federation-member-account'

// Why kept apart: an attach that took the global login has no pane to read until its agent starts.
const STARTING_TTL_MS = 120_000
const starting = new Map<string, { provider: GameAccountProvider; at: number }>()

/** Takes this host's global login for one federated member, refusing a second (ORCA-891). */
export async function claimFederatedGlobalLogin(args: {
  runtime: Pick<OrcaRuntimeService, 'federatedMembersOnGlobalLogin' | 'getOrchestrationDb'>
  dispatchId: string
  provider: GameAccountProvider
  now?: number
}): Promise<void> {
  const live = await args.runtime.federatedMembersOnGlobalLogin(args.provider)
  const db = args.runtime.getOrchestrationDb()
  const now = args.now ?? Date.now()
  for (const [dispatchId, claim] of starting) {
    const state = db.getRemoteDispatchAttachment(dispatchId)?.state
    if (state === undefined ? now - claim.at > STARTING_TTL_MS : state !== 'starting') {
      starting.delete(dispatchId)
    }
  }
  const pending = [...starting.keys()].filter(
    (id) => id !== args.dispatchId && starting.get(id)?.provider === args.provider
  )
  const holder = [...live, ...pending][0]
  if (holder !== undefined) {
    const label = GAME_ACCOUNT_PROVIDER_LABELS[args.provider]
    throw new OrchestrationError(
      'global_login_taken',
      `No managed ${label} account on this host, and ${holder} already runs on its global login; Orca puts one member there at a time because it cannot move or refresh it. Add an account there with \`orca account add\`, or wait for ${holder}.`
    )
  }
  starting.set(args.dispatchId, { provider: args.provider, at: now })
}

/** The account a federated attach runs on; the host's global login only once at a time. */
export async function attachAccountOf(
  args: Parameters<typeof resolveHostMemberAccount>[0] & {
    runtime: Parameters<typeof claimFederatedGlobalLogin>[0]['runtime']
    dispatchId: string
  }
): Promise<FederatedMemberAccount> {
  const resolved = await resolveHostMemberAccount(args)
  if (resolved.globalLogin) {
    await claimFederatedGlobalLogin({ ...args, provider: resolved.globalLogin })
  }
  return resolved
}

/** What the attach receipt tells the home: the account's email, or that it took the global login. */
export const accountReceiptOf = (resolved: FederatedMemberAccount | null) =>
  resolved?.account
    ? { account: resolved.account }
    : resolved?.globalLogin
      ? { globalLogin: true as const }
      : {}

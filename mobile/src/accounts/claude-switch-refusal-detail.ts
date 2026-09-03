import { z } from 'zod'
import {
  claudeAccountHoldersMessage,
  describeClaudeAccountHolders
} from '../../../src/shared/claude-account-block-holders'

const WorktreeUsage = z.object({
  worktreeId: z.string(),
  displayName: z.string().catch(''),
  hasLiveTerminal: z.boolean().catch(false)
})

const BlockingTerminal = z.object({
  accountId: z.string()
})

// Why every count is `.catch`: a host that adds or renames a field must not turn
// a real holder into "nothing is in the way". Only `supported` decides that, and
// a report that fails to parse at all degrades to unknown, never to none.
const UsageReport = z.object({
  accountId: z.string(),
  worktrees: z.array(WorktreeUsage).catch([]),
  liveTerminalCount: z.number().catch(0),
  pendingLaunchCount: z.number().catch(0),
  pendingGlobalLaunchCount: z.number().catch(0),
  blockedByOtherAccounts: z.array(BlockingTerminal).catch([]),
  supported: z.boolean()
})

type UsageRequestClient = {
  sendRequest: (
    method: string,
    params?: unknown
  ) => Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>
}

/**
 * The alert body for a refused Claude account switch. The host message alone
 * says an assigned worktree holds the account without naming it, and a phone
 * cannot close that terminal — so the detail is the whole remedy it can offer.
 */
export async function describeClaudeSwitchRefusal(args: {
  client: UsageRequestClient
  accountId: string | null
  hostMessage: string
}): Promise<string> {
  // Why null short-circuits: selecting the system default takes no live-PTY gate
  // (`ClaudeAccountService.selectAccount` only wraps a non-null id), so that
  // refusal has another cause and naming a holder would invent one.
  if (!args.accountId) {
    return args.hostMessage
  }
  const report = await readUsageReport(args.client, args.accountId)
  const detail = claudeAccountHoldersMessage(describeClaudeAccountHolders(report))
  return detail ? `${args.hostMessage}\n\n${detail}` : args.hostMessage
}

async function readUsageReport(
  client: UsageRequestClient,
  accountId: string
): Promise<z.infer<typeof UsageReport> | null> {
  try {
    const response = await client.sendRequest('accounts.claudeWorktreeUsage', { accountId })
    if (!response.ok) {
      return null
    }
    const parsed = UsageReport.safeParse(response.result)
    return parsed.success ? parsed.data : null
  } catch {
    // An older host has no such method; unknown is the honest degrade.
    return null
  }
}

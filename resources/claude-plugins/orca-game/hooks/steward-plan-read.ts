import type { EngineInterface } from 'claude-code'

import { runCli, viewOf } from './fleet-sync'
import { gamePlanArgvOf } from './game-config'
import { NAMED_TICKET } from './member-character'
import { stewardPlanOf } from './steward-record'

// Where the steward learns its member's ticket and the lead's plan for it (ORCA-1242).

/** The ticket from this pane's last state poll; null until a poll answered one. */
export async function readStewardTicket(
  $: EngineInterface
): Promise<{ ticket: string; title: string } | null> {
  const { state } = await viewOf($)
  const named = NAMED_TICKET.exec(state?.worktree?.displayName ?? '')
  const ticket = state?.workItem?.identifier ?? named?.[2]
  return ticket === undefined ? null : { ticket, title: state?.workItem?.title ?? named?.[3] ?? '' }
}

/** `orca game plan <ticket> --json`; null when the CLI could not answer, as an older Orca. */
export async function readStewardPlan($: EngineInterface, ticket: string) {
  const cli = await $.env.get('ORCA_GAME_CLI').catch(() => undefined)
  const out = await runCli($, gamePlanArgvOf(cli, ticket))
  return out?.exitCode === 0 ? stewardPlanOf(out.stdout) : null
}

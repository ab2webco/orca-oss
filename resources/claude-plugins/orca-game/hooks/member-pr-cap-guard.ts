import type { GameRole } from '../types'

// Why at command position: a grep for, or a heredoc naming, `gh pr create` opens no PR.
const PR_CREATE =
  /(?:^|[;&|(\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*gh\s+(?:(?:-R|--repo)[= ]\S+\s+)?pr\s+create\b/

export const isGhPrCreate = (command: unknown): boolean =>
  typeof command === 'string' && PR_CREATE.test(command)

/**
 * The refusal for a member's `gh pr create` once the project's open PRs reach its cap, or null to
 * let it run (ORCA-1301): `game launch` refused a 10th PR, but a live member opened 18 for one ticket.
 */
export function memberPrCapDenyOf(args: {
  role: GameRole | undefined
  command: unknown
  open: number | undefined
  cap: number | undefined
}): string | null {
  const { open, cap } = args
  if (args.role !== 'member' || !isGhPrCreate(args.command) || open === undefined || !cap) {
    return null
  }
  if (open < cap) {
    return null
  }
  return `Orca game member: ${open} open PRs already reach the project's cap of ${cap}, so this PR is refused. Push to your open PR instead, or send your lead a status and wait for its answer.`
}

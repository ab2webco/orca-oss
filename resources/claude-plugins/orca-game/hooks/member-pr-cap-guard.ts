import type { EngineInterface } from 'claude-code'

import { runCli } from './orca-cli-run'

// Why at command position: a grep for, or a heredoc naming, `gh pr create` opens no PR.
const PR_CREATE =
  /(?:^|[;&|(\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*gh\s+(?:(?:-R|--repo)[= ]\S+\s+)?pr\s+create\b/

export const isGhPrCreate = (command: unknown): boolean =>
  typeof command === 'string' && PR_CREATE.test(command)

// Same code as PR_CAP_REFUSE_EXIT in src/shared/orchestrator-game-pr-cap.ts, which the gh wrapper reads too.
const REFUSE_EXIT = 3
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/

export const prCapCheckArgvOf = (cli: string | null | undefined): readonly string[] | undefined => {
  const path = cli?.trim() ?? ''
  return ABSOLUTE_PATH.test(path) ? [path, 'game', 'pr-cap-check'] : undefined
}

/** The refusal `orca game pr-cap-check` printed, or null: any other answer lets gh run, as the wrapper does. */
export function memberPrCapDenyOf(
  out: { exitCode: number | null; stderr: string } | undefined
): string | null {
  if (out?.exitCode !== REFUSE_EXIT) {
    return null
  }
  return out.stderr.trim() || "Orca refused gh pr create: this project's open PRs reach its cap."
}

/**
 * Asks the host, as the gh wrapper does, whether a member's `gh pr create` is past the open-PR cap
 * (ORCA-1301). Why not the member's game state: it never carries the project's PRs for a member,
 * and why not only the wrapper: Claude's Bash re-reads the user's rc, which can put the real gh first.
 */
export async function memberPrCapDeny($: EngineInterface): Promise<string | null> {
  const cli = await $.env.get('ORCA_GAME_CLI').catch(() => undefined)
  return memberPrCapDenyOf(await runCli($, prCapCheckArgvOf(cli)))
}

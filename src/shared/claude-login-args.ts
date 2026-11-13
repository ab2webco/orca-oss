/** `claude auth login` with the claude.ai subscription flow named explicitly. */
export const CLAUDE_LOGIN_ARGS: readonly string[] = ['auth', 'login', '--claudeai']
/** The same subscription flow on a CLI that predates the flag (2.1.50 to 2.1.75 have `auth login` without it). */
export const CLAUDE_LOGIN_FALLBACK_ARGS: readonly string[] = ['auth', 'login']
export const CLAUDE_LOGIN_HELP_ARGS: readonly string[] = ['auth', 'login', '--help']

export class ClaudeCliTooOldError extends Error {
  constructor() {
    super(
      'This Claude Code is too old to sign in from Orca Lab: it has no `claude auth login`. Run `claude update` (or update Claude Code to 2.1.50 or later), then try again.'
    )
    this.name = 'ClaudeCliTooOldError'
  }
}

export function isClaudeaiUnknownOptionError(text: string): boolean {
  return /unknown option '?--claudeai'?/i.test(text)
}

/** True when the help is `auth login`'s own; a CLI with no `auth` command prints the root usage instead. */
function hasAuthLoginCommand(help: string): boolean {
  return /usage:\s*claude auth login/i.test(help)
}

type LoginFlagSupport = 'flag' | 'plain' | 'too-old'

/** Which login a host's Claude binary takes, learned once per binary, like GitCapabilityCache. */
export class ClaudeLoginFlagCache {
  private readonly support = new Map<string, LoginFlagSupport>()

  argsFor(key: string): readonly string[] {
    return this.support.get(key) === 'plain' ? CLAUDE_LOGIN_FALLBACK_ARGS : CLAUDE_LOGIN_ARGS
  }

  isTooOld(key: string): boolean {
    return this.support.get(key) === 'too-old'
  }

  remember(key: string, support: LoginFlagSupport): void {
    this.support.set(key, support)
  }
}

/** One cache per process: each host's binary is keyed by where it runs and its path. */
export const claudeLoginFlagCache = new ClaudeLoginFlagCache()

/**
 * Runs the Claude sign-in, retrying once without --claudeai when the CLI does not know it.
 * Why the help check first: on a CLI with no `auth` command, `claude auth login` is a prompt
 * that starts a model turn, not a sign-in.
 */
export async function runWithClaudeLoginFallback<T>(
  run: (args: readonly string[]) => Promise<T>,
  key: string,
  cache: ClaudeLoginFlagCache,
  readLoginHelp: () => Promise<string>
): Promise<T> {
  if (cache.isTooOld(key)) {
    throw new ClaudeCliTooOldError()
  }
  const args = cache.argsFor(key)
  try {
    return await run(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (args !== CLAUDE_LOGIN_ARGS || !isClaudeaiUnknownOptionError(message)) {
      throw error
    }
  }
  if (!hasAuthLoginCommand(await readLoginHelp())) {
    cache.remember(key, 'too-old')
    throw new ClaudeCliTooOldError()
  }
  cache.remember(key, 'plain')
  return run(CLAUDE_LOGIN_FALLBACK_ARGS)
}

/** How the mod starts the Orca CLI: its argv, and on Windows a batch CLI's line through cmd.exe. */
export type CliInvocation = { argv: readonly string[]; env?: Record<string, string> }

/** Carries a batch CLI's command line to cmd.exe, which expands it once and never re-reads it. */
export const CLI_LINE_ENV = 'ORCA_GAME_CLI_LINE'

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const BATCH_FILE = /\.(?:cmd|bat)$/i
// Why: a quote would end the word early and a line break would end cmd's command.
const UNSAFE_FOR_CMD = /["\r\n]/

const nativePathOf = (path: string): string =>
  DRIVE_PATH.test(path) ? path.replaceAll('/', '\\') : path

// Why double a trailing run: the child's argv parser reads `\"` as a literal quote.
const cmdWordOf = (value: string): string => `"${value.replace(/(\\+)$/, (run) => `${run}${run}`)}"`

/**
 * The argv to run the CLI with, or undefined when it cannot be run safely.
 * Why cmd.exe for a .cmd: Windows cannot start a batch file without it, and an argv handed to
 * cmd.exe is re-parsed, so the line travels in the env and cmd expands it once, after parsing.
 */
export const cliInvocationOf = (
  argv: readonly string[],
  comspec: string | null | undefined
): CliInvocation | undefined => {
  const [cli, ...args] = argv
  if (cli === undefined) {
    return undefined
  }
  const executable = nativePathOf(cli)
  if (!BATCH_FILE.test(executable)) {
    return { argv: [executable, ...args] }
  }
  const shell = comspec?.trim() ?? ''
  // Why absolute: a bare cmd.exe is looked up from the session's cwd first.
  if (!DRIVE_PATH.test(shell) || [executable, ...args].some((one) => UNSAFE_FOR_CMD.test(one))) {
    return undefined
  }
  return {
    argv: [shell, '/d', '/v:off', '/s', '/c', `%${CLI_LINE_ENV}%`],
    env: { [CLI_LINE_ENV]: [executable, ...args].map(cmdWordOf).join(' ') }
  }
}

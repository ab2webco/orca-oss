import type { EngineInterface } from 'claude-code'

import { cliInvocationOf } from './cli-invocation'

const CLI_TIMEOUT_MS = 15000

/** Runs the Orca CLI, through cmd.exe when Orca handed a Windows batch file; undefined when it could not. */
export async function runCli(
  $: EngineInterface,
  argv: readonly string[] | undefined,
  extraEnv: Record<string, string> = {},
  timeoutMs = CLI_TIMEOUT_MS
) {
  if (argv === undefined) {
    return undefined
  }
  const comspec = await $.env.get('ComSpec').catch(() => undefined)
  const invocation = cliInvocationOf(argv, comspec)
  if (invocation === undefined) {
    return undefined
  }
  const env = { ...invocation.env, ...extraEnv }
  const init = Object.keys(env).length > 0 ? { timeoutMs, env } : { timeoutMs }
  return await $.process.run(invocation.argv, init).catch(() => undefined)
}

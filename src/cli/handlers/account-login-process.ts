import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'
import { RuntimeClientError } from '../runtime-client'
import { envWithoutClaudeSession } from '../runtime/launch'
import {
  getVersionManagerBinPaths,
  resolveCliCommand
} from '../../shared/node-cli-command-resolution'
import {
  getSpawnArgsForWindows,
  UnsafeWindowsBatchArgumentsError,
  WINDOWS_BATCH_UNSAFE_CHARACTERS_LABEL
} from '../../shared/windows-batch-spawn'
import type { InteractiveLoginSession } from './interactive-login-interruption'

export function addAgentNodePaths(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pathKey =
    process.platform === 'win32' && env.Path !== undefined && env.PATH === undefined
      ? 'Path'
      : 'PATH'
  const currentEntries = (env[pathKey] ?? '').split(delimiter).filter(Boolean)
  const existing = new Set(currentEntries)
  const missing = getVersionManagerBinPaths().filter((entry) => !existing.has(entry))
  if (missing.length > 0) {
    env[pathKey] = [...missing, ...currentEntries].join(delimiter)
  }
  return env
}

/**
 * Runs the real agent login attached to the user's terminal so the OAuth
 * URL/device-code prompt is visible and the code can be pasted back — the desktop
 * GUI flow drives this via a browser Orca can't reach on a headless host.
 */
const STDERR_DRAIN_MS = 500
const HELP_WAIT_MS = 15_000

/** A short command's whole output; '' when it cannot run, so a missing CLI reads as no `auth login`. */
export function readCommandOutput(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise) => {
    let output = ''
    let child: ReturnType<typeof spawn>
    try {
      const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(resolveCliCommand(command), [...args])
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: addAgentNodePaths(envWithoutClaudeSession())
      })
    } catch {
      resolvePromise('')
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      resolvePromise(output)
    }, HELP_WAIT_MS)
    const collect = (chunk: Buffer): void => {
      output += chunk.toString()
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', () => {
      clearTimeout(timer)
      resolvePromise('')
    })
    child.once('close', () => {
      clearTimeout(timer)
      resolvePromise(output)
    })
  })
}

export async function runAgentLoginInTerminal(
  command: string,
  args: string[],
  extraEnv: Record<string, string>,
  json: boolean,
  session: InteractiveLoginSession,
  // Why: the Claude fallback must read an unknown-flag error, so stderr is teed instead of inherited.
  captureStderr = false
): Promise<void> {
  let stderrTail = ''
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const resolvedCommand = resolveCliCommand(command)
    let spawnCmd: string
    let spawnArgs: string[]
    try {
      ;({ spawnCmd, spawnArgs } = getSpawnArgsForWindows(resolvedCommand, args))
    } catch (error) {
      // Why: the bare sentinel message reaches the user verbatim otherwise, with
      // nothing naming the path or the characters that made it unspawnable.
      rejectPromise(
        error instanceof UnsafeWindowsBatchArgumentsError
          ? new RuntimeClientError(
              'invalid_environment',
              `Cannot run \`${command}\` from "${resolvedCommand}": the path contains characters ` +
                `cmd.exe would reinterpret. Install it somewhere without ` +
                `${WINDOWS_BATCH_UNSAFE_CHARACTERS_LABEL} in the path.`
            )
          : error
      )
      return
    }
    const env = addAgentNodePaths({ ...envWithoutClaudeSession(), ...extraEnv })
    const child = spawn(spawnCmd, spawnArgs, {
      // Why: JSON mode reserves stdout for the response envelope while keeping
      // the interactive login attached to the user's terminal via stderr.
      stdio: ['inherit', json ? process.stderr : 'inherit', captureStderr ? 'pipe' : 'inherit'],
      env
    })
    session.child = child
    if (captureStderr) {
      child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk)
        stderrTail = (stderrTail + chunk.toString()).slice(-2000)
      })
    }
    child.once('error', (error) =>
      rejectPromise(
        new RuntimeClientError(
          'internal',
          `Could not launch \`${command}\`. Is it installed and on PATH? (${
            error instanceof Error ? error.message : String(error)
          })`
        )
      )
    )
    child.once('exit', (code) => {
      session.child = null
      if (code === 0) {
        resolvePromise()
        return
      }
      const fail = (): void => {
        const tail = stderrTail.trim()
        rejectPromise(
          new RuntimeClientError(
            'internal',
            `\`${command} ${args.join(' ')}\` exited with code ${code ?? 'null'}.${tail ? ` ${tail}` : ''}`
          )
        )
      }
      // Why wait for the stream: 'exit' can fire before the last stderr chunk is read.
      if (captureStderr && child.stderr && !child.stderr.readableEnded) {
        child.stderr.once('end', fail)
        setTimeout(fail, STDERR_DRAIN_MS)
        return
      }
      fail()
    })
  })
}

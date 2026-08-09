import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  buildAccountListReport,
  formatAccountList,
  type RuntimeAccountsSnapshot
} from '../account-format'
import { printResult } from '../format'
import { readTerminalClaudeAccount } from '../terminal-claude-account'
import { RuntimeClientError } from '../runtime-client'
import { rejectRemoteSelectionFlags } from './account-runtime-scope'
import { switchClaudeTerminalAccount } from './account-switch'
import { stripElectronRunAsNode } from '../runtime/launch'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentialsStrict,
  writeActiveClaudeKeychainCredentials
} from '../../main/claude-accounts/keychain'
import {
  getVersionManagerBinPaths,
  resolveCliCommand
} from '../../shared/node-cli-command-resolution'
import {
  getSpawnArgsForWindows,
  UnsafeWindowsBatchArgumentsError,
  WINDOWS_BATCH_UNSAFE_CHARACTERS_LABEL
} from '../../shared/windows-batch-spawn'
import { ACCOUNT_IMPORT_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { ClaudeRateLimitAccountsState, CodexRateLimitAccountsState } from '../../shared/types'
import {
  type InteractiveLoginSession,
  withInteractiveLoginCleanup
} from './interactive-login-interruption'

// Why: Claude and Codex managed-account summaries both carry id+email+active id,
// so one formatter renders either provider's block.
type AccountsBlock = {
  accounts: readonly { id: string; email: string }[]
  activeAccountId: string | null
  activeAccountIdsByRuntime?: {
    host: string | null
    wsl: Record<string, string | null>
  }
}

/** Renders a provider's managed-account list as a human-readable block, marking the active account. */
function formatAccountsBlock(label: string, block: AccountsBlock): string {
  if (block.accounts.length === 0) {
    return `No managed ${label} accounts.`
  }
  const activeAccountIds = new Set([
    block.activeAccountId,
    block.activeAccountIdsByRuntime?.host,
    ...Object.values(block.activeAccountIdsByRuntime?.wsl ?? {})
  ])
  const lines = block.accounts.map(
    (account) => `  ${account.email}${activeAccountIds.has(account.id) ? ' (active)' : ''}`
  )
  return `Managed ${label} accounts (${block.accounts.length}):\n${lines.join('\n')}`
}

function addAgentNodePaths(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
async function runAgentLoginInTerminal(
  command: string,
  args: string[],
  extraEnv: Record<string, string>,
  json: boolean,
  session: InteractiveLoginSession
): Promise<void> {
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
    const env = addAgentNodePaths({ ...stripElectronRunAsNode(process.env), ...extraEnv })
    const child = spawn(spawnCmd, spawnArgs, {
      // Why: JSON mode reserves stdout for the response envelope while keeping
      // the interactive login attached to the user's terminal via stderr.
      stdio: ['inherit', json ? process.stderr : 'inherit', 'inherit'],
      env
    })
    session.child = child
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
      rejectPromise(
        new RuntimeClientError(
          'internal',
          `\`${command} ${args.join(' ')}\` exited with code ${code ?? 'null'}.`
        )
      )
    })
  })
}

async function cleanupClaudeLoginArtifacts(
  configDir: string,
  legacyCredentials: string | null,
  restoreLegacyCredentials: boolean
): Promise<void> {
  const errors: unknown[] = []
  if (process.platform === 'darwin') {
    try {
      await deleteActiveClaudeKeychainCredentialsStrict(configDir)
    } catch (error) {
      errors.push(error)
    }
    if (restoreLegacyCredentials) {
      try {
        await (legacyCredentials
          ? writeActiveClaudeKeychainCredentials(legacyCredentials)
          : deleteActiveClaudeKeychainCredentialsStrict())
      } catch (error) {
        errors.push(error)
      }
    }
  }
  try {
    rmSync(configDir, { recursive: true, force: true })
  } catch (error) {
    errors.push(error)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to clean up Claude login artifacts.')
  }
}

/** Logs into a Claude account in a temp config dir, then registers it with the local runtime. */
async function addClaudeAccount({ client, json }: HandlerContext): Promise<void> {
  const configDir = mkdtempSync(join(tmpdir(), 'orca-account-add-claude-'))
  const session: InteractiveLoginSession = {
    child: null,
    registering: false,
    terminationPromise: null
  }
  let legacyCredentials: string | null = null
  let restoreLegacyCredentials = false
  const result = await withInteractiveLoginCleanup(
    session,
    async () => {
      await cleanupClaudeLoginArtifacts(configDir, legacyCredentials, restoreLegacyCredentials)
    },
    async () => {
      if (process.platform === 'darwin') {
        legacyCredentials = await readActiveClaudeKeychainCredentialsStrict()
        restoreLegacyCredentials = true
      }
      await runAgentLoginInTerminal(
        'claude',
        ['auth', 'login', '--claudeai'],
        {
          CLAUDE_CONFIG_DIR: configDir
        },
        json,
        session
      )
      session.registering = true
      return client.call<ClaudeRateLimitAccountsState>('accounts.addClaudeFromConfigDir', {
        configDir,
        ...(process.platform === 'darwin'
          ? {
              previousLegacyCredentialsSha256: legacyCredentials
                ? createHash('sha256').update(legacyCredentials).digest('hex')
                : null
            }
          : {})
      })
    }
  )
  printResult(result, json, (state) => formatAccountsBlock('Claude', state))
}

/** Logs into a Codex account in a temp CODEX_HOME, then registers it with the local runtime. */
async function addCodexAccount({ client, json }: HandlerContext): Promise<void> {
  const codexHome = mkdtempSync(join(tmpdir(), 'orca-account-add-codex-'))
  const session: InteractiveLoginSession = {
    child: null,
    registering: false,
    terminationPromise: null
  }
  const result = await withInteractiveLoginCleanup(
    session,
    async () => {
      rmSync(codexHome, { recursive: true, force: true })
    },
    async () => {
      // Why: plain OAuth binds a loopback callback the user's browser cannot reach
      // on a headless/SSH host; device auth is explicitly designed for this flow.
      await runAgentLoginInTerminal(
        'codex',
        ['login', '--device-auth'],
        { CODEX_HOME: codexHome },
        json,
        session
      )
      session.registering = true
      return client.call<CodexRateLimitAccountsState>('accounts.addCodexFromHome', {
        sourceHome: codexHome
      })
    }
  )
  printResult(result, json, (state) => formatAccountsBlock('Codex', state))
}

async function assertAccountImportSupported({ client }: HandlerContext): Promise<void> {
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(ACCOUNT_IMPORT_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The running Orca runtime is too old to add accounts from the CLI. Update or restart Orca and try again.'
    )
  }
}

/** CLI handlers for `orca account add [--agent claude|codex]`, `orca account list` and `orca account switch`. */
export const ACCOUNT_HANDLERS: Record<string, CommandHandler> = {
  'account add': async (ctx) => {
    const agentFlag = ctx.flags.get('agent')
    // Why: a valueless `--agent` parses as boolean true; defaulting it to claude
    // would silently run a full OAuth login for the provider the user did not ask for.
    if (agentFlag !== undefined && typeof agentFlag !== 'string') {
      throw new RuntimeClientError(
        'invalid_argument',
        'Missing a value for --agent. Use `--agent claude` or `--agent codex`.'
      )
    }
    const agent = agentFlag ?? 'claude'
    if (agent !== 'claude' && agent !== 'codex') {
      throw new RuntimeClientError(
        'invalid_argument',
        `Unsupported --agent "${agent}". Use "claude" or "codex".`
      )
    }
    rejectRemoteSelectionFlags(ctx, 'orca account add')
    // Why: fail on runtime version skew before burning a full OAuth round trip.
    await assertAccountImportSupported(ctx)
    await ctx.client.call('accounts.list', { refreshUsage: false })
    await (agent === 'claude' ? addClaudeAccount(ctx) : addCodexAccount(ctx))
  },
  'account list': async (ctx) => {
    rejectRemoteSelectionFlags(ctx, 'orca account list')
    const { flags, client, json } = ctx
    // Why: accounts.list force-refreshes provider usage and can stall behind
    // broken auth; the cached snapshot is the safe default for scripted callers.
    const method = flags.get('refresh') === true ? 'accounts.list' : 'accounts.snapshot'
    const response = await client.call<RuntimeAccountsSnapshot>(method)
    const terminal = await readTerminalClaudeAccount({ flags, client })
    printResult(
      { ...response, result: buildAccountListReport(response.result, terminal) },
      json,
      formatAccountList
    )
  },
  'account switch': async (ctx) => {
    rejectRemoteSelectionFlags(ctx, 'orca account switch')
    await switchClaudeTerminalAccount(ctx)
  }
}

import type { HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { rejectRemoteSelectionFlags } from './account-runtime-scope'
import { CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

type TokenReader = () => Promise<string>

function formatTokenState(state: ClaudeRateLimitAccountsState): string {
  const lines = state.accounts
    .filter((account) => account.authMethod !== 'custom-endpoint')
    .map(
      (account) =>
        `  ${account.email}: long-lived token ${account.longLivedTokenSetAt ? 'set' : 'not set'}`
    )
  return `Claude accounts on this host:\n${lines.join('\n')}`
}

function requireAccountFlag(ctx: HandlerContext): string {
  const account = ctx.flags.get('account')
  if (typeof account !== 'string' || account.trim() === '') {
    throw new RuntimeClientError(
      'invalid_argument',
      'Missing --account <email|id>. Run `orca account list` to see the accounts on this host.'
    )
  }
  return account
}

async function assertTokensSupported(ctx: HandlerContext): Promise<void> {
  const status = await ctx.client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The running Orca Lab runtime is too old to store long-lived tokens. Update or restart Orca Lab and try again.'
    )
  }
}

async function setToken(ctx: HandlerContext, account: string, token: string | null) {
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>(
    'accounts.setClaudeLongLivedToken',
    { account, token }
  )
  printResult(result, ctx.json, formatTokenState)
}

export async function runAccountTokenSet(
  ctx: HandlerContext,
  readToken: TokenReader
): Promise<void> {
  rejectRemoteSelectionFlags(ctx, 'orca account token set')
  // Why: argv lands in shell history and `ps`; the token only ever arrives on stdin.
  if (ctx.flags.has('token')) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass the token on stdin, not as a flag: `claude setup-token`, then paste it at the prompt.'
    )
  }
  const account = requireAccountFlag(ctx)
  await assertTokensSupported(ctx)
  await setToken(ctx, account, await readToken())
}

export async function runAccountTokenClear(ctx: HandlerContext): Promise<void> {
  rejectRemoteSelectionFlags(ctx, 'orca account token clear')
  const account = requireAccountFlag(ctx)
  await assertTokensSupported(ctx)
  await setToken(ctx, account, null)
}

/** Reads piped stdin, or a terminal line without echo so the token never reaches scrollback. */
export async function readTokenFromStdin(): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    let value = ''
    for await (const chunk of stdin) {
      value += String(chunk)
    }
    return value
  }
  process.stderr.write('Paste the token from `claude setup-token` (input hidden), then Enter: ')
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (): void => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
    }
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          finish()
          resolve(value)
          return
        }
        if (character === '\u0003') {
          finish()
          reject(new RuntimeClientError('invalid_argument', 'Cancelled.'))
          return
        }
        value =
          character === '\u007f' || character === '\b' ? value.slice(0, -1) : value + character
      }
    }
    stdin.on('data', onData)
  })
}

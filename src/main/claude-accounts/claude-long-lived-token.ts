/**
 * A `claude setup-token` credential kept in an account's vault `settings.json` env.
 * The CLI applies that env at startup and ranks `CLAUDE_CODE_OAUTH_TOKEN` above the
 * stored /login credential (https://code.claude.com/docs/en/authentication), so a
 * launch on the vault never refreshes, and never rotates, the account's refresh chain.
 */
export const CLAUDE_LONG_LIVED_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

const MAX_TOKEN_LENGTH = 4_096

// Why error text never includes the value: these messages reach the CLI and the RPC log.
export function normalizeLongLivedToken(raw: string): string {
  const token = raw.trim()
  if (!token) {
    throw new Error('The long-lived token is empty.')
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new Error('The long-lived token is too long.')
  }
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is rejected
  if (/[\s\u0000-\u001f\u007f]/.test(token)) {
    throw new Error('The long-lived token contains whitespace or control characters.')
  }
  return token
}

function parseSettingsObject(settingsJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(settingsJson)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readEnv(settings: Record<string, unknown>): Record<string, unknown> {
  const env = settings.env
  return env !== null && typeof env === 'object' && !Array.isArray(env)
    ? { ...(env as Record<string, unknown>) }
    : {}
}

/** Sets (or, with null, clears) the token, keeping every other key of the vault settings. */
export function applyLongLivedTokenToVaultSettings(
  currentJson: string | null,
  token: string | null
): string {
  const settings = currentJson === null ? {} : parseSettingsObject(currentJson)
  if (settings === null) {
    // Why refuse: rebuilding would drop the hooks and instrumentation the CLI relies on.
    throw new Error('The account vault settings.json is not a JSON object; fix or remove it first.')
  }
  const env = readEnv(settings)
  if (token === null) {
    delete env[CLAUDE_LONG_LIVED_TOKEN_ENV]
  } else {
    env[CLAUDE_LONG_LIVED_TOKEN_ENV] = token
  }
  const next: Record<string, unknown> = { ...settings }
  if (Object.keys(env).length > 0) {
    next.env = env
  } else {
    delete next.env
  }
  return `${JSON.stringify(next, null, 2)}\n`
}

export function vaultSettingsHaveLongLivedToken(settingsJson: string | null): boolean {
  const settings = settingsJson === null ? null : parseSettingsObject(settingsJson)
  const value = settings ? readEnv(settings)[CLAUDE_LONG_LIVED_TOKEN_ENV] : undefined
  return typeof value === 'string' && value.trim() !== ''
}

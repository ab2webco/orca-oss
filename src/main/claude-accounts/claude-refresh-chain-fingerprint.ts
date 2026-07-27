import { createHash } from 'node:crypto'

export type ClaudeRefreshChainFingerprint = string & {
  readonly __claudeRefreshChainFingerprint: unique symbol
}

export function fingerprintClaudeRefreshChain(
  credentialsJson: string
): ClaudeRefreshChainFingerprint | null {
  const refreshToken = readRefreshToken(credentialsJson)
  if (!refreshToken) {
    return null
  }
  return createHash('sha256')
    .update(refreshToken, 'utf8')
    .digest('hex')
    .slice(0, 32) as ClaudeRefreshChainFingerprint
}

function readRefreshToken(credentialsJson: string): string | null {
  try {
    const parsed = JSON.parse(credentialsJson) as { claudeAiOauth?: unknown }
    if (
      !parsed.claudeAiOauth ||
      typeof parsed.claudeAiOauth !== 'object' ||
      Array.isArray(parsed.claudeAiOauth)
    ) {
      return null
    }
    const refreshToken = (parsed.claudeAiOauth as { refreshToken?: unknown }).refreshToken
    return typeof refreshToken === 'string' && refreshToken.trim() !== ''
      ? refreshToken.trim()
      : null
  } catch {
    return null
  }
}

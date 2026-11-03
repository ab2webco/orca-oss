/** OpenSSH known_hosts parsing and matching, following OpenSSH 10.2p1's observed behaviour. */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type KnownHostsOutcome =
  | 'match'
  | 'mismatch'
  | 'revoked'
  | 'ca-only'
  | 'unknown-type-known-host'
  | 'unknown'

export type KnownHostsEntry = {
  marker?: 'revoked' | 'cert-authority'
  /** Lower-cased literal or glob patterns; empty for hashed lines. */
  patterns: string[]
  negations: string[]
  hashed?: { salt: Buffer; hash: Buffer }
  keyType: string
  key: Buffer
}

export type KnownHostsQuery = {
  host: string
  port: number
  keyType: string
  key: Buffer
  /** HostKeyAlias lookups never add the port, as in ssh. */
  isHostKeyAlias?: boolean
}

const MAX_KEY_TYPE_BYTES = 64

export function readHostKeyType(key: Buffer): string | undefined {
  if (key.length < 4) {
    return undefined
  }
  const length = key.readUInt32BE(0)
  if (length === 0 || length > MAX_KEY_TYPE_BYTES || 4 + length > key.length) {
    return undefined
  }
  return key.subarray(4, 4 + length).toString('utf8')
}

/** OpenSSH drops blobs whose length-prefixed fields do not consume the buffer exactly. */
function isWellFormedKeyBlob(key: Buffer): boolean {
  let offset = 0
  while (offset < key.length) {
    if (offset + 4 > key.length) {
      return false
    }
    offset += 4 + key.readUInt32BE(offset)
  }
  return offset === key.length
}

/** Buffer.from skips junk; only exact canonical base64 may grant trust. */
function decodeCanonicalBase64(raw: string): Buffer | undefined {
  const decoded = Buffer.from(raw, 'base64')
  return decoded.length > 0 && decoded.toString('base64') === raw ? decoded : undefined
}

function parseHashedField(field: string): KnownHostsEntry['hashed'] | undefined {
  const [empty, version, rawSalt, rawHash, ...rest] = field.split('|')
  if (empty !== '' || version !== '1' || rest.length > 0) {
    return undefined
  }
  const salt = decodeCanonicalBase64(rawSalt ?? '')
  const hash = decodeCanonicalBase64(rawHash ?? '')
  return salt?.length === 20 && hash?.length === 20 ? { salt, hash } : undefined
}

export function parseKnownHostsLine(line: string): KnownHostsEntry | undefined {
  const fields = line.trim().split(/\s+/)
  if (!fields[0] || fields[0].startsWith('#')) {
    return undefined
  }
  let marker: KnownHostsEntry['marker']
  if (fields[0].startsWith('@')) {
    // An unknown marker may restrict trust, so the line is never read as unmarked.
    if (fields[0] !== '@revoked' && fields[0] !== '@cert-authority') {
      return undefined
    }
    marker = fields[0] === '@revoked' ? 'revoked' : 'cert-authority'
    fields.shift()
  }
  const [hostField, keyType, keyBase64] = fields
  if (!hostField || !keyType || !keyBase64) {
    return undefined
  }
  const key = decodeCanonicalBase64(keyBase64)
  if (!key || readHostKeyType(key) !== keyType || !isWellFormedKeyBlob(key)) {
    return undefined
  }
  const base = { ...(marker ? { marker } : {}), keyType, key }
  if (hostField.startsWith('|1|')) {
    const hashed = parseHashedField(hostField)
    return hashed ? { ...base, patterns: [], negations: [], hashed } : undefined
  }
  const patterns: string[] = []
  const negations: string[] = []
  for (const raw of hostField.toLowerCase().split(',')) {
    if (raw.startsWith('!')) {
      negations.push(raw.slice(1))
    } else if (raw) {
      patterns.push(raw)
    }
  }
  return patterns.length > 0 ? { ...base, patterns, negations } : undefined
}

export function parseKnownHosts(contents: string): KnownHostsEntry[] {
  return contents
    .split(/\r?\n/)
    .map(parseKnownHostsLine)
    .filter((entry): entry is KnownHostsEntry => entry !== undefined)
}

function patternMatches(pattern: string, candidate: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return pattern === candidate
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(candidate)
}

function entryMatchesHost(entry: KnownHostsEntry, candidate: string): boolean {
  if (entry.hashed) {
    const digest = createHmac('sha1', entry.hashed.salt).update(candidate).digest()
    return timingSafeEqual(digest, entry.hashed.hash)
  }
  if (entry.negations.some((pattern) => patternMatches(pattern, candidate))) {
    return false
  }
  return entry.patterns.some((pattern) => patternMatches(pattern, candidate))
}

/** Off port 22 ssh tries `[host]:port`, then the bare host as a fallback that can only match. */
export function hostCandidates(host: string, port: number, isHostKeyAlias = false): string[] {
  const lower = host.toLowerCase()
  return port === 22 || isHostKeyAlias ? [lower] : [`[${lower}]:${port}`, lower]
}

export function matchKnownHosts(
  entries: readonly KnownHostsEntry[],
  query: KnownHostsQuery
): KnownHostsOutcome {
  const candidates = hostCandidates(query.host, query.port, query.isHostKeyAlias)
  // Revocation is resolved first so the verdict cannot depend on line order.
  const revoked = entries.some(
    (entry) =>
      entry.marker === 'revoked' &&
      entry.key.equals(query.key) &&
      candidates.some((candidate) => entryMatchesHost(entry, candidate))
  )
  if (revoked) {
    return 'revoked'
  }
  let sawCertAuthority = false
  for (const [pass, candidate] of candidates.entries()) {
    let sawPlainEntry = false
    let sawSameType = false
    for (const entry of entries) {
      if (entry.marker === 'revoked' || !entryMatchesHost(entry, candidate)) {
        continue
      }
      // A CA line only validates certificates, which ssh2 cannot present.
      if (entry.marker === 'cert-authority') {
        sawCertAuthority = true
        continue
      }
      if (entry.key.equals(query.key)) {
        return 'match'
      }
      sawPlainEntry = true
      sawSameType ||= entry.keyType === query.keyType
    }
    // Only the first pass is change evidence; a bare fallback non-match is first contact in ssh.
    if (pass === 0 && sawPlainEntry) {
      return sawSameType ? 'mismatch' : 'unknown-type-known-host'
    }
  }
  return sawCertAuthority ? 'ca-only' : 'unknown'
}

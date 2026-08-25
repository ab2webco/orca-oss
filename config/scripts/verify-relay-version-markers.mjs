#!/usr/bin/env node
// Fails when a relay directory arrived without its `.version` marker.
//
// Why this exists as an artifact check and not a spec: `.version` is a dotfile,
// and actions/upload-artifact drops those unless `include-hidden-files: true`.
// The shard then downloads relay.js with no marker and every SSH spec dies on
// "missing its version marker" — which surfaces as a locator that never
// resolves, not as an error naming the marker. A green spec only proves the
// marker travelled today; this proves it travelled at all.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function findRelayMarkerFailures(relayRoot) {
  if (!existsSync(relayRoot)) {
    return [`${relayRoot} does not exist — the relay was never built or never packaged.`]
  }

  const bundleDirs = readdirSync(relayRoot).filter((entry) => {
    const dir = join(relayRoot, entry)
    if (!statSync(dir).isDirectory()) {
      return false
    }
    return readdirSync(dir).some((file) => file.endsWith('.js'))
  })

  if (bundleDirs.length === 0) {
    return [`${relayRoot} holds no relay bundle directory.`]
  }

  return bundleDirs.flatMap((entry) => {
    const marker = join(relayRoot, entry, '.version')
    if (!existsSync(marker)) {
      return [`${marker} is missing — hidden files were stripped from the relay bundle.`]
    }
    if (readFileSync(marker, 'utf8').trim().length === 0) {
      return [`${marker} is empty.`]
    }
    return []
  })
}

export function main(relayRoot, { log = console.error } = {}) {
  const failures = findRelayMarkerFailures(relayRoot)
  if (failures.length > 0) {
    for (const failure of failures) {
      log(`[relay-markers] ${failure}`)
    }
    return 1
  }
  log('[relay-markers] every packaged relay bundle carries its .version marker')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv[2] ?? join(process.cwd(), 'out', 'relay')))
}

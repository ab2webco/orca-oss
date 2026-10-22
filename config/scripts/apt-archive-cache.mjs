// Keys and prunes the apt archive cache used by .github/actions/install-apt-packages
// (ORCA-750). The Azure apt mirror served a 61 MB .deb at ~40 kB/s, so a shard spent
// 24-27 of its 45 minutes downloading; restoring the archives from the Actions cache
// takes the mirror out of the path whenever the resolved package set is unchanged.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// `'<uri>' <file name> <size> <hash>` per archive apt would fetch.
const PRINT_URIS_LINE = /^'[^']+'\s+(\S+\.deb)\s+\d+\s+\S+$/

export function parsePrintUris(text) {
  return text
    .split('\n')
    .map((line) => PRINT_URIS_LINE.exec(line.trim())?.[1])
    .filter((file) => file !== undefined)
}

// Why the file names: they carry package, version and arch, so the key moves on
// any version bump and stays put across re-runs that resolve the same set.
export function archiveCacheKey(prefix, files) {
  const digest = createHash('sha256')
    .update([...files].sort().join('\n'))
    .digest('hex')
  return `${prefix}-${digest.slice(0, 16)}`
}

// Why prune: a restore-keys fallback brings back older archives, and saving them
// again under the new key would grow the cache on every version bump.
export function pruneArchives(dir, keep) {
  const wanted = new Set(keep)
  for (const entry of readdirSync(dir)) {
    if (!wanted.has(entry)) {
      rmSync(join(dir, entry), { recursive: true, force: true })
    }
  }
}

function readFlag(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) {
    throw new Error(`missing ${name}`)
  }
  return args[index + 1]
}

function main(argv) {
  const [command, ...args] = argv
  const listPath = readFlag(args, '--list')
  if (command === 'key') {
    // Why a file and not stdin: readFileSync(0) on a non-blocking pipe throws EAGAIN.
    const files = parsePrintUris(readFileSync(readFlag(args, '--uris'), 'utf8'))
    writeFileSync(listPath, `${files.join('\n')}\n`)
    process.stdout.write(`key=${archiveCacheKey(readFlag(args, '--prefix'), files)}\n`)
    return
  }
  if (command === 'prune') {
    const keep = readFileSync(listPath, 'utf8').split('\n').filter(Boolean)
    pruneArchives(readFlag(args, '--dir'), keep)
    return
  }
  throw new Error(`unknown command: ${command ?? '(none)'}`)
}

if (process.argv[1] === import.meta.filename) {
  main(process.argv.slice(2))
}

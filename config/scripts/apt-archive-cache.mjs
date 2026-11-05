// Keys and prunes the apt archive cache used by .github/actions/install-apt-packages
// (ORCA-750). The Azure apt mirror served a 61 MB .deb at ~40 kB/s, so a shard spent
// 24-27 of its 45 minutes downloading; restoring the archives from the Actions cache
// takes the mirror out of the path whenever the resolved package set is unchanged.
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// `'<uri>' <file name> <size> <hash>` per archive apt would fetch.
const PRINT_URIS_LINE = /^'([^']+)'\s+(\S+\.deb)\s+(\d+)\s+(\S+)$/

export function parsePrintUriEntries(text) {
  return text
    .split('\n')
    .map((line) => PRINT_URIS_LINE.exec(line.trim()))
    .filter((match) => match !== null)
    .map(([, uri, file, size, hash]) => ({ uri, file, size: Number(size), hash }))
}

export function parsePrintUris(text) {
  return parsePrintUriEntries(text).map((entry) => entry.file)
}

// Why the requested set in the prefix: restore-keys takes the newest prefix match on
// the run's own ref before main is searched, so the build job's 5 kB build-essential
// cache shadowed the shards' fonts-noto-cjk set saved on main (ORCA-1059).
export function packageSetPrefix(prefix, packages) {
  const names = packages.split(/\s+/).filter(Boolean).sort()
  return `${prefix}-${createHash('sha256').update(names.join(' ')).digest('hex').slice(0, 8)}`
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

export const FALLBACK_MIRRORS = [
  'http://archive.ubuntu.com/ubuntu',
  'http://mirrors.edge.kernel.org/ubuntu'
]

// Why 2 MiB per 20 s (~105 kB/s): slower than that, the 61.2 MB font cannot finish
// inside one 600 s apt attempt, so waiting on that mirror only burns the shard.
export const STALL_WINDOW = { ms: 20_000, minBytes: 2 * 1024 * 1024 }

export function mirrorCandidates(uri, mirrors) {
  const pool = uri.indexOf('/pool/')
  const alternates = pool === -1 ? [] : mirrors.map((mirror) => mirror + uri.slice(pool))
  return [...new Set([uri, ...alternates])]
}

const HASH_ALGORITHMS = { SHA512: 'sha512', SHA256: 'sha256', SHA1: 'sha1', MD5Sum: 'md5' }

async function download(url, dest, { size, hash }, stall) {
  const [type, expected] = hash.split(':')
  const digest = HASH_ALGORITHMS[type] ? createHash(HASH_ALGORITHMS[type]) : null
  const controller = new AbortController()
  let received = 0
  let windowStart = 0
  const watchdog = setInterval(() => {
    if (received - windowStart < stall.minBytes) {
      controller.abort(new Error(`stalled: ${received - windowStart} B in ${stall.ms} ms`))
    }
    windowStart = received
  }, stall.ms)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const count = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length
        digest?.update(chunk)
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body), count, createWriteStream(dest), {
      signal: controller.signal
    })
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error
  } finally {
    clearInterval(watchdog)
  }
  if (received !== size) {
    throw new Error(`size ${received} != ${size}`)
  }
  if (digest && digest.digest('hex') !== expected) {
    throw new Error(`${type} mismatch`)
  }
}

// Why before apt: apt has no low-speed limit, so one trickling mirror holds an attempt
// for its full 600 s deadline; this drops a stalled mirror within one window and tries
// the next. Best effort: anything left missing is still apt's to fetch.
export async function fetchArchives(
  entries,
  dir,
  { mirrors = FALLBACK_MIRRORS, stall = STALL_WINDOW, log = console.log } = {}
) {
  mkdirSync(join(dir, 'partial'), { recursive: true })
  const result = { cached: 0, fetched: 0, failed: 0 }
  for (const entry of entries) {
    const target = join(dir, entry.file)
    if (existsSync(target) && statSync(target).size === entry.size) {
      result.cached += 1
      continue
    }
    const partial = join(dir, 'partial', entry.file)
    let fetched = false
    for (const url of mirrorCandidates(entry.uri, mirrors)) {
      const started = Date.now()
      try {
        await download(url, partial, entry, stall)
        renameSync(partial, target)
        log(`fetched ${entry.file} (${entry.size} B) from ${url} in ${Date.now() - started} ms`)
        fetched = true
        break
      } catch (error) {
        rmSync(partial, { force: true })
        log(
          `::warning::${entry.file} from ${url} failed after ${Date.now() - started} ms: ${error.message}`
        )
      }
    }
    result[fetched ? 'fetched' : 'failed'] += 1
  }
  log(
    `apt archives: ${result.cached} cached, ${result.fetched} fetched, ${result.failed} left to apt`
  )
  return result
}

function readFlag(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) {
    throw new Error(`missing ${name}`)
  }
  return args[index + 1]
}

async function main(argv) {
  const [command, ...args] = argv
  if (command === 'key') {
    // Why a file and not stdin: readFileSync(0) on a non-blocking pipe throws EAGAIN.
    const files = parsePrintUris(readFileSync(readFlag(args, '--uris'), 'utf8'))
    const prefix = packageSetPrefix(readFlag(args, '--prefix'), readFlag(args, '--packages'))
    writeFileSync(readFlag(args, '--list'), `${files.join('\n')}\n`)
    process.stdout.write(`prefix=${prefix}\nkey=${archiveCacheKey(prefix, files)}\n`)
    return
  }
  if (command === 'fetch') {
    const entries = parsePrintUriEntries(readFileSync(readFlag(args, '--uris'), 'utf8'))
    await fetchArchives(entries, readFlag(args, '--dir'))
    return
  }
  if (command === 'prune') {
    const keep = readFileSync(readFlag(args, '--list'), 'utf8').split('\n').filter(Boolean)
    pruneArchives(readFlag(args, '--dir'), keep)
    return
  }
  throw new Error(`unknown command: ${command ?? '(none)'}`)
}

if (process.argv[1] === import.meta.filename) {
  await main(process.argv.slice(2))
}

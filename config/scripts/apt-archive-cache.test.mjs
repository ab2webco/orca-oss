// The apt archive cache key must change exactly when the set of .deb files apt
// would download changes, and pruning must keep only that set (ORCA-750).
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  archiveCacheKey,
  fetchArchives,
  mirrorCandidates,
  packageSetPrefix,
  parsePrintUriEntries,
  parsePrintUris,
  pruneArchives
} from './apt-archive-cache.mjs'

// Shape of `apt-get install --print-uris -qq` on ubuntu-24.04 (run 39800075431).
const printUris = [
  "'http://azure.archive.ubuntu.com/ubuntu/pool/main/b/build-essential/build-essential_12.10ubuntu1_amd64.deb' build-essential_12.10ubuntu1_amd64.deb 4928 SHA512:aa",
  "'http://azure.archive.ubuntu.com/ubuntu/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_1%3a20230817+repack1-3_all.deb' fonts-noto-cjk_1%3a20230817+repack1-3_all.deb 61187936 SHA512:bb",
  "'http://azure.archive.ubuntu.com/ubuntu/pool/main/z/zsh/zsh_5.9-6ubuntu2_amd64.deb' zsh_5.9-6ubuntu2_amd64.deb 812345 SHA512:cc",
  ''
].join('\n')

describe('parsePrintUris', () => {
  it('returns the archive file names apt would download', () => {
    expect(parsePrintUris(printUris)).toEqual([
      'build-essential_12.10ubuntu1_amd64.deb',
      'fonts-noto-cjk_1%3a20230817+repack1-3_all.deb',
      'zsh_5.9-6ubuntu2_amd64.deb'
    ])
  })

  it('ignores lines that are not download URIs', () => {
    expect(parsePrintUris('Reading package lists...\nW: something\n')).toEqual([])
  })
})

describe('archiveCacheKey', () => {
  const files = parsePrintUris(printUris)

  it('does not depend on the order apt lists the files in', () => {
    expect(archiveCacheKey('apt-Linux-X64', files.toReversed())).toBe(
      archiveCacheKey('apt-Linux-X64', files)
    )
  })

  it('changes when a package version changes', () => {
    const bumped = files.map((file) => file.replace('5.9-6ubuntu2', '5.9-6ubuntu3'))
    expect(archiveCacheKey('apt-Linux-X64', bumped)).not.toBe(
      archiveCacheKey('apt-Linux-X64', files)
    )
  })

  it('keeps the prefix so restore-keys can fall back to an older set', () => {
    expect(archiveCacheKey('apt-Linux-X64', files)).toMatch(/^apt-Linux-X64-[0-9a-f]{16}$/)
  })
})

describe('pruneArchives', () => {
  it('keeps the current archives and drops stale ones and apt bookkeeping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apt-archive-cache-'))
    writeFileSync(join(dir, 'zsh_5.9-6ubuntu2_amd64.deb'), '')
    writeFileSync(join(dir, 'zsh_5.9-6ubuntu1_amd64.deb'), '')
    writeFileSync(join(dir, 'lock'), '')
    mkdirSync(join(dir, 'partial'))
    writeFileSync(join(dir, 'partial', 'fonts-noto-cjk.deb'), '')

    pruneArchives(dir, ['zsh_5.9-6ubuntu2_amd64.deb'])

    expect(readdirSync(dir)).toEqual(['zsh_5.9-6ubuntu2_amd64.deb'])
  })
})

describe('packageSetPrefix', () => {
  const base = 'apt-archives-Linux-X64-ubuntu24'

  it('does not depend on the order the packages are listed in', () => {
    expect(packageSetPrefix(base, 'zsh python3  xvfb')).toBe(
      packageSetPrefix(base, 'xvfb zsh python3')
    )
  })

  // Run 42084699956: the shard's restore-key matched the build job's 5 kB
  // build-essential cache on the queue ref, so fonts-noto-cjk came from the mirror.
  it("keeps another job's package set out of a shard's restore-keys", () => {
    const buildRestoreKey = `${packageSetPrefix(base, 'build-essential python3')}-`
    const shardKey = archiveCacheKey(
      packageSetPrefix(base, 'build-essential fonts-noto-cjk python3 xvfb zsh'),
      parsePrintUris(printUris)
    )
    expect(shardKey.startsWith(buildRestoreKey)).toBe(false)
  })
})

describe('mirrorCandidates', () => {
  it('tries the resolved mirror first, then the same pool path on each fallback', () => {
    const [entry] = parsePrintUriEntries(printUris)
    expect(mirrorCandidates(entry.uri, ['http://archive.ubuntu.com/ubuntu'])).toEqual([
      entry.uri,
      'http://archive.ubuntu.com/ubuntu/pool/main/b/build-essential/build-essential_12.10ubuntu1_amd64.deb'
    ])
  })

  // Run 42093213364: every URI on the runner was `mirror+file:/etc/apt/apt-mirrors.txt/...`.
  it("expands apt's mirror list in order before the fallbacks", () => {
    const dir = mkdtempSync(join(tmpdir(), 'apt-mirror-list-'))
    const list = join(dir, 'apt-mirrors.txt')
    writeFileSync(
      list,
      'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n'
    )
    const pool = '/pool/main/z/zsh/zsh_5.9-6ubuntu2_amd64.deb'
    expect(
      mirrorCandidates(`mirror+file:${list}${pool}`, ['http://archive.ubuntu.com/ubuntu'])
    ).toEqual([
      `http://azure.archive.ubuntu.com/ubuntu${pool}`,
      `https://archive.ubuntu.com/ubuntu${pool}`,
      `http://archive.ubuntu.com/ubuntu${pool}`
    ])
  })
})

describe('fetchArchives', () => {
  const body = Buffer.alloc(64 * 1024, 7)
  const sha512 = createHash('sha512').update(body).digest('hex')
  const requests = []
  let server
  let origin

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(request.url)
      if (request.url.startsWith('/stall/')) {
        // Headers and a first chunk, then nothing: the trickle that held run 42050348519.
        response.writeHead(200, { 'content-length': body.length })
        response.write(body.subarray(0, 100))
        return
      }
      response.writeHead(200, { 'content-length': body.length })
      response.end(body)
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    origin = `http://127.0.0.1:${server.address().port}`
  })

  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  const entry = (mirror, hash = `SHA512:${sha512}`) => ({
    uri: `${origin}/${mirror}/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_all.deb`,
    file: 'fonts-noto-cjk_all.deb',
    size: body.length,
    hash
  })
  const stall = { ms: 300, minBytes: 1024 }
  const options = () => ({ mirrors: [`${origin}/good`], stall, log: () => {} })

  it('downloads nothing on a cache hit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apt-archive-fetch-'))
    writeFileSync(join(dir, 'fonts-noto-cjk_all.deb'), body)
    requests.length = 0

    const result = await fetchArchives([entry('stall')], dir, options())

    expect(result).toEqual({ cached: 1, fetched: 0, failed: 0 })
    expect(requests).toEqual([])
  })

  it('downloads a missing archive from the resolved mirror', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apt-archive-fetch-'))
    requests.length = 0

    const result = await fetchArchives([entry('good')], dir, options())

    expect(result).toEqual({ cached: 0, fetched: 1, failed: 0 })
    expect(requests).toEqual(['/good/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_all.deb'])
    expect(readFileSync(join(dir, 'fonts-noto-cjk_all.deb')).equals(body)).toBe(true)
  })

  it('drops a stalled mirror within one window and fetches from the fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apt-archive-fetch-'))
    requests.length = 0
    const started = Date.now()

    const result = await fetchArchives([entry('stall')], dir, options())

    expect(result).toEqual({ cached: 0, fetched: 1, failed: 0 })
    expect(requests).toEqual([
      '/stall/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_all.deb',
      '/good/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_all.deb'
    ])
    // Two windows at most, against apt's full 600 s attempt on the same stall.
    expect(Date.now() - started).toBeLessThan(2 * stall.ms + 1000)
    expect(readdirSync(join(dir, 'partial'))).toEqual([])
  })

  it('leaves an archive whose hash does not match for apt to fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apt-archive-fetch-'))

    const result = await fetchArchives([entry('good', 'SHA512:00')], dir, options())

    expect(result).toEqual({ cached: 0, fetched: 0, failed: 1 })
    expect(existsSync(join(dir, 'fonts-noto-cjk_all.deb'))).toBe(false)
  })
})

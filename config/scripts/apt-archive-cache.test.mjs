// The apt archive cache key must change exactly when the set of .deb files apt
// would download changes, and pruning must keep only that set (ORCA-750).
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { archiveCacheKey, parsePrintUris, pruneArchives } from './apt-archive-cache.mjs'

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

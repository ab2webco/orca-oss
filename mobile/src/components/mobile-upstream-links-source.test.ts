import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOBILE_ROOT = join(import.meta.dirname, '..', '..')

// Why: links a user can tap must lead to Orca Lab; the relay hosts stay upstream on purpose
// (docs/reference/upstream-runtime-dependencies.md), so only page and account URLs are banned.
const UPSTREAM_USER_LINK =
  /github\.com\/stablyai\/orca|https:\/\/(www\.)?onorca\.dev|x\.com\/orca_build/i

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('mobile user-facing links', () => {
  it('never send the user to the upstream site, repository or X account', () => {
    const offenders = ['app', 'src']
      .flatMap((dir) => sourceFiles(join(MOBILE_ROOT, dir)))
      .filter((path) => UPSTREAM_USER_LINK.test(readFileSync(path, 'utf8')))
      .map((path) => relative(MOBILE_ROOT, path))
    expect(offenders).toEqual([])
  })
})

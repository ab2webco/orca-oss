import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REMOVED_LOCALE_PATHS, resolveRemovedLocalePaths } from './resolve-removed-locale-paths.mjs'

const CATALOG = 'src/renderer/src/i18n/locales/zh.json'
const ENGLISH = 'src/renderer/src/i18n/locales/en.json'
const OTHER_DELETED = 'src/main/fork-dropped.ts'

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-removed-locales-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'sync@test.local')
  git('config', 'user.name', 'Sync Test')
  return { root, git, write }
}

// The fork deletes the zh catalog and an unrelated file and edits en.json; upstream edits all three.
function conflictedMerge() {
  const { root, git, write } = repo()
  write(CATALOG, '{"a":"甲"}\n')
  write(ENGLISH, '{"a":"A"}\n')
  write(OTHER_DELETED, 'export const x = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'upstream')
  write(CATALOG, '{"a":"乙"}\n')
  write(ENGLISH, '{"a":"Upstream"}\n')
  write(OTHER_DELETED, 'export const x = 2\n')
  git('commit', '-q', '-am', 'upstream edits')
  git('checkout', '-q', 'main')
  git('rm', '-q', CATALOG, OTHER_DELETED)
  write(ENGLISH, '{"a":"Fork"}\n')
  git('commit', '-q', '-am', 'fork drops zh')
  try {
    git('merge', '--no-edit', 'upstream')
  } catch {
    // Expected: the merge stops on conflicts.
  }
  const unmerged = () =>
    git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).sort()
  return { root, unmerged }
}

describe('resolve-removed-locale-paths', () => {
  it('resolves a modify/delete conflict on a removed locale path as deleted', () => {
    const { root, unmerged } = conflictedMerge()
    expect(unmerged()).toContain(CATALOG)

    const resolved = resolveRemovedLocalePaths(root)

    expect(resolved).toEqual([CATALOG])
    expect(unmerged()).not.toContain(CATALOG)
    expect(existsSync(path.join(root, CATALOG))).toBe(false)
  })

  it('leaves every other conflict for a person, including other fork deletions', () => {
    const { root, unmerged } = conflictedMerge()

    resolveRemovedLocalePaths(root)

    expect(unmerged()).toEqual([ENGLISH, OTHER_DELETED].sort())
  })

  it('does nothing outside a merge', () => {
    const { root, git, write } = repo()
    write(ENGLISH, '{}\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    expect(resolveRemovedLocalePaths(root)).toEqual([])
  })

  it('lists exact paths, all of them gone from this tree', () => {
    const root = path.resolve(import.meta.dirname, '..', '..')
    expect(REMOVED_LOCALE_PATHS.length).toBeGreaterThan(0)
    for (const file of REMOVED_LOCALE_PATHS) {
      expect(file).not.toMatch(/[*?[\]]/)
      expect(existsSync(path.join(root, file)), file).toBe(false)
    }
  })
})

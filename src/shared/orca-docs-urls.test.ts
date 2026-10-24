import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURE_WALL_TILES } from './feature-wall-tiles'
import { FEATURE_WALL_WORKFLOWS } from './feature-wall-workflows'
import {
  ORCA_CHANGELOG_URL,
  ORCA_DOCS_BASE_URL,
  ORCA_DOCS_INDEX_URL,
  ORCA_PRIVACY_URL
} from './orca-docs-urls'
import { ORCA_REPOSITORY_URL } from './orca-repository-url'

const USER_DOCS_DIR = join(__dirname, '..', '..', 'docs', 'user')

const SHIPPED_DOCS_URLS = [
  ...FEATURE_WALL_TILES.map((tile) => tile.docsUrl),
  ...FEATURE_WALL_WORKFLOWS.map((workflow) => workflow.docsUrl),
  ORCA_DOCS_INDEX_URL,
  ORCA_PRIVACY_URL
]

describe('user docs links', () => {
  it('derives the docs base from the fork repository', () => {
    expect(ORCA_DOCS_BASE_URL).toBe(`${ORCA_REPOSITORY_URL}/blob/main/docs/user`)
  })

  it('points the changelog at the fork releases', () => {
    expect(ORCA_CHANGELOG_URL).toBe(`${ORCA_REPOSITORY_URL}/releases`)
  })

  it.each(SHIPPED_DOCS_URLS)('%s maps to an existing file under docs/user', (url) => {
    expect(url.startsWith(`${ORCA_DOCS_BASE_URL}/`)).toBe(true)
    const relativePath = url.slice(ORCA_DOCS_BASE_URL.length + 1)
    expect(existsSync(join(USER_DOCS_DIR, relativePath))).toBe(true)
  })

  it('never ships an onorca.dev docs, changelog or privacy link', () => {
    for (const url of [...SHIPPED_DOCS_URLS, ORCA_CHANGELOG_URL]) {
      expect(url).not.toMatch(/onorca\.dev/)
    }
  })
})

import fs from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { ALLOWLIST_PATH, checkTree, parseAllowlist } from './renderer-brand-drift-allowlist.mjs'
import {
  ALLOWLIST,
  commitAll,
  fixtureRepo,
  gitIn,
  OLD_NAME,
  removeFixtureRepos,
  writeRenderer
} from './renderer-brand-drift-fixture.mjs'

afterAll(removeFixtureRepos)

const REPO_ROOT = path.join(import.meta.dirname, '..', '..')

describe('parsing the allowlist', () => {
  it('reads one file and key per line, ignoring comments and blank lines', () => {
    const entries = parseAllowlist('# header\n\ncomponents/A.tsx some.key\n  b.ts other.key  \n')
    expect([...entries]).toEqual(['components/A.tsx some.key', 'b.ts other.key'])
  })

  it('rejects a line that is not a file and a key', () => {
    expect(() => parseAllowlist('stale-fallbacks 62 extra')).toThrow(/Malformed/)
    expect(() => parseAllowlist('components/A.tsx')).toThrow(/Malformed/)
  })
})

describe('checking a renderer tree against the allowlist', () => {
  it('accepts the listed stale fallbacks', () => {
    expect(checkTree(fixtureRepo()).violations).toEqual([])
  })

  it('needs no allowlist edit for a new, correctly branded call', () => {
    const root = fixtureRepo()
    writeRenderer(root, {
      'components/Added.tsx': `translate('greet', 'Hello')\ntranslate('brand', '${OLD_NAME} Lab is ready')\n`
    })
    expect(checkTree(root).violations).toEqual([])
  })

  it('fails a new stale fallback, naming its file and line', () => {
    const root = fixtureRepo()
    writeRenderer(root, { 'components/Added.tsx': "\n\ntranslate('second', 'Wrong second')\n" })
    expect(checkTree(root).violations.map((v) => v.message)).toEqual([
      'src/renderer/src/components/Added.tsx:3 second: fallback "Wrong second" differs from the catalog value "Second copy"'
    ])
  })

  it('fails a new rename drift even when its file and key are listed', () => {
    const root = fixtureRepo({
      files: { 'components/Brand.tsx': `\ntranslate('brand', '${OLD_NAME} is ready')\n` },
      allowlist: 'components/Brand.tsx brand\n'
    })
    const [violation] = checkTree(root).violations
    expect(violation).toMatchObject({ path: 'src/renderer/src/components/Brand.tsx', line: 2 })
    expect(violation.message).toContain(`still says ${OLD_NAME} where the catalog says`)
  })

  it('reports a listed entry that is no longer stale without failing', () => {
    const root = fixtureRepo()
    writeRenderer(root, { 'components/First.tsx': "translate('first', 'First copy')\n" })
    expect(checkTree(root)).toMatchObject({
      violations: [],
      unused: ['components/First.tsx first']
    })
  })
})

describe('two branches that each fix a different listed entry', () => {
  it('merge with no conflict and pass, also when both add calls', () => {
    const root = fixtureRepo()
    const git = gitIn(root)
    git('switch', '-qc', 'two')
    writeRenderer(root, {
      'components/Second.tsx': "export const b = () => translate('second', 'Second copy')\n",
      'components/AddedTwo.tsx': "translate('greet', 'Hello')\n"
    })
    commitAll(root, 'fix second')
    git('switch', '-q', 'work')
    writeRenderer(root, {
      'components/First.tsx': "export const a = () => translate('first', 'First copy')\n",
      'components/AddedOne.tsx': "translate('greet', 'Hello')\n"
    })
    commitAll(root, 'fix first')

    git('merge', '-q', '--no-edit', 'two')

    expect(git('diff', '--name-only', 'main', 'HEAD', '--', ALLOWLIST)).toBe('')
    expect(checkTree(root)).toMatchObject({
      violations: [],
      unused: ['components/First.tsx first', 'components/Second.tsx second']
    })
  })
})

describe('one source of truth', () => {
  it('serves the vitest pin and the static-analysis ratchet from the same allowlist', () => {
    const read = (file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')
    for (const consumer of [
      'renderer-brand-name-fallback.test.mjs',
      'check-renderer-brand-drift-ratchet.mjs'
    ]) {
      expect(read(consumer)).toMatch(
        /import \{[^}]*\bcheckTree\b[^}]*\} from '\.\/renderer-brand-drift-allowlist\.mjs'/
      )
    }
    expect(fs.existsSync(path.join(REPO_ROOT, ALLOWLIST_PATH))).toBe(true)
    expect(fs.existsSync(path.join(REPO_ROOT, 'config/renderer-brand-drift-baseline.txt'))).toBe(
      false
    )
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TESTS = __dirname
const kitFiles = readdirSync(TESTS).filter((name) => /\.test\.tsx?$/.test(name))

// The names a file imports, as values, from the kit.
const kitValuesOf = (source: string): string[] =>
  [...source.matchAll(/^import \{([^}]*)\} from 'claude-code\/testing'/gm)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '' && !name.startsWith('type '))
  )

describe('the suite budget', () => {
  it('finds the kit test files', () => {
    expect(kitFiles.length).toBeGreaterThan(0)
  })

  // Why: the kit's own `test` runs under its 5 s default, which the Windows queue runner crosses.
  it.each(kitFiles)('%s takes `test` from ./test-budget, not the kit', (name) => {
    const source = readFileSync(join(TESTS, name), 'utf8')
    expect(kitValuesOf(source)).not.toContain('test')
    expect(source).toMatch(/^import \{ test \} from '\.\/test-budget'$/m)
  })
})

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererDir = resolve(import.meta.dirname, '..')
const OWNER = join('lib', 'local-host-display-label.ts')
// Why these three: each names the local machine with the shared 'Local Mac' wording.
const SHARED_LABELS =
  /\b(getLocalExecutionHostLabel|getExecutionHostLabel|buildExecutionHostRegistry)\b/
const LITERAL_LABEL = /'This computer'/

function sources(): string[] {
  return readdirSync(rendererDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$|test-fixtures/.test(file))
    .filter((file) => file !== OWNER)
}

// Why (ORCA-1149): every surface must show the local machine through one translated label.
describe('local host label routing', () => {
  it('builds host labels only through local-host-display-label', () => {
    const offenders = sources().filter((file) =>
      SHARED_LABELS.test(readFileSync(join(rendererDir, file), 'utf8'))
    )
    expect(offenders).toEqual([])
  })

  it('spells This computer nowhere else', () => {
    const offenders = sources().filter((file) =>
      LITERAL_LABEL.test(readFileSync(join(rendererDir, file), 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})

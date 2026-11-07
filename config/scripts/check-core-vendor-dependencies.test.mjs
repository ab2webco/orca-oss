import { describe, expect, it } from 'vitest'

import {
  findVendorProblems,
  main,
  parseAllowlist,
  stripComments,
  vendorUseOf
} from './check-core-vendor-dependencies.mjs'

const NO_DEPS = { dependencies: { react: '19.0.0' } }

const problemsOf = ({ files, allowlist = '', manifest = NO_DEPS }) =>
  findVendorProblems({ files, allowlist: parseAllowlist(allowlist), manifest })

describe('core vendor dependency guard', () => {
  it('ignores a vendor named only in comments', () => {
    const text = '// Why: Engram may be down.\n/* Jev and orca-sonar too */\nexport const a = 1\n'
    expect(vendorUseOf(text).named).toEqual([])
    expect(stripComments("const url = 'http://x' // engram")).not.toMatch(/engram/)
  })

  it('fails a core file that names a vendor in code outside the adapters', () => {
    const problems = problemsOf({
      files: [{ path: 'src/main/lessons.ts', text: 'const url = process.env.ENGRAM_URL\n' }]
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/main/lessons.ts names engram in code')
  })

  it('passes the same file once it is a listed adapter', () => {
    expect(
      problemsOf({
        files: [{ path: 'src/main/lessons.ts', text: 'const url = process.env.ENGRAM_URL\n' }],
        allowlist: 'engram src/main/lessons.ts -- mirror that times out\n'
      })
    ).toEqual([])
  })

  it('fails a vendor package import even inside a listed adapter', () => {
    const problems = problemsOf({
      files: [{ path: 'src/main/sonar.ts', text: "import { find } from 'orca-sonar'\n" }],
      allowlist: 'sonar src/main/sonar.ts -- adapter\n'
    })
    expect(problems).toEqual([expect.stringContaining("imports 'orca-sonar'")])
  })

  it('fails a listed adapter that no longer names its vendor, so the list only shrinks', () => {
    const problems = problemsOf({
      files: [{ path: 'src/main/plain.ts', text: 'export const a = 1\n' }],
      allowlist: 'jev src/main/plain.ts -- was an adapter\n'
    })
    expect(problems).toEqual([expect.stringContaining('no longer names')])
  })

  it('fails a vendor in package.json dependencies', () => {
    const problems = problemsOf({
      files: [],
      manifest: { dependencies: { react: '19.0.0' }, optionalDependencies: { engram: '1.0.0' } }
    })
    expect(problems).toEqual([expect.stringContaining('optionalDependencies has engram')])
  })

  it('rejects an allowlist line without a reason', () => {
    expect(() => parseAllowlist('jev src/a.ts\n')).toThrow(/Malformed/)
  })

  it('passes on this tree', () => {
    expect(main(process.cwd())).toBe(0)
  })
})

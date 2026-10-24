import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ORCA_REPOSITORY_URL } from './orca-repository-url'

const ROOT = resolve(__dirname, '../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

describe('Orca Lab user-facing repository links', () => {
  it.each([
    'src/renderer/src/components/Landing.tsx',
    'src/renderer/src/components/settings/GeneralSupportSection.tsx'
  ])('%s opens the fork repository through the shared constant', (file) => {
    const source = read(file)
    expect(source).toMatch(/import \{[^}]*ORCA_REPOSITORY_URL[^}]*\} from '.*orca-repository-url'/)
    expect(source).not.toContain('stablyai/orca')
  })

  it.each(['src/cli/specs/project.ts', 'src/cli/specs/core.ts'])(
    '%s shows CLI examples for the fork repository',
    (file) => {
      const source = read(file)
      expect(source).toMatch(
        /import \{[^}]*ORCA_REPOSITORY_SLUG[^}]*\} from '.*orca-repository-url'/
      )
      expect(source).not.toContain('stablyai/orca')
    }
  )

  it('lists the fork as the package homepage and author', () => {
    const pkg = JSON.parse(read('package.json')) as { homepage: string; author: string }
    expect(pkg.homepage).toBe(ORCA_REPOSITORY_URL)
    expect(pkg.author).toBe('ab2webco')
  })

  it('names the fork as the Linux package maintainer', () => {
    expect(read('config/electron-builder.config.cjs')).toContain("maintainer: 'ab2webco'")
    expect(read('config/electron-builder.config.cjs')).not.toContain("maintainer: 'stablyai'")
  })

  // Why: example.com is RFC 2606 reserved, so the demo accounts name no real owner.
  it('shows reserved example.com demo accounts on the mobile home slide', () => {
    const slide = read('src/renderer/src/components/mobile/slides/HomeSlide.tsx')
    expect(slide).toContain('email="claude@example.com"')
    expect(slide).toContain('email="codex@example.com"')
    expect(slide).not.toContain('stably.ai')
  })
})

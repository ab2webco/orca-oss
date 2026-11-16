import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '../../..')

/** The pull_request `paths` filter of Mobile Checks, as GitHub reads it. */
function mobileChecksPaths(): RegExp[] {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/mobile.yml'), 'utf8')
  const block = workflow.split(/\n {4}paths:\n/)[1]!.split(/\n(?! {6}(?:-|#))/)[0]!
  // Why split on **: it crosses folders, while a single * stays inside one.
  return [...block.matchAll(/^ {6}- '([^']+)'$/gm)].map(
    ([, glob]) =>
      new RegExp(
        `^${glob!
          .split('**')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
          .join('.*')}$`
      )
  )
}

describe('Mobile Checks paths', () => {
  it('re-run the phone scene engine checks when any desktop file it bundles changes', async () => {
    const result = await build({
      entryPoints: [join(import.meta.dirname, 'team-scene-engine.ts')],
      bundle: true,
      write: false,
      metafile: true,
      packages: 'external',
      platform: 'browser',
      outdir: join(repoRoot, 'out'),
      logLevel: 'silent'
    })
    const desktopFiles = Object.keys(result.metafile.inputs)
      .map((input) => relative(repoRoot, join(process.cwd(), input)).split('\\').join('/'))
      .filter((file) => !file.startsWith('mobile/'))
    const paths = mobileChecksPaths()
    // Guards the reader: a filter that reads no paths, or a build that bundles nothing, passes empty.
    expect(paths.length).toBeGreaterThan(1)
    expect(desktopFiles).toContain('src/shared/team-scene/team-scene-director.ts')
    expect(desktopFiles.filter((file) => !paths.some((path) => path.test(file)))).toEqual([])
  })
})

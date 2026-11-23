import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: the WebView bundles the desktop stage; a store or React import there ships both to the phone.
const ENTRY = resolve(
  import.meta.dirname,
  '../../../../../mobile/src/team-drawer/team-scene-diorama-engine.ts'
)
const BANNED = /^(react|react-dom|react-native|zustand)(\/|$)/
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
const DYNAMIC = /import\(\s*['"]([^'"]+)['"]\s*\)/g

const resolveLocal = (from: string, spec: string): string | null => {
  const base = resolve(dirname(from), spec)
  for (const p of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(p) && /\.tsx?$/.test(p)) {
      return p
    }
  }
  return null
}

/** Every runtime import reachable from `entry`, as [importing file, specifier]; type-only ones skipped. */
function runtimeImports(entry: string): { files: Set<string>; bare: [string, string][] } {
  const files = new Set<string>()
  const bare: [string, string][] = []
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file)) {
      continue
    }
    files.add(file)
    const src = readFileSync(file, 'utf8')
    const specs = [
      ...[...src.matchAll(IMPORT)].filter((m) => !m[1]).map((m) => m[2]!),
      ...[...src.matchAll(DYNAMIC)].map((m) => m[1]!)
    ]
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const next = resolveLocal(file, spec)
        if (next) {
          queue.push(next)
        }
      } else {
        bare.push([file, spec])
      }
    }
  }
  return { files, bare }
}

describe('the phone WebView diorama engine', () => {
  it('reaches no zustand or React module through its runtime imports', () => {
    const { files, bare } = runtimeImports(ENTRY)
    // Why: an empty walk would pass vacuously; the stage and its pick must be on the path.
    const names = [...files].map((f) => f.split(/[\\/]/).pop())
    expect(names).toContain('team-diorama-stage.ts')
    expect(names).toContain('team-scene3d-pick.ts')
    expect(bare.filter(([, spec]) => BANNED.test(spec))).toEqual([])
  })
})

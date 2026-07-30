import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APPIMAGE_CLI_COMMAND_ROOTS,
  APPIMAGE_CLI_PRE_SPEC_ROOTS
} from '../shared/appimage-cli-command-roots'
import { specPaths } from './command-spec'
import { COMMAND_SPECS } from './specs'

// Why (ORCA-138): the AppImage redirect allow-list is a hand-maintained copy of
// the CLI's root commands, and it drifted — losing 10 roots including `plane`,
// so `orca.appimage plane project list --json` booted the GUI, lost the
// single-instance lock, and exited with no output. This test lives on the CLI
// side because only this tsconfig can import both COMMAND_SPECS and `shared`.

function specRootCommands(): string[] {
  const roots = new Set<string>()
  for (const spec of COMMAND_SPECS) {
    for (const path of specPaths(spec)) {
      roots.add(path[0])
    }
  }
  return [...roots].sort()
}

describe('AppImage CLI command roots', () => {
  it('covers every root command registered in COMMAND_SPECS', () => {
    const missing = specRootCommands().filter((root) => !APPIMAGE_CLI_COMMAND_ROOTS.includes(root))
    expect(missing).toEqual([])
  })

  it('covers the roots main() handles before spec parsing', () => {
    const missing = APPIMAGE_CLI_PRE_SPEC_ROOTS.filter(
      (root) => !APPIMAGE_CLI_COMMAND_ROOTS.includes(root)
    )
    expect(missing).toEqual([])
  })

  // Why: the assertion above only compares two arrays in the same file. The real
  // drift source is a new `argv[0] === '<root>'` short-circuit added to main(),
  // which has no CommandSpec for the derived check to catch — so read the source
  // and require every such literal to be allow-listed.
  it('covers every argv[0] short-circuit in main()', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const shortCircuits = [...source.matchAll(/argv\[0\] === '([^']+)'/g)].map((match) => match[1])

    expect(shortCircuits.length).toBeGreaterThan(0)
    expect(shortCircuits.filter((root) => !APPIMAGE_CLI_COMMAND_ROOTS.includes(root))).toEqual([])
  })

  it('lists no command the CLI does not expose', () => {
    const real = new Set([...specRootCommands(), ...APPIMAGE_CLI_PRE_SPEC_ROOTS])
    const stale = APPIMAGE_CLI_COMMAND_ROOTS.filter((root) => !real.has(root))
    expect(stale).toEqual([])
  })

  it('includes the `plane` root from the report', () => {
    expect(APPIMAGE_CLI_COMMAND_ROOTS).toContain('plane')
  })
})

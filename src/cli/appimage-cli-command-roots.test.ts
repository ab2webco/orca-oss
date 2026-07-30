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

  it('lists no command the CLI does not expose', () => {
    const real = new Set([...specRootCommands(), ...APPIMAGE_CLI_PRE_SPEC_ROOTS])
    const stale = APPIMAGE_CLI_COMMAND_ROOTS.filter((root) => !real.has(root))
    expect(stale).toEqual([])
  })

  it('includes the `plane` root from the report', () => {
    expect(APPIMAGE_CLI_COMMAND_ROOTS).toContain('plane')
  })
})

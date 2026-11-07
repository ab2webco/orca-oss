import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// Why a private parent: the service treats dirname(userData) as the Orca profiles root and refuses
// an add whose identity sits in a sibling profile, so suites whose userData sat directly in tmpdir()
// saw each other's accounts when they ran in parallel (ORCA-1117).
export function createIsolatedTestProfilePath(name: string): string {
  const profilesRoot = mkdtempSync(join(tmpdir(), `${name}-`))
  afterAll(() => rmSync(profilesRoot, { recursive: true, force: true }))
  return join(profilesRoot, name)
}

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

type Scope = {
  path: string
  connectionId: string | null
  repo: { id: string; executionHostId?: string } | null
}

// Why the cast: the workspace scope lookup is private, and a real one needs a scanned repo.
const withScope = (runtime: OrcaRuntimeService, scope: Scope | Error) => {
  const scoped = runtime as unknown as {
    resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<Scope>
  }
  return vi.spyOn(scoped, 'resolveTerminalWorkspaceLaunchScope').mockImplementation(async () => {
    if (scope instanceof Error) {
      throw scope
    }
    return scope
  })
}

const runtimeWith = (settings: object) =>
  new OrcaRuntimeService({ getSettings: () => settings } as never)

describe("a game member's brief target", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  const workspace = () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-brief-target-'))
    dirs.push(dir)
    return dir
  }

  it("is the workspace the member's terminal starts in, on its own host", async () => {
    const runtime = runtimeWith({})
    const path = workspace()
    const lookup = withScope(runtime, { path, connectionId: 'ssh-1', repo: { id: 'repo1' } })

    expect(await runtime.gameMemberBriefTargetFor('repo1::wt')).toEqual({
      path,
      connectionId: 'ssh-1'
    })
    expect(lookup).toHaveBeenCalledWith('id:repo1::wt')
  })

  it('is a folder workspace too', async () => {
    const runtime = runtimeWith({})
    const path = workspace()
    withScope(runtime, { path, connectionId: null, repo: null })

    expect(await runtime.gameMemberBriefTargetFor('folder:abc')).toEqual({
      path,
      connectionId: null
    })
  })

  it('is none when the project keeps its members plain', async () => {
    const runtime = runtimeWith({
      orchestratorGameProjects: { repo1: { orchestrator: { memberGame: false } } }
    })
    withScope(runtime, { path: workspace(), connectionId: null, repo: { id: 'repo1' } })

    expect(await runtime.gameMemberBriefTargetFor('repo1::wt')).toBeNull()
  })

  it('is none when the game is off', async () => {
    const runtime = runtimeWith({ orchestratorGame: { mode: 'off' } })
    withScope(runtime, { path: workspace(), connectionId: null, repo: { id: 'repo1' } })

    expect(await runtime.gameMemberBriefTargetFor('repo1::wt')).toBeNull()
  })

  it('is none for a repo a remote Orca runtime hosts, whose files are not on this machine', async () => {
    const runtime = runtimeWith({})
    withScope(runtime, {
      path: '/srv/remote/repo',
      connectionId: null,
      repo: { id: 'repo1', executionHostId: 'runtime:env-1' }
    })

    expect(await runtime.gameMemberBriefTargetFor('repo1::wt')).toBeNull()
  })

  it('is none on Windows for a local path this machine cannot write as given', async () => {
    const runtime = runtimeWith({})
    withScope(runtime, { path: '/home/me/repo', connectionId: null, repo: { id: 'repo1' } })

    expect(await runtime.gameMemberBriefTargetFor('repo1::wt', 'win32')).toBeNull()
  })

  it('is a WSL worktree on Windows, which this machine writes through its UNC path', async () => {
    const runtime = runtimeWith({})
    const path = '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'
    withScope(runtime, { path, connectionId: null, repo: { id: 'repo1' } })

    expect(await runtime.gameMemberBriefTargetFor('repo1::wt', 'win32')).toEqual({
      path,
      connectionId: null
    })
  })

  it('is none when the workspace cannot be resolved, so the member gets the full preamble', async () => {
    const runtime = runtimeWith({})
    withScope(runtime, new Error('selector_not_found'))

    expect(await runtime.gameMemberBriefTargetFor('repo1::gone')).toBeNull()
  })
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareOrchestratorGameLaunch } from './orchestrator-game-launch-context'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function worktreeWith(orcaYaml: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-'))
  dirs.push(dir)
  if (orcaYaml !== null) {
    writeFileSync(join(dir, 'orca.yaml'), orcaYaml)
  }
  return dir
}

const base = {
  pluginDir: '/plugins/orca-game',
  detectClaudeVersion: async () => '2.1.301'
}

describe('prepareOrchestratorGameLaunch', () => {
  it('merges global settings, the worktree orca.yaml and the local project override', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: {
        orchestratorGame: { hud: false },
        orchestratorGameProjects: { repo1: { rewards: false } }
      },
      repoId: 'repo1',
      worktreePath: worktreeWith('orchestratorGame:\n  mode: zen\n')
    })

    expect(launch.args).toEqual(['--plugin-dir', '/plugins/orca-game'])
    expect(launch.env).toMatchObject({
      ORCA_GAME_MODE: 'zen',
      ORCA_GAME_HUD: '0',
      ORCA_GAME_REWARDS: '0'
    })
  })

  it('lets the local override turn the game off for a project that enables it', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: { orchestratorGameProjects: { repo1: { mode: 'off' } } },
      repoId: 'repo1',
      worktreePath: worktreeWith('orchestratorGame:\n  mode: on\n')
    })

    expect(launch).toEqual({ args: [], env: {} })
  })

  it('uses the defaults for a folder without orca.yaml or a repo id', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      settings: undefined,
      repoId: null,
      worktreePath: worktreeWith(null)
    })

    expect(launch.env.ORCA_GAME_MODE).toBe('on')
  })

  it('launches plain Claude when the version probe fails', async () => {
    const launch = await prepareOrchestratorGameLaunch({
      ...base,
      detectClaudeVersion: async () => {
        throw new Error('spawn claude ENOENT')
      },
      settings: undefined,
      repoId: null,
      worktreePath: null
    })

    expect(launch).toEqual({ args: [], env: {} })
  })
})
